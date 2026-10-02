import { api } from './api';
import { readJSON, writeJSON } from './storage';

/**
 * The **legacy** local-only invoice queue — now a migration path, not a feature.
 *
 * Before the backend had an invoices module, an invoice captured on the expense form was
 * downscaled and parked in `localStorage`, keyed by the transaction it belonged to. That was a
 * deliberate stopgap, and the UI warned loudly on every surface that nothing had been uploaded.
 *
 * `POST /api/invoices` now exists, so nothing new is ever written here. What remains is
 * `flushPending()`, which uploads whatever a device still has left over and files each image
 * against the transaction it was captured for. Once a device's queue is empty this module stops
 * mattering, and the whole file can go.
 *
 * Note what the drain must **not** do: confirm these as new invoice drafts. Each entry belongs to
 * a transaction the user already saved by hand, so running them through the confirm flow would
 * book every one of those expenses a second time. They are *linked*, never confirmed.
 */

const KEY = 'pending-invoices';

/**
 * Cap the queue so a month of receipts cannot exhaust the ~5 MB origin quota and start
 * breaking unrelated writes. Oldest entries are evicted first, and the UI warns as it fills.
 */
const MAX_ENTRIES = 25;
const MAX_TOTAL_BYTES = 3_500_000;

export interface PendingInvoice {
  /** The `transactions.id` this attachment belongs to. */
  transactionId: number;
  /** The invoice number as typed by the user, e.g. `"INV-2026-0088"`. */
  reference?: string;
  /** Downscaled JPEG data URL, or absent when only a reference was entered. */
  imageDataUrl?: string;
  /** Approximate size of `imageDataUrl` in bytes. */
  bytes: number;
  /** ISO timestamp of when it was captured. */
  capturedAt: string;
}

type InvoiceMap = Record<string, PendingInvoice>;

function readAll(): InvoiceMap {
  return readJSON<InvoiceMap>(KEY, {});
}

/**
 * Persist the map, evicting oldest-first until it fits both caps.
 *
 * @returns how many entries had to be dropped, so the caller can tell the user.
 */
function writeAll(map: InvoiceMap): number {
  const entries = Object.values(map).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  let evicted = 0;

  const totalBytes = () => entries.reduce((sum, e) => sum + e.bytes, 0);
  while (entries.length > MAX_ENTRIES || (entries.length > 1 && totalBytes() > MAX_TOTAL_BYTES)) {
    entries.shift();
    evicted++;
  }

  writeJSON(KEY, Object.fromEntries(entries.map((e) => [String(e.transactionId), e])));
  return evicted;
}

/** Every queued attachment, newest first. */
export function listPending(): PendingInvoice[] {
  return Object.values(readAll()).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function getPending(transactionId: number): PendingInvoice | undefined {
  return readAll()[String(transactionId)];
}

export function countPending(): number {
  return Object.keys(readAll()).length;
}

/** Total approximate bytes held, for the storage meter on the Pending screen. */
export function pendingBytes(): number {
  return Object.values(readAll()).reduce((sum, e) => sum + e.bytes, 0);
}

export interface SaveResult {
  /** Entries evicted to make room. Non-zero means the user lost an older attachment. */
  evicted: number;
}

/**
 * @deprecated Nothing calls this any more. Invoices go to `POST /api/invoices`, and writing new
 * entries into a store whose only job is to drain itself would reopen the trap this replaced.
 * Kept only so an older bundle still in a webview does not crash on a missing export.
 */
export function savePending(
  transactionId: number,
  input: { reference?: string; imageDataUrl?: string; bytes?: number },
): SaveResult {
  if (!input.reference && !input.imageDataUrl) return { evicted: 0 };

  const map = readAll();
  map[String(transactionId)] = {
    transactionId,
    reference: input.reference,
    imageDataUrl: input.imageDataUrl,
    bytes: input.bytes ?? 0,
    capturedAt: new Date().toISOString(),
  };

  return { evicted: writeAll(map) };
}

export function removePending(transactionId: number): void {
  const map = readAll();
  delete map[String(transactionId)];
  writeAll(map);
}

export function clearPending(): void {
  writeJSON(KEY, {});
}

export interface FlushResult {
  uploaded: number;
  /** Entries that could not be migrated, with the reason, so the UI can say what is stuck. */
  failed: Array<{ transactionId: number; reason: string }>;
  /** Entries dropped because they held only a reference, with no image to upload. */
  skipped: number;
}

/**
 * Upload every leftover attachment and file it against its original transaction.
 *
 * Each entry is uploaded, then **linked** — `POST /api/invoices/:id/link` attaches an image to a
 * transaction that already exists and creates nothing. Confirming instead would duplicate every
 * expense in the queue.
 *
 * An entry is removed from the queue only once its upload *and* link both succeed, so a partial
 * failure can be retried without losing anything or uploading twice. Entries holding only an
 * invoice reference and no photo have nothing to upload and are dropped.
 */
export async function flushPending(): Promise<FlushResult> {
  const result: FlushResult = { uploaded: 0, failed: [], skipped: 0 };

  for (const entry of listPending()) {
    if (!entry.imageDataUrl) {
      // Reference-only: the number already lives in the transaction's description.
      removePending(entry.transactionId);
      result.skipped++;
      continue;
    }

    try {
      const blob = await dataUrlToBlob(entry.imageDataUrl);
      const invoice = await api.upload<{ id: number }>('/api/invoices', blob, {
        filename: `invoice-${entry.transactionId}.jpg`,
      });

      await api.post(`/api/invoices/${invoice.id}/link`, {
        transactionId: entry.transactionId,
      });

      removePending(entry.transactionId);
      result.uploaded++;
    } catch (err) {
      result.failed.push({
        transactionId: entry.transactionId,
        reason: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }

  return result;
}

/** Turn a stored data URL back into bytes for upload. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

export { MAX_ENTRIES, MAX_TOTAL_BYTES };
