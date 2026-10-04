import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { TabBar } from '@/components/layout/TabBar';
import { EmptyState } from '@/components/ui/States';
import { BootError, BootLoading, DevSignIn } from '@/features/auth/BootScreens';
import { CatalogPage } from '@/features/catalog/CatalogPage';
import { ProductFormPage } from '@/features/catalog/ProductFormPage';
import { SupplierFormPage } from '@/features/catalog/SupplierFormPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { TransactionFormPage } from '@/features/entry/TransactionFormPage';
import { InvoiceReviewPage } from '@/features/invoices/InvoiceReviewPage';
import { PendingInvoicesPage } from '@/features/invoices/PendingInvoicesPage';
import { ScanInvoicePage } from '@/features/invoices/ScanInvoicePage';
import { TransactionDetailPage } from '@/features/transactions/TransactionDetailPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { useAuth } from '@/hooks/useAuth';

/** Routes that keep the bottom tab bar. Detail and edit screens are full-screen instead. */
const TABBED_ROUTES = ['/', '/add/income', '/add/expense', '/transactions'];

export function App() {
  const { status, error } = useAuth();
  const location = useLocation();

  // Each route is its own scroll context; without this, opening a transaction from halfway
  // down History lands you halfway down the detail screen.
  useEffect(() => {
    document.querySelector('.app__body')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (status === 'loading') return <BootLoading />;
  if (status === 'needs-dev-signin') return <DevSignIn />;
  if (status === 'error') return <BootError error={error} />;

  const showTabBar = TABBED_ROUTES.includes(location.pathname);

  return (
    <div className="app">
      <main className={`app__body ${showTabBar ? 'app__body--with-tabbar' : ''}`}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />

          {/* Income and expense are separate routes, not a mode toggle, so the tab bar can
              land directly on either — one tap from anywhere to start logging. */}
          <Route path="/add/:type" element={<TransactionFormPage mode="create" />} />

          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/transactions/:id" element={<TransactionDetailPage />} />
          <Route path="/transactions/:id/edit" element={<TransactionFormPage mode="edit" />} />

          {/* Suppliers and products. `/:id` is the edit form, not a read-only detail screen —
              these records are six fields and no history, so a detail view would only put the
              same information one tap further away. `new` is declared first so it is not
              swallowed by the `:id` pattern. */}
          <Route path="/suppliers" element={<CatalogPage kind="supplier" />} />
          <Route path="/suppliers/new" element={<SupplierFormPage mode="create" />} />
          <Route path="/suppliers/:id" element={<SupplierFormPage mode="edit" />} />
          <Route path="/products" element={<CatalogPage kind="product" />} />
          <Route path="/products/new" element={<ProductFormPage mode="create" />} />
          <Route path="/products/:id" element={<ProductFormPage mode="edit" />} />

          <Route path="/invoices" element={<PendingInvoicesPage />} />
          <Route path="/invoices/scan" element={<ScanInvoicePage />} />
          <Route path="/invoices/:id/review" element={<InvoiceReviewPage />} />
          {/* The queue used to live here; keep the path working for bot deep links and bookmarks. */}
          <Route path="/pending-invoices" element={<Navigate to="/invoices" replace />} />

          <Route
            path="*"
            element={
              <EmptyState
                icon="🧭"
                title="Page not found"
                description="That screen does not exist."
              />
            }
          />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showTabBar && <TabBar />}
    </div>
  );
}
