import type { Request, Response } from 'express';
import type { invoices as InvoiceModel } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import {
  confirmInvoiceSchema,
  invoiceIdParamSchema,
  linkInvoiceSchema,
  listInvoicesQuerySchema,
} from './schema.js';
import {
  confirmInvoice,
  countAwaitingReview,
  createInvoice,
  deleteInvoice,
  getInvoiceDraft,
  getInvoiceOr404,
  linkInvoiceToTransaction,
  listInvoices,
  retryOcr,
} from './service.js';
import { assertAcceptableUpload, invoiceFileExists, readInvoiceFile } from './storage.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';

/**
 * Map an invoice row to the API DTO.
 *
 * `image_url` is deliberately **not** exposed: it is a storage key, and publishing it would
 * invite clients to build their own file URLs. They get `fileUrl` instead, which routes through
 * the authenticated download endpoint.
 *
 * `ocrRawText` is also withheld from list/detail payloads — a page of transcription per invoice
 * would dominate the response for no benefit. It is available on its own endpoint for anyone
 * checking what the engine actually read.
 */
function toInvoiceDTO(invoice: InvoiceModel) {
  return {
    id: invoice.id,
    status: invoice.status,
    transactionId: invoice.transaction_id,
    uploadedBy: invoice.uploaded_by.toString(), // BigInt → string.
    mimeType: invoice.mime_type,
    fileSize: invoice.file_size,
    originalFilename: invoice.original_filename,
    fileUrl: `/api/invoices/${invoice.id}/file`,
    ocrError: invoice.ocr_error,
    ocrModel: invoice.ocr_model,
    ocrCompletedAt: invoice.ocr_completed_at?.toISOString() ?? null,
    createdAt: invoice.created_at.toISOString(),
    updatedAt: invoice.updated_at.toISOString(),
  };
}

/** POST /api/invoices — multipart upload. Responds before OCR runs; the client polls for status. */
export async function upload(req: Request, res: Response): Promise<void> {
  // `multer` puts the parsed file here. Absent means no `file` part was sent.
  const file = req.file;
  if (!file) {
    throw AppError.badRequest(
      'No file was uploaded. Send the image as multipart/form-data under the field name "file".',
    );
  }

  const mimeType = assertAcceptableUpload(file.mimetype, file.size);

  const invoice = await createInvoice(
    { bytes: file.buffer, mimeType, originalName: file.originalname },
    req.user!,
  );

  res.status(201).json({ data: toInvoiceDTO(invoice) });
}

/** GET /api/invoices — newest first, optionally filtered by `?status=`. */
export async function list(req: Request, res: Response): Promise<void> {
  const query = listInvoicesQuerySchema.parse(req.query);
  const invoices = await listInvoices(query);
  res.status(200).json({
    data: invoices.map(toInvoiceDTO),
    meta: { awaitingReview: await countAwaitingReview() },
  });
}

/**
 * GET /api/invoices/:id — the invoice plus its reviewable draft.
 *
 * This is the endpoint the client polls while status is PENDING or PROCESSING; `draft` is null
 * until the extraction lands.
 */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const invoice = await getInvoiceOr404(id);
  const draft = await getInvoiceDraft(invoice);

  res.status(200).json({ data: { ...toInvoiceDTO(invoice), draft } });
}

/** GET /api/invoices/:id/raw-text — what the OCR engine read, verbatim. */
export async function getRawText(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const invoice = await getInvoiceOr404(id);
  res.status(200).json({ data: { id: invoice.id, ocrRawText: invoice.ocr_raw_text } });
}

/**
 * GET /api/invoices/:id/file — the stored image.
 *
 * Behind `requireAuth` like everything else, which is the reason uploads are not served as static
 * files. `Content-Disposition: inline` so the review screen can render it in an `<img>`.
 */
export async function getFile(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const invoice = await getInvoiceOr404(id);

  if (!(await invoiceFileExists(invoice.image_url))) {
    // The row outlived its bytes — a restored database, a wiped UPLOAD_DIR. Say which, rather
    // than letting the stream emit an opaque ENOENT mid-response.
    throw AppError.notFound(
      'The stored file for this invoice is missing from the server. The record remains, but the image is gone.',
    );
  }

  res.setHeader('Content-Type', invoice.mime_type);
  res.setHeader('Content-Length', String(invoice.file_size));
  res.setHeader('Content-Disposition', 'inline');
  // Immutable: the bytes behind an invoice id never change.
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');

  const stream = readInvoiceFile(invoice.image_url);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** POST /api/invoices/:id/retry-ocr — read the page again. */
export async function retry(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const invoice = await getInvoiceOr404(id);

  if (!(await invoiceFileExists(invoice.image_url))) {
    throw AppError.notFound(
      'The stored file for this invoice is missing, so it cannot be re-read.',
    );
  }

  const bytes = await readFile(path.join(path.resolve(env.UPLOAD_DIR), invoice.image_url));
  const updated = await retryOcr(id, bytes);
  const draft = await getInvoiceDraft(updated);

  res.status(200).json({ data: { ...toInvoiceDTO(updated), draft } });
}

/**
 * POST /api/invoices/:id/confirm — the verification gate.
 *
 * The body carries the values the user reviewed. This is the only route in the module that
 * creates a transaction.
 */
export async function confirm(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const input = confirmInvoiceSchema.parse(req.body);

  const { invoice, transaction } = await confirmInvoice(id, input, req.user!);

  res.status(201).json({
    data: {
      invoice: toInvoiceDTO(invoice),
      transaction: {
        id: transaction.id,
        userId: transaction.user_id.toString(),
        categoryId: transaction.category_id,
        type: transaction.type,
        amount: transaction.amount.toString(),
        currency: transaction.currency,
        description: transaction.description,
        transactionDate: transaction.transaction_date.toISOString().slice(0, 10),
        paymentMethod: transaction.payment_method,
        supplierId: transaction.supplier_id,
        productId: transaction.product_id,
        packagingId: transaction.packaging_id,
        createdAt: transaction.created_at.toISOString(),
        updatedAt: transaction.updated_at.toISOString(),
      },
    },
  });
}

/**
 * POST /api/invoices/:id/link — attach this invoice to an existing transaction.
 *
 * Does not create a transaction. Used to file a receipt against an expense already logged by
 * hand, and to migrate attachments captured before uploads existed.
 */
export async function link(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  const { transactionId } = linkInvoiceSchema.parse(req.body);

  const invoice = await linkInvoiceToTransaction(id, transactionId);
  res.status(200).json({ data: toInvoiceDTO(invoice) });
}

/** DELETE /api/invoices/:id — discard an unconfirmed invoice and its file. */
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = invoiceIdParamSchema.parse(req.params);
  await deleteInvoice(id);
  res.status(204).send();
}
