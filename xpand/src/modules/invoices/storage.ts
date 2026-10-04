import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  INVOICE_EXTENSIONS,
  INVOICE_MIME_TYPES,
  type InvoiceMimeType,
} from '../../config/constants.js';
import { env, storageDriver } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/AppError.js';

/**
 * Where invoice files live.
 *
 * Two interchangeable backends, chosen by `STORAGE_DRIVER`:
 *
 *  - **disk** — a directory on the local filesystem (`UPLOAD_DIR`). The original behaviour, and
 *    still the right one for local development: no account, no network, no cost.
 *  - **supabase** — a private Supabase Storage bucket, reached over its REST API. Required on
 *    any serverless host, where the filesystem is read-only apart from an ephemeral `/tmp` that
 *    the next invocation will not see. Without it an upload would succeed and the bytes would be
 *    gone before the user could review them.
 *
 * Both are addressed by the same **storage key** — a generated `<uuid>.<ext>` string. The key,
 * not a path and not a URL, is what goes in `invoices.image_url`, so the two backends read each
 * other's rows and switching hosts needs no data migration.
 *
 * Files are served only through `GET /api/invoices/:id/file`, never as static assets, under
 * either backend. That is deliberate: a public bucket or an `express.static` mount would put
 * every receipt the company has behind a guessable URL with no authentication in front of it.
 * The Supabase bucket is created private and read with the service-role key, which never leaves
 * the server.
 *
 * The stored name is a UUID, not the user's filename. Two reasons — the original is attacker
 * controlled (`../../.env` is a filename), and two phones both uploading `IMG_0001.jpg` must not
 * collide. The original is kept in a column for display only.
 */

// ---------------------------------------------------------------------------------------------
// Validation — backend-independent
// ---------------------------------------------------------------------------------------------

/**
 * Why this content type is not acceptable, or null if it is.
 *
 * Separate from `assertAcceptableUpload` because the multipart parser needs the same verdict
 * *before* it buffers the body, and it signals rejection by passing an error rather than by
 * throwing. Sharing one function keeps the two paths from giving different reasons for the same
 * file — the earlier version let multer drop a PDF silently, and the user was then told "no file
 * was uploaded", which is both unhelpful and untrue.
 */
export function rejectionForMimeType(mimeType: string): AppError | null {
  if (INVOICE_MIME_TYPES.includes(mimeType as InvoiceMimeType)) return null;

  const accepted = INVOICE_MIME_TYPES.join(', ');
  return AppError.badRequest(
    mimeType === 'application/pdf'
      ? `PDF invoices are not supported yet — the OCR engine reads images. Photograph the invoice, or screenshot the PDF, and upload that instead. Accepted types: ${accepted}.`
      : `Unsupported file type "${mimeType}". Accepted types: ${accepted}.`,
  );
}

/** Rejects a file the OCR path cannot read, before anything touches storage. */
export function assertAcceptableUpload(mimeType: string, size: number): InvoiceMimeType {
  const rejection = rejectionForMimeType(mimeType);
  if (rejection) throw rejection;

  if (size <= 0) {
    throw AppError.badRequest('The uploaded file is empty.');
  }

  const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (size > limit) {
    throw AppError.badRequest(
      `That file is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${env.MAX_UPLOAD_MB} MB.`,
    );
  }

  return mimeType as InvoiceMimeType;
}

/** A fresh storage key for a file of this type. Shared, so both backends name files alike. */
function newStorageKey(mimeType: InvoiceMimeType): string {
  return `${randomUUID()}.${INVOICE_EXTENSIONS[mimeType]}`;
}

/**
 * Reject a key that is not one of ours.
 *
 * Keys are generated here, so this should be unreachable — but it is the difference between a bug
 * and an arbitrary-file read if a key ever reaches us from a request. Enforced for both backends:
 * a traversal sequence is a URL-injection bug against Supabase just as much as a filesystem one
 * against the disk driver.
 */
const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i;

function assertSafeKey(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw AppError.badRequest('Invalid file reference.');
  }
  return storageKey;
}

// ---------------------------------------------------------------------------------------------
// Disk backend
// ---------------------------------------------------------------------------------------------

/** Absolute path for a storage key, guarding against a key that tries to escape the directory. */
function resolveKey(storageKey: string): string {
  const root = path.resolve(env.UPLOAD_DIR);
  const full = path.resolve(root, assertSafeKey(storageKey));

  // Defence in depth, on top of the key pattern above.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw AppError.badRequest('Invalid file reference.');
  }
  return full;
}

