import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, getWithMeta, stripUndefined } from '@/lib/api';
import { todayISO } from '@/lib/format';
import { recordCategoryUse, recordPaymentMethod } from '@/lib/recent';
import type {
  ByCategoryQuery,
  Category,
  ConfirmInvoiceInput,
  CreateTransactionInput,
  EntityKind,
  Invoice,
  InvoiceFilters,
  Packaging,
  Product,
  ReportByCategory,
  ReportSummary,
  Supplier,
  SummaryQuery,
  Transaction,
  TransactionFilters,
  UpdateTransactionInput,
  User,
} from '@/types/api';

import { queryKeys } from './queryKeys';

// --- Users ---------------------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<User>('/api/users/me'),
    staleTime: 10 * 60_000, // A profile barely changes within a session.
  });
}

// --- Categories ----------------------------------------------------------------------------

/**
 * The full category list. Deliberately long-lived in cache: it is 11 fixed rows that rarely
 * change, and it is needed to render the name on *every* transaction row.
 */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: () => api.get<Category[]>('/api/categories'),
    staleTime: 30 * 60_000,
  });
}

/**
 * `id → Category`, for turning the `categoryId` on a transaction into a name and colour.
 * The list endpoint returns categories but transactions only carry the foreign key.
 */
export function useCategoryMap(): Map<number, Category> {
  const { data } = useCategories();
  return new Map((data ?? []).map((c) => [c.id, c]));
}

// --- Transactions --------------------------------------------------------------------------

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) =>
      api.get<Transaction[]>('/api/transactions', stripUndefined(filters), signal),
    // Keeps the previous page on screen while a filter change refetches, instead of flashing
    // an empty list — the filter bar stays usable and the layout doesn't jump.
    placeholderData: (previous) => previous,
  });
}

export function useTransaction(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? -1),
    queryFn: () => api.get<Transaction>(`/api/transactions/${id}`),
    enabled: id !== undefined && Number.isFinite(id),
  });
}

/**
 * Invalidate everything a write to `transactions` can affect: the lists, the detail, and
 * both reports (cash position and per-category totals are derived from the same rows).
 */
function useInvalidateTransactionData() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.transactions.all });
    void client.invalidateQueries({ queryKey: queryKeys.reports.all });
  };
}

export function useCreateTransaction() {
  const invalidate = useInvalidateTransactionData();

  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      api.post<Transaction>('/api/transactions', stripUndefined({ ...input })),
    onSuccess: (created) => {
      // Feed the chip ordering so the next entry needs fewer taps.
      recordCategoryUse(created.type, created.categoryId);
      recordPaymentMethod(created.paymentMethod);
      invalidate();
    },
  });
}

export function useUpdateTransaction() {
  const client = useQueryClient();
  const invalidate = useInvalidateTransactionData();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTransactionInput }) =>
      api.patch<Transaction>(`/api/transactions/${id}`, stripUndefined({ ...input })),
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.transactions.detail(updated.id), updated);
      invalidate();
    },
  });
}

