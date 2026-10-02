import { Prisma, type invoice_status } from '@prisma/client';

import { INVOICE_DEFAULT_CATEGORY, type InvoiceMimeType } from '../../config/constants.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/prisma.js';
import type { AuthenticatedUser } from '../../types/index.js';
import { AppError } from '../../utils/AppError.js';
import { assertCategoryCompatible } from '../transactions/service.js';
import { extractInvoiceFields, type InvoiceExtraction } from './extract.js';
import { OcrError, recognise } from './ocr.js';
import type { ConfirmInvoiceInput, ListInvoicesQuery } from './schema.js';
import { deleteInvoiceFile, storeInvoiceFile } from './storage.js';

/**
 * The invoice pipeline.
 *
 *   upload → store → OCR → extract → draft → **user verifies** → transaction
 *
 * The load-bearing rule in this file: **an unverified draft is never a transaction.** OCR output
 * lands in `invoices.ocr_extracted_data` and nowhere else. `transactions` gains a row only in
 * `confirmInvoice`, from values the user submitted. If drafts were written as real transactions
 * and flagged "unverified" instead, every cash-position and by-category report would have to
 * filter them out correctly forever — and the first place that forgot would silently overstate
 * the company's money. Keeping drafts out of the ledger entirely means no report can be wrong.
 *
 * `status` is the pipeline state; see the enum in the migration. The only transition that writes
 * money is READY|FAILED → CONFIRMED, and it is a compare-and-set inside a database transaction.
 */

/** The draft the review screen renders, assembled from the stored extraction. */
export interface InvoiceDraft extends InvoiceExtraction {
  /** Pre-selected category id, when the default category exists. Only ever a suggestion. */
  suggestedCategoryId: number | null;
  /** Mean OCR confidence, 0-100, or null when OCR never ran. */
  ocrConfidence: number | null;
}

type InvoiceRow = Prisma.invoicesGetPayload<object>;