const disk = {
  async store(bytes: Buffer, mimeType: InvoiceMimeType) {
    const root = path.resolve(env.UPLOAD_DIR);
    await mkdir(root, { recursive: true });

    const storageKey = newStorageKey(mimeType);
    await writeFile(path.join(root, storageKey), bytes);

    return { storageKey, size: bytes.byteLength };
  },

  stream(storageKey: string): Readable {
    return createReadStream(resolveKey(storageKey));
  },

  bytes(storageKey: string): Promise<Buffer> {
    return readFile(resolveKey(storageKey));
  },

  async exists(storageKey: string): Promise<boolean> {
    try {
      const info = await stat(resolveKey(storageKey));
      return info.isFile();
    } catch {
      return false;
    }
  },

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(resolveKey(storageKey));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      // Worth knowing about (disk full, permissions) but not worth failing the user's delete over.
      logger.warn({ err, storageKey }, 'Could not delete invoice file');
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Supabase Storage backend
// ---------------------------------------------------------------------------------------------

/**
 * Supabase's Storage REST API, called with `fetch` rather than through `@supabase/supabase-js`.
 *
 * The SDK would add a dependency — plus the auth, realtime and postgrest clients bundled with it
 * — to reach four endpoints that are each a single request. On a serverless host every megabyte
 * of bundle is cold-start latency, and Prisma's query engine already spends most of that budget.
 */
function supabaseEndpoint(storageKey: string, kind: 'object' | 'info' = 'object'): string {
  const base = env.SUPABASE_URL!.replace(/\/+$/, '');
  const segment = kind === 'info' ? 'object/info' : 'object';
  // The bucket name is ours (env-configured, not user input); the key is pattern-checked above.
  return `${base}/storage/v1/${segment}/${env.SUPABASE_STORAGE_BUCKET}/${assertSafeKey(storageKey)}`;
}

function supabaseHeaders(): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  // Storage wants both: `apikey` identifies the project, `Authorization` carries the role.
  return { apikey: key, Authorization: `Bearer ${key}` };
}

const supabase = {
  async store(bytes: Buffer, mimeType: InvoiceMimeType) {
    const storageKey = newStorageKey(mimeType);

    const response = await fetch(supabaseEndpoint(storageKey), {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        'Content-Type': mimeType,
        // Keys are fresh UUIDs, so an existing object means a collision we want to hear about.
        'x-upsert': 'false',
      },
      body: new Uint8Array(bytes),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, detail, bucket: env.SUPABASE_STORAGE_BUCKET },
        'Supabase Storage upload failed',
      );
      // The user cannot act on a storage outage; do not leak the bucket or the response body.
      throw AppError.internal('Could not store the uploaded file. Please try again.');
    }

    return { storageKey, size: bytes.byteLength };
  },

  stream(storageKey: string): Readable {
    /*
     * `Readable.from` over an async generator, rather than a promise of a stream: `getFile` sets
     * its headers and pipes synchronously, so it needs a stream object back immediately. A fetch
     * failure then surfaces as an `error` event on the stream — exactly what the caller already
     * handles for a file missing from disk.
     */
    return Readable.from(
      (async function* () {
        const response = await fetch(supabaseEndpoint(storageKey), {
          headers: supabaseHeaders(),
        });
        if (!response.ok || !response.body) {
          throw new Error(`Supabase Storage download failed with ${response.status}`);
        }
        // Web ReadableStream → async iterable of chunks.
        yield* Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      })(),
    );
  },

  async bytes(storageKey: string): Promise<Buffer> {
    const response = await fetch(supabaseEndpoint(storageKey), { headers: supabaseHeaders() });
    if (!response.ok) {
      throw AppError.notFound('The stored file for this invoice could not be read.');
    }
    return Buffer.from(await response.arrayBuffer());
  },

  async exists(storageKey: string): Promise<boolean> {
    try {
      // `object/info` returns metadata only — cheaper than pulling the bytes just to prove they
      // are there, which matters because `getFile` and `retry` both check before reading.
      const response = await fetch(supabaseEndpoint(storageKey, 'info'), {
        headers: supabaseHeaders(),
      });
      return response.ok;
    } catch (err) {
      logger.warn({ err, storageKey }, 'Could not check invoice file in Supabase Storage');
      return false;
    }
  },

  async remove(storageKey: string): Promise<void> {
    try {
      const response = await fetch(supabaseEndpoint(storageKey), {
        method: 'DELETE',
        headers: supabaseHeaders(),
      });
      // 404 is success for our purposes — see the note on `deleteInvoiceFile`.
      if (!response.ok && response.status !== 404) {
        logger.warn(
          { status: response.status, storageKey },
          'Could not delete invoice file from Supabase Storage',
        );
      }
    } catch (err) {
      logger.warn({ err, storageKey }, 'Could not delete invoice file from Supabase Storage');
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Public API — the rest of the module never names a backend
// ---------------------------------------------------------------------------------------------

const backend = storageDriver === 'supabase' ? supabase : disk;

/**
 * Write the upload and return its storage key.
 *
 * The key — not a path and not a URL — is what goes in the database, so moving the files later
 * does not require rewriting rows.
 */
export function storeInvoiceFile(
  bytes: Buffer,
  mimeType: InvoiceMimeType,
): Promise<{ storageKey: string; size: number }> {
  return backend.store(bytes, mimeType);
}

/** A readable stream of a stored file, for the download route. */
export function readInvoiceFile(storageKey: string): Readable {
  return backend.stream(storageKey);
}

/**
 * The whole file as a buffer, for re-running OCR.
 *
 * Goes through the backend rather than reading `UPLOAD_DIR` directly — the retry route used to do
 * the latter, which quietly tied the feature to the disk driver.
 */
export function readInvoiceBytes(storageKey: string): Promise<Buffer> {
  return backend.bytes(storageKey);
}

/** Whether the bytes behind a row are still in storage. */
export function invoiceFileExists(storageKey: string): Promise<boolean> {
  return backend.exists(storageKey);
}

/**
 * Delete a stored file.
 *
 * A missing file is not an error: the row is the record of truth, and failing a delete because
 * the bytes were already gone would leave rows that can never be removed.
 */
export function deleteInvoiceFile(storageKey: string): Promise<void> {
  return backend.remove(storageKey);
}