export function useDeleteTransaction() {
  const client = useQueryClient();
  const invalidate = useInvalidateTransactionData();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/transactions/${id}`),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: queryKeys.transactions.detail(id) });
      invalidate();
    },
  });
}

// --- Reports -------------------------------------------------------------------------------

/**
 * The dashboard summary.
 *
 * `on` is pinned to the **client's** local date rather than left to default. The backend
 * derives "today" from the server clock in UTC, so without this a user in UTC+1 logging at
 * 00:30 would see yesterday's totals sitting above a form that files under today's date.
 */
export function useSummary(query: Omit<SummaryQuery, 'on'> & { on?: string } = {}) {
  const resolved: SummaryQuery = { ...query, on: query.on ?? todayISO() };

  return useQuery({
    queryKey: queryKeys.reports.summary(resolved),
    queryFn: ({ signal }) =>
      api.get<ReportSummary>('/api/reports/summary', stripUndefined({ ...resolved }), signal),
  });
}

export function useByCategory(query: ByCategoryQuery = {}) {
  return useQuery({
    queryKey: queryKeys.reports.byCategory(query),
    queryFn: ({ signal }) =>
      api.get<ReportByCategory>('/api/reports/by-category', stripUndefined({ ...query }), signal),
  });
}

// --- Suppliers / Products / Packaging --------------------------------------------------------
// Used only by the optional pickers on the expense form. `enabled` keeps them from firing
// until a picker is actually opened — no cost on the hot path.

export function useSuppliers(search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.entities.suppliers(search),
    queryFn: ({ signal }) =>
      api.get<Supplier[]>('/api/suppliers', stripUndefined({ search }), signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useProducts(search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.entities.products(search),
    queryFn: ({ signal }) =>
      api.get<Product[]>('/api/products', stripUndefined({ search }), signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function usePackaging(search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.entities.packaging(search),
    queryFn: ({ signal }) =>
      api.get<Packaging[]>('/api/packaging', stripUndefined({ search }), signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** REST path segment per entity kind — the three routes are otherwise identical. */
const ENTITY_PATH: Record<EntityKind, string> = {
  supplier: 'suppliers',
  product: 'products',
  packaging: 'packaging',
};

/**
 * Resolve one entity's display name from its id.
 *
 * A transaction carries `supplierId` / `productId` / `packagingId` but no names, so the detail
 * screen has to look them up. Detail endpoints embed their relationship links, which is more
 * than is needed here — only `name` is read.
 */
export function useEntityName(kind: EntityKind, id: number | null | undefined) {
  return useQuery({
    queryKey: ['entity', kind, id],
    queryFn: () => api.get<{ id: number; name: string }>(`/api/${ENTITY_PATH[kind]}/${id}`),
    enabled: id !== null && id !== undefined,
    staleTime: 10 * 60_000,
    // A referenced entity that has since been deleted would 404 forever; don't retry it.
    retry: false,
  });
}

// --- Invoices ------------------------------------------------------------------------------

/**
 * The invoice queue, newest first.
 *
 * `meta.awaitingReview` rides along on the same response so the tab badge does not need a second
 * request; it counts everything not yet CONFIRMED.
 */
export function useInvoices(filters: InvoiceFilters = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(filters),
    queryFn: ({ signal }) =>
      getWithMeta<Invoice[], { awaitingReview: number }>(
        '/api/invoices',
        stripUndefined(filters),
        signal,
      ),
    staleTime: 15_000,
  });
}

/**
 * The invoice filed against one transaction, or null.
 *
 * Returns the row rather than a boolean so the detail screen can render the image and link
 * straight to it.
 */
export function useInvoiceForTransaction(transactionId: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.invoices.list({ transactionId: transactionId ?? 0 }),
    queryFn: ({ signal }) =>
      getWithMeta<Invoice[], unknown>('/api/invoices', { transactionId }, signal),
    enabled: transactionId !== null && transactionId !== undefined,
    select: (envelope) => envelope.data[0] ?? null,
    staleTime: 60_000,
  });
}

/**
 * Which transactions have a receipt filed against them, as a Set of ids.
 *
 * One request for the whole list rather than one per row: the transaction list renders dozens of
 * rows and a per-row query would be dozens of requests for a paperclip icon. Only CONFIRMED
 * invoices carry a `transactionId`, so that status is the entire index.
 *
 * This loads every confirmed invoice, which is fine at this company's volume and would want a
 * dedicated count endpoint if the table ever grew large.
 */
export function useTransactionsWithInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices.linkedTransactions,
    queryFn: async ({ signal }) => {
      const envelope = await getWithMeta<Invoice[], unknown>(
        '/api/invoices',
        { status: 'CONFIRMED' },
        signal,
      );
      return new Set(
        envelope.data
          .map((invoice) => invoice.transactionId)
          .filter((id): id is number => id !== null),
      );
    },
    staleTime: 60_000,
  });
}

/**
 * One invoice, polled while OCR is still running.
 *
 * Upload responds immediately with PENDING and reads the page in the background, so the review
 * screen has to wait for the extraction. Polling stops the moment status leaves PENDING/PROCESSING
 * — an invoice that has settled never changes again on its own, so continuing to poll would just
 * burn requests for the life of the screen.
 */
export function useInvoice(id: number | null, options: { poll?: boolean } = {}) {
  const { poll = true } = options;

  return useQuery({
    queryKey: queryKeys.invoices.detail(id ?? 0),
    queryFn: () => api.get<Invoice>(`/api/invoices/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => {
      if (!poll) return false;
      const status = query.state.data?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 1500 : false;
    },
  });
}

/**
 * Upload an invoice image.
 *
 * Takes the **original** file, not a downscaled copy: Tesseract's accuracy falls off sharply on
 * small images, so compressing before upload would trade the thing the feature exists for against
 * a few hundred kilobytes.
 */
export function useUploadInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { file: File; onProgress?: (percent: number) => void }) =>
      api.upload<Invoice>('/api/invoices', args.file, { onProgress: args.onProgress }),
    onSuccess: (invoice) => {
      queryClient.setQueryData(queryKeys.invoices.detail(invoice.id), invoice);
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/** Re-run OCR on an invoice whose extraction failed or looked wrong. */
export function useRetryOcr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Invoice>(`/api/invoices/${id}/retry-ocr`),
    onSuccess: (invoice) => {
      queryClient.setQueryData(queryKeys.invoices.detail(invoice.id), invoice);
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/**
 * Confirm a reviewed invoice, creating the transaction.
 *
 * Invalidates transactions and reports as well as invoices: this is the moment money enters the
 * ledger, so the dashboard's cash position and every transaction list are now stale.
 */
export function useConfirmInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { id: number; input: ConfirmInvoiceInput }) =>
      api.post<{ invoice: Invoice; transaction: Transaction }>(
        `/api/invoices/${args.id}/confirm`,
        stripUndefined(args.input),
      ),
    onSuccess: (result) => {
      recordCategoryUse(result.transaction.type, result.transaction.categoryId);
      if (result.transaction.paymentMethod) recordPaymentMethod(result.transaction.paymentMethod);

      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
}

/** Discard an unconfirmed invoice and its stored file. */
export function useDeleteInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/invoices/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}
