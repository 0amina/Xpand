import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  INVOICE_EXTENSIONS,
  INVOICE_MIME_TYPES,
  type InvoiceMimeType,
} from '../../config/constants.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/AppError.js';

/**
 * Where invoice files live on disk.
 *
 * Files are stored under `UPLOAD_DIR` with a generated name and served only through
 * `GET /api/invoices/:id/file`, never as static assets. That is deliberate: mounting the
 * directory with `express.static` would put every receipt the company has behind a guessable URL
 * with no authentication in front of it.
 *
 * The stored name is a UUID, not the user's filename. Two reasons — the original is attacker
 * controlled (`../../.env` is a filename), and two phones both uploading `IMG_0001.jpg` must not
 * collide. The original is kept in a column for display only.
 */

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

/** Rejects a file the OCR path cannot read, before anything touches the disk. */
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

/** Absolute path for a storage key, guarding against a key that tries to escape the directory. */
function resolveKey(storageKey: string): string {
  const root = path.resolve(env.UPLOAD_DIR);
  const full = path.resolve(root, storageKey);

  // Defence in depth. Keys are generated here, so this should be unreachable — but it is the
  // difference between a bug and an arbitrary-file-read if a key ever comes from a request.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw AppError.badRequest('Invalid file reference.');
  }
  return full;
}

/**
 * Write the upload and return its storage key.
 *
 * The key — not a path and not a URL — is what goes in the database, so moving `UPLOAD_DIR`
 * later does not require rewriting rows.
 */
export async function storeInvoiceFile(
  bytes: Buffer,
  mimeType: InvoiceMimeType,
): Promise<{ storageKey: string; size: number }> {
  const root = path.resolve(env.UPLOAD_DIR);
  await mkdir(root, { recursive: true });

  const storageKey = `${randomUUID()}.${INVOICE_EXTENSIONS[mimeType]}`;
  await writeFile(path.join(root, storageKey), bytes);

  return { storageKey, size: bytes.byteLength };
}

/** A readable stream of a stored file, for the download route. */
export function readInvoiceFile(storageKey: string): ReadStream {
  return createReadStream(resolveKey(storageKey));
}

/** Whether the bytes behind a row are still on disk. */
export async function invoiceFileExists(storageKey: string): Promise<boolean> {
  try {
    const info = await stat(resolveKey(storageKey));
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Delete a stored file.
 *
 * A missing file is not an error: the row is the record of truth, and failing a delete because
 * the bytes were already gone would leave rows that can never be removed.
 */
export async function deleteInvoiceFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    // Worth knowing about (disk full, permissions) but not worth failing the user's delete over.
    logger.warn({ err, storageKey }, 'Could not delete invoice file');
  }
}
