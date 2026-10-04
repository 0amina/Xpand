import type {
  ByCategoryQuery,
  InvoiceFilters,
  SummaryQuery,
  TransactionFilters,
} from '@/types/api';

/**
 * Every cache key in one place, arranged as a hierarchy so a mutation can invalidate a whole
 * branch (`queryKeys.transactions.all`) without knowing which filter combinations happen to
 * be cached underneath it.
 */
export const queryKeys = {
  me: ['me'] as const,

  categories: {
    all: ['categories'] as const,
    list: () => ['categories', 'list'] as const,
  },

  transactions: {
    all: ['transactions'] as const,
    list: (filters: TransactionFilters) => ['transactions', 'list', filters] as const,
    detail: (id: number) => ['transactions', 'detail', id] as const,
  },

  reports: {
    all: ['reports'] as const,
    summary: (query: SummaryQuery) => ['reports', 'summary', query] as const,
    byCategory: (query: ByCategoryQuery) => ['reports', 'by-category', query] as const,
  },

  invoices: {
    all: ['invoices'] as const,
    list: (filters?: InvoiceFilters) => ['invoices', 'list', filters ?? {}] as const,
    detail: (id: number) => ['invoices', 'detail', id] as const,
    /** The set of transaction ids that have an invoice filed against them. */
    linkedTransactions: ['invoices', 'linked-transactions'] as const,
  },

  entities: {
    all: ['entities'] as const,
    suppliers: (search: string) => ['entities', 'suppliers', search] as const,
    supplier: (id: number) => ['entities', 'supplier', id] as const,
    products: (search: string) => ['entities', 'products', search] as const,
    product: (id: number) => ['entities', 'product', id] as const,
    packaging: (search: string) => ['entities', 'packaging', search] as const,
  },
} as const;
