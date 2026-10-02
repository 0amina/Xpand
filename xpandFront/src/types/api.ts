/**
 * Types mirroring the Xpand backend's DTOs, one-to-one.
 *
 * Two conventions carried over from the API and worth remembering everywhere below:
 *
 *  - **Money is a string**, never a number. `transactions.amount` is `NUMERIC(12,2)` and the
 *    backend serializes Decimals via `.toString()` / `.toFixed(2)` to preserve precision.
 *    Parse with `toNumber()` from `lib/format` only for display or arithmetic you then
 *    round — never round-trip a float back into a write.
 *  - **User ids are strings.** `users.id` is a BIGINT (Telegram ids exceed 2^53), serialized
 *    as a string. Never coerce one to `number`.
 */

// --- Enums (mirror the Postgres enums) ---

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CATEGORY_TYPES = ['INCOME', 'EXPENSE', 'BOTH'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Matches `DEFAULT_CURRENCY` in the backend's config/constants.ts. */
export const DEFAULT_CURRENCY = 'TND';

// --- Envelope ---

/**
 * Every successful response is `{ data: ... }`.
 *
 * A few endpoints add `meta` for counts that would otherwise need a second request — the invoice
 * list carries `awaitingReview` this way. `request()` unwraps to `data`; use `getWithMeta` when
 * the sidecar is wanted.
 */
export interface ApiEnvelope<T, M = unknown> {
  data: T;
  meta?: M;
}

/** Every error response is `{ error: { message, statusCode, details? } }`. */
export interface ApiErrorBody {
  error: {
    message: string;
    statusCode: number;
    /** Zod issues on a 400 from validation; absent otherwise. */
    details?: unknown;
  };
}

// --- Users ---

export interface User {
  /** BIGINT serialized as a string. */
  id: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  createdAt: string;
}

export interface LoginInput {
  id: string | number;
  username?: string;
  firstName: string;
  lastName?: string;
}

// --- Invoices ---

export const INVOICE_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'CONFIRMED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** A value the OCR read, paired with the exact text it came from. */
export interface ExtractedField {
  value: string;
  /** The matching substring from the page. Shown beside the value so the user can check it. */
  raw: string;
}

/**
 * The reviewable draft. Every field is nullable — OCR fails partially far more often than it
 * fails completely, and a half-filled form is still faster than an empty one.
 */
export interface InvoiceDraft {
  supplierName: ExtractedField | null;
  /** Set only when the name matched a supplier already in the database. */
  supplierId: number | null;
  invoiceDate: ExtractedField | null;
  /** A 2-decimal string, like every other amount in this API. */
  totalAmount: ExtractedField | null;
  currency: ExtractedField | null;
  invoiceNumber: ExtractedField | null;
  /** Names of the fields OCR could not read, for highlighting. */
  missingFields: string[];
  suggestedCategoryId: number | null;
  /** Mean OCR confidence 0-100, or null when OCR never ran. */
  ocrConfidence: number | null;
}

export interface Invoice {
  id: number;
  status: InvoiceStatus;
  /** Set once confirmed or linked; null while the invoice is still a draft. */
  transactionId: number | null;
  uploadedBy: string;
  mimeType: string;
  fileSize: number;
  originalFilename: string | null;
  /** API-relative path. Needs the auth header, so fetch it rather than using it as a bare src. */
  fileUrl: string;
  ocrError: string | null;
  ocrModel: string | null;
  ocrCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the detail endpoint; null until OCR finishes. */
  draft?: InvoiceDraft | null;
}

/** Listing filters for `GET /api/invoices`. */
export interface InvoiceFilters {
  status?: InvoiceStatus;
  /** Find the invoice filed against one transaction. */
  transactionId?: number;
}

/** What the user submits after reviewing. These values — not the OCR's — become the ledger. */
export interface ConfirmInvoiceInput {
  categoryId: number;
  type: TransactionType;
  amount: string;
  currency: string;
  transactionDate: string;
  paymentMethod?: PaymentMethod;
  description?: string;
  supplierId?: number;
  productId?: number;
  packagingId?: number;
  invoiceNumber?: string;
}

// --- Categories ---

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
}

