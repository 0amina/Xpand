import { createWorker, type Worker } from 'tesseract.js';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Tesseract, wrapped so the rest of the module never touches a worker.
 *
 * Three things this file exists to manage:
 *
 *  1. **Worker reuse.** Spinning a worker up costs ~2 s (WASM core + language data). One
 *     long-lived worker is created on first use and kept, so only the first invoice of a process
 *     pays that.
 *  2. **Serialisation.** A worker handles one page at a time. Rather than racing jobs against a
 *     shared worker, every call queues behind the previous one. Invoices arrive one at a time
 *     from a phone camera, so a queue is the honest model and it keeps peak memory flat.
 *  3. **Containment.** OCR is the part most likely to fail in ways we do not control — a corrupt
 *     JPEG, no network on first run to fetch language data, a WASM OOM. Everything surfaces as
 *     `OcrError`, which the service records on the row so the user gets a real explanation and
 *     can still fill the draft by hand.
 *
 * Language data is cached under `TESSDATA_DIR` after the first run; without that setting
 * Tesseract writes multi-megabyte blobs into the process CWD.
 */

/** OCR failed in a way worth showing the user. `reason` picks the message they see. */
export class OcrError extends Error {
  readonly reason: 'disabled' | 'language-data' | 'unreadable' | 'internal';

  constructor(reason: OcrError['reason'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OcrError';
    this.reason = reason;
  }
}

export interface OcrResult {
  /** The full page transcription, as Tesseract read it. Stored verbatim on the row. */
  text: string;
  /** Mean per-word confidence, 0-100. Below ~70 the extraction is usually worth re-shooting. */
  confidence: number;
  /** Which engine and languages produced this, recorded for later comparison. */
  engine: string;
}

let workerPromise: Promise<Worker> | null = null;

/** The tail of the job queue. Each call chains onto it so only one page is read at a time. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The shared worker, created on first use.
 *
 * On failure the cached promise is cleared so the next upload retries rather than inheriting a
 * permanently rejected promise — the usual cause is a transient network error fetching language
 * data, which succeeds on a second attempt.
 */
function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker(env.OCR_LANGS.split('+'), 1, {
    cachePath: env.TESSDATA_DIR,
    // Tesseract's progress chatter is per-page and noisy; keep it at trace.
    logger: (m) => {
      if (m.status) logger.trace({ status: m.status, progress: m.progress }, 'tesseract');
    },
    errorHandler: (e) => logger.warn({ err: e }, 'tesseract worker error'),
  }).catch((err: unknown) => {
    workerPromise = null;
    const message = err instanceof Error ? err.message : String(err);
    // The first run downloads `<lang>.traineddata`. Offline, that is the failure you get, and
    // it is worth naming precisely because the fix (network access once) is not obvious.
    throw new OcrError(
      'language-data',
      `Could not start the OCR engine. The first run downloads language data for "${env.OCR_LANGS}" — check network access, or pre-place the files in ${env.TESSDATA_DIR}. (${message})`,
      { cause: err },
    );
  });

  return workerPromise;
}

/**
 * Read the text off one invoice image.
 *
 * @param image Raw bytes of a JPEG/PNG/WebP. Pass the **original** upload, not a downscaled
 *   copy: Tesseract's accuracy falls off sharply below roughly 1000 px on the long edge, so
 *   compressing before OCR is a false economy.
 * @throws OcrError
 */
export async function recognise(image: Buffer): Promise<OcrResult> {
  if (!env.OCR_ENABLED) {
    throw new OcrError(
      'disabled',
      'OCR is turned off on this server (OCR_ENABLED=false). Fill the invoice details by hand.',
    );
  }

  // Chain onto the queue, and make sure a failed job does not poison it for the next caller.
  const run = queue.then(
    () => readPage(image),
    () => readPage(image),
  );
  queue = run.catch(() => undefined);
  return run;
}

async function readPage(image: Buffer): Promise<OcrResult> {
  const worker = await getWorker();

  try {
    const { data } = await worker.recognize(image);
    const text = data.text ?? '';

    // A page that yields almost nothing is a failed read, not an invoice with no text. Saying so
    // lets the UI suggest a better photo instead of showing an empty draft as if it were a result.
    if (text.trim().length < 10) {
      throw new OcrError(
        'unreadable',
        'No readable text was found. Retake the photo in better light, straight-on and in focus, with the whole invoice in frame.',
      );
    }

    return {
      text,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      engine: `tesseract.js:${env.OCR_LANGS}`,
    };
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError('internal', 'The OCR engine failed to read this file.', { cause: err });
  }
}

/**
 * Release the worker. Called from the server's shutdown path — a live Tesseract worker holds a
 * worker thread, which would keep the process from exiting cleanly.
 */
export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;

  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Already dead, or never started. Nothing to release.
  }
}