/** Shape persisted in the `ocr_extracted_data` JSONB column. */
interface StoredExtraction extends InvoiceExtraction {
  ocrConfidence: number | null;
  /** Schema marker, so a future extraction format can be told apart from this one. */
  version: 1;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export function listInvoices(query: ListInvoicesQuery) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.transactionId !== undefined ? { transaction_id: query.transactionId } : {}),
  };

  return prisma.invoices.findMany({
    ...(Object.keys(where).length > 0 ? { where } : {}),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
}

/** One invoice, or 404. Every authenticated user may read every invoice (there are no roles). */
export async function getInvoiceOr404(id: number): Promise<InvoiceRow> {
  const invoice = await prisma.invoices.findUnique({ where: { id } });
  if (!invoice) throw AppError.notFound('Invoice not found');
  return invoice;
}

/**
 * Rebuild the reviewable draft for an invoice.
 *
 * Returns null before OCR has produced anything. A FAILED invoice still gets a draft — an empty
 * one — because the user can complete it by hand, which is the whole fallback when OCR cannot
 * read a photo.
 */
export async function getInvoiceDraft(invoice: InvoiceRow): Promise<InvoiceDraft | null> {
  if (invoice.status === 'PENDING' || invoice.status === 'PROCESSING') return null;

  const stored = invoice.ocr_extracted_data as StoredExtraction | null;
  const suggestedCategoryId = await findDefaultCategoryId();

  if (!stored) {
    // FAILED with nothing extracted: hand back an empty draft so the form still renders.
    return {
      supplierName: null,
      supplierId: null,
      invoiceDate: null,
      totalAmount: null,
      currency: null,
      invoiceNumber: null,
      missingFields: ['supplierName', 'invoiceDate', 'totalAmount', 'currency', 'invoiceNumber'],
      suggestedCategoryId,
      ocrConfidence: null,
    };
  }

  return {
    supplierName: stored.supplierName ?? null,
    supplierId: stored.supplierId ?? null,
    invoiceDate: stored.invoiceDate ?? null,
    totalAmount: stored.totalAmount ?? null,
    currency: stored.currency ?? null,
    invoiceNumber: stored.invoiceNumber ?? null,
    missingFields: stored.missingFields ?? [],
    suggestedCategoryId,
    ocrConfidence: stored.ocrConfidence ?? null,
  };
}

/** The category an invoice draft is pre-filled with, or null if it is not seeded. */
async function findDefaultCategoryId(): Promise<number | null> {
  const category = await prisma.categories.findFirst({
    where: { name: INVOICE_DEFAULT_CATEGORY },
    select: { id: true },
  });
  return category?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------

/**
 * Store an upload and queue it for OCR.
 *
 * Returns as soon as the bytes are safely on disk and the row exists, with status PENDING. OCR
 * takes a few seconds per page and is **not** awaited here — holding the HTTP request open for it
 * would risk a proxy timeout and would make the upload feel broken on a slow phone connection.
 * The client polls `GET /api/invoices/:id` and watches `status` instead.
 */
export async function createInvoice(
  file: { bytes: Buffer; mimeType: InvoiceMimeType; originalName?: string | undefined },
  actor: AuthenticatedUser,
): Promise<InvoiceRow> {
  const { storageKey, size } = await storeInvoiceFile(file.bytes, file.mimeType);

  let invoice: InvoiceRow;
  try {
    invoice = await prisma.invoices.create({
      data: {
        // `image_url` holds the storage key, not a URL — see the column comment in the migration.
        image_url: storageKey,
        mime_type: file.mimeType,
        file_size: size,
        original_filename: file.originalName ?? null,
        uploaded_by: actor.id,
        status: 'PENDING',
      },
    });
  } catch (err) {
    // The row is the only record that the file exists; without it the bytes are unreachable.
    await deleteInvoiceFile(storageKey);
    throw err;
  }

  // Fire and forget, with the error captured on the row rather than thrown into the void.
  void runOcrPipeline(invoice.id, file.bytes);

  return invoice;
}

/**
 * OCR one invoice and store the extraction. Never throws — every outcome is written to the row.
 *
 * Takes the bytes directly on the upload path so it does not re-read what it just wrote; the
 * retry path passes a buffer read back from disk.
 */
export async function runOcrPipeline(invoiceId: number, bytes: Buffer): Promise<void> {
  // Compare-and-set into PROCESSING. If another run already claimed it, stop — this is what keeps
  // a double-submitted retry from running two workers over the same page.
  const claimed = await prisma.invoices.updateMany({
    where: { id: invoiceId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'PROCESSING', ocr_error: null, updated_at: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    const result = await recognise(bytes);

    // Known suppliers are the strongest signal for the issuer, and give the FK the draft needs.
    const known = await prisma.suppliers.findMany({ select: { id: true, name: true } });
    const extraction = extractInvoiceFields(result.text, known);

    const stored: StoredExtraction = {
      ...extraction,
      ocrConfidence: result.confidence,
      version: 1,
    };

    await prisma.invoices.update({
      where: { id: invoiceId },
      data: {
        status: 'READY',
        ocr_raw_text: result.text,
        ocr_extracted_data: stored as unknown as Prisma.InputJsonValue,
        ocr_model: result.engine,
        ocr_completed_at: new Date(),
        ocr_error: null,
        updated_at: new Date(),
      },
    });

    logger.info(
      { invoiceId, confidence: result.confidence, missing: extraction.missingFields },
      'Invoice OCR complete',
    );
  } catch (err) {
    const message =
      err instanceof OcrError
        ? err.message
        : 'OCR failed unexpectedly. You can still enter the invoice details by hand.';

    logger.warn({ err, invoiceId }, 'Invoice OCR failed');

    await prisma.invoices
      .update({
        where: { id: invoiceId },
        data: { status: 'FAILED', ocr_error: message, updated_at: new Date() },
      })
      .catch((updateErr: unknown) => {
        // Nothing left to do but say so: the row stays PROCESSING and the retry route can reclaim
        // it (PROCESSING is excluded from the claim, so this needs the manual reset below).
        logger.error({ err: updateErr, invoiceId }, 'Could not record OCR failure');
      });
  }
}

/**
 * Re-run OCR on an invoice.
 *
 * Also the escape hatch for a row stuck in PROCESSING — if the process died mid-read, nothing
 * else would ever move it on, so a retry resets it first.
 */
export async function retryOcr(id: number, bytes: Buffer): Promise<InvoiceRow> {
  const invoice = await getInvoiceOr404(id);

  if (invoice.status === 'CONFIRMED') {
    throw AppError.conflict(
      'This invoice is already confirmed and linked to a transaction. Re-reading it would not change anything.',
    );
  }

  if (invoice.status === 'PROCESSING') {
    await prisma.invoices.update({
      where: { id },
      data: { status: 'PENDING', updated_at: new Date() },
    });
  }

  await runOcrPipeline(id, bytes);
  return getInvoiceOr404(id);
}

// ---------------------------------------------------------------------------------------------
// Confirm — the only path that writes money
// ---------------------------------------------------------------------------------------------

/**
 * Turn a reviewed invoice into a transaction.
 *
 * Everything that makes this safe is here:
 *
 *  - **The values are the user's**, taken from the request, never from `ocr_extracted_data`.
 *  - **The category rule is the shared one** — `assertCategoryCompatible` from the transactions
 *    module — so an invoice cannot save a transaction the expense form would have rejected.
 *  - **Insert and link are one database transaction.** A transaction row with no invoice link, or
 *    an invoice marked CONFIRMED with no transaction, are both corrupt states; neither is
 *    reachable because either both happen or neither does.
 *  - **Confirming twice is a 409, not a duplicate expense.** The status check is a compare-and-set
 *    *inside* the transaction, so two concurrent confirms cannot both pass it. Checking before
 *    `$transaction` would leave a window where both requests read READY and both insert.
 */
export async function confirmInvoice(
  id: number,
  input: ConfirmInvoiceInput,
  actor: AuthenticatedUser,
) {
  const invoice = await getInvoiceOr404(id);

  if (invoice.status === 'CONFIRMED') {
    throw AppError.conflict(
      `Invoice ${id} has already been confirmed as transaction ${invoice.transaction_id}.`,
    );
  }
  if (invoice.status === 'PENDING' || invoice.status === 'PROCESSING') {
    throw AppError.conflict(
      'This invoice is still being read. Wait for the extraction to finish, then review it.',
    );
  }

  // The same rule the expense form enforces, from the same function.
  await assertCategoryCompatible(input.categoryId, input.type);

  if (input.supplierId !== undefined) {
    const supplier = await prisma.suppliers.findUnique({
      where: { id: input.supplierId },
      select: { id: true },
    });
    if (!supplier) throw AppError.badRequest(`supplierId ${input.supplierId} does not exist`);
  }

  return prisma.$transaction(async (tx) => {
    // Compare-and-set: only a row still awaiting review can be claimed. A concurrent confirm
    // that got here first leaves count 0, and this request fails instead of double-booking.
    const claimed = await tx.invoices.updateMany({
      where: { id, status: { in: ['READY', 'FAILED'] } },
      data: { status: 'CONFIRMED', updated_at: new Date() },
    });
    if (claimed.count === 0) {
      throw AppError.conflict(
        'This invoice was confirmed by someone else a moment ago. Reload to see the transaction.',
      );
    }

    const transaction = await tx.transactions.create({
      data: {
        user_id: actor.id,
        category_id: input.categoryId,
        type: input.type,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        description: buildDescription(input),
        transaction_date: input.transactionDate,
        ...(input.paymentMethod !== undefined ? { payment_method: input.paymentMethod } : {}),
        supplier_id: input.supplierId ?? null,
        product_id: input.productId ?? null,
        packaging_id: input.packagingId ?? null,
      },
    });

    const linked = await tx.invoices.update({
      where: { id },
      data: { transaction_id: transaction.id, updated_at: new Date() },
    });

    logger.info(
      { invoiceId: id, transactionId: transaction.id, userId: actor.id.toString() },
      'Invoice confirmed and transaction created',
    );

    return { invoice: linked, transaction };
  });
}

/**
 * The transaction's description.
 *
 * Falls back to the invoice reference so a confirmed expense is traceable to the paper from the
 * transactions list, without opening the attachment.
 */
function buildDescription(input: ConfirmInvoiceInput): string | null {
  if (input.description) return input.description;
  if (input.invoiceNumber) return `Invoice ${input.invoiceNumber}`;
  return null;
}

/**
 * File an uploaded invoice against a transaction that already exists.
 *
 * Creates nothing: the ledger is untouched, only the attachment is recorded. This is what makes
 * it safe to migrate attachments captured before uploads existed — those were keyed to a
 * transaction the user had already saved, so re-confirming them as new drafts would book every
 * one of them twice.
 *
 * `transaction_id` is UNIQUE, so a transaction holds at most one invoice; a second attempt is a
 * 409 rather than a silent overwrite of the first receipt.
 */
export async function linkInvoiceToTransaction(id: number, transactionId: number) {
  const invoice = await getInvoiceOr404(id);

  if (invoice.status === 'CONFIRMED') {
    throw AppError.conflict(
      `Invoice ${id} is already linked to transaction ${invoice.transaction_id}.`,
    );
  }

  const transaction = await prisma.transactions.findUnique({
    where: { id: transactionId },
    select: { id: true },
  });
  if (!transaction) {
    throw AppError.badRequest(`transactionId ${transactionId} does not exist`);
  }

  const existing = await prisma.invoices.findUnique({
    where: { transaction_id: transactionId },
    select: { id: true },
  });
  if (existing) {
    throw AppError.conflict(
      `Transaction ${transactionId} already has invoice ${existing.id} attached.`,
    );
  }

  return prisma.invoices.update({
    where: { id },
    data: { transaction_id: transactionId, status: 'CONFIRMED', updated_at: new Date() },
  });
}

// ---------------------------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------------------------

/**
 * Delete an invoice and its file.
 *
 * A confirmed invoice is refused: the transaction is real money and the image is its evidence, so
 * discarding the evidence while keeping the entry should be a deliberate act on the transaction,
 * not a side effect of tidying the invoice queue. Deleting the *transaction* still cascades to the
 * invoice row, which is the intended way to remove both.
 */
export async function deleteInvoice(id: number): Promise<void> {
  const invoice = await getInvoiceOr404(id);

  if (invoice.status === 'CONFIRMED') {
    throw AppError.conflict(
      `Invoice ${id} is the record for transaction ${invoice.transaction_id}. Delete that transaction instead — the attachment goes with it.`,
    );
  }

  await prisma.invoices.delete({ where: { id } });
  await deleteInvoiceFile(invoice.image_url);
}

/** Statuses that mean "still waiting for a person", for the badge counts the UI shows. */
export const AWAITING_REVIEW: invoice_status[] = ['PENDING', 'PROCESSING', 'READY', 'FAILED'];

export async function countAwaitingReview(): Promise<number> {
  return prisma.invoices.count({ where: { status: { in: AWAITING_REVIEW } } });
}