// --- Transactions ---

export interface Transaction {
  id: number;
  /** BIGINT serialized as a string. */
  userId: string;
  categoryId: number;
  type: TransactionType;
  /**
   * Decimal serialized as a string — but **not** zero-padded. The transactions controller
   * uses `Decimal.toString()`, so a 50.00 row comes back as `"50"` and 250.50 as `"250.5"`,
   * whereas the reports endpoints use `.toFixed(2)` and always pad. Always render through
   * `formatAmount()`, which normalises both to two decimals.
   */
  amount: string;
  currency: string;
  description: string | null;
  /** `YYYY-MM-DD` — the column is DATE, so there is no time component. */
  transactionDate: string;
  paymentMethod: PaymentMethod;
  supplierId: number | null;
  productId: number | null;
  packagingId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create payload. `amount` is a **number** here (the backend's Zod schema requires a JSON
 * number, > 0, at most 2 decimals) even though it comes back as a string.
 *
 * Optional fields are `optional`, not `nullable`: the backend rejects an explicit `null`.
 * Omit the key entirely rather than sending null — `stripUndefined` in `lib/api` enforces this.
 */
export interface CreateTransactionInput {
  categoryId: number;
  type: TransactionType;
  amount: number;
  /** `YYYY-MM-DD`. */
  transactionDate: string;
  currency?: string;
  description?: string;
  paymentMethod?: PaymentMethod;
  supplierId?: number;
  productId?: number;
  packagingId?: number;
}

/** Every field optional, but the backend rejects a completely empty body with a 400. */
export type UpdateTransactionInput = Partial<CreateTransactionInput>;

export interface TransactionFilters {
  /** Inclusive lower bound on `transactionDate` (`YYYY-MM-DD`). */
  from?: string;
  /** Inclusive upper bound on `transactionDate` (`YYYY-MM-DD`). */
  to?: string;
  categoryId?: number;
  type?: TransactionType;
  /** Narrows to one person's entries. Omitted — as the app always does — you get everyone's. */
  userId?: string;
}

// --- Reports ---

export interface PeriodTotals {
  income: string;
  expenses: string;
  net: string;
}

export interface ReportSummary {
  /** `YYYY-MM-DD` — the day "today" and "this month" are measured against. */
  referenceDate: string;
  currency: string;
  openingBalance: string;
  totalIncome: string;
  totalExpenses: string;
  /** `openingBalance + totalIncome − totalExpenses`, as of `referenceDate`. */
  cashPosition: string;
  netCashMovement: string;
  today: PeriodTotals & { date: string };
  month: PeriodTotals & { year: number; month: number };
}

export interface CategoryTotal {
  categoryId: number;
  categoryName: string | null;
  type: TransactionType;
  total: string;
  count: number;
}

export interface ReportByCategory {
  income: CategoryTotal[];
  expenses: CategoryTotal[];
}

export interface SummaryQuery {
  /** Reference date (`YYYY-MM-DD`). Defaults to the server's current date. */
  on?: string;
  /** Overrides the server's configured OPENING_BALANCE for this call only. */
  openingBalance?: number;
  userId?: string;
}

export interface ByCategoryQuery {
  from?: string;
  to?: string;
  type?: TransactionType;
  userId?: string;
}

// --- Suppliers / Products / Packaging ---
// Only the list-shape (no embedded relations) is modelled; the pickers never need more.

export interface Supplier {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  /** 2-decimal string, or null. */
  unitPrice: string | null;
  createdAt: string;
}

export interface Packaging {
  id: number;
  name: string;
  unit: string | null;
  /** 2-decimal string, or null. */
  unitCost: string | null;
  createdAt: string;
}

/** The three entity kinds that can optionally be attached to a transaction. */
export type EntityKind = 'supplier' | 'product' | 'packaging';
