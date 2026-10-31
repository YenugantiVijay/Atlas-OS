import React from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout, RouteLoadingFallback } from '@/components/layout/AppLayout';
import { useOrg } from '@/features/organizations/OrgContext';
import { hasPermission, Action } from '@/lib/permissions';

// Code-split feature modules for production bundle optimization and fast initial shell render
const OnboardingPage = React.lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage }))
);
const DashboardPage = React.lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const ProductsPage = React.lazy(() =>
  import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage }))
);
const InventoryPage = React.lazy(() =>
  import('@/features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const CustomersPage = React.lazy(() =>
  import('@/features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage }))
);
const SuppliersPage = React.lazy(() =>
  import('@/features/suppliers/SuppliersPage').then((m) => ({ default: m.SuppliersPage }))
);
const QuotationsPage = React.lazy(() =>
  import('@/features/quotations/QuotationsPage').then((m) => ({ default: m.QuotationsPage }))
);
const OrdersPage = React.lazy(() =>
  import('@/features/orders/OrdersPage').then((m) => ({ default: m.OrdersPage }))
);
const InvoicesPage = React.lazy(() =>
  import('@/features/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage }))
);
const PaymentsPage = React.lazy(() =>
  import('@/features/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))
);
const AIPage = React.lazy(() =>
  import('@/features/ai/AIPage').then((m) => ({ default: m.AIPage }))
);
const TeamPage = React.lazy(() =>
  import('@/features/team/TeamPage').then((m) => ({ default: m.TeamPage }))
);
const AuditPage = React.lazy(() =>
  import('@/features/audit/AuditPage').then((m) => ({ default: m.AuditPage }))
);
const SettingsPage = React.lazy(() =>
  import('@/features/organizations/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

export interface RequirePermissionProps {
  action: Action;
  children: React.ReactElement;
}

export const RequirePermission: React.FC<RequirePermissionProps> = ({ action, children }) => {
  const { currentRole, isLoadingAuth, isLoadingOrgData } = useOrg();
  if (isLoadingAuth || isLoadingOrgData) {
    return null;
  }
  if (!hasPermission(currentRole, action)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

export const router = createHashRouter([
  {
    path: '/onboarding',
    element: (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <OnboardingPage />
      </React.Suspense>
    ),
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'suppliers', element: <SuppliersPage /> },
      { path: 'quotations', element: <QuotationsPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'ai', element: <AIPage /> },
      {
        path: 'team',
        element: (
          <RequirePermission action="members:manage">
            <TeamPage />
          </RequirePermission>
        ),
      },
      {
        path: 'audit',
        element: (
          <RequirePermission action="audit:read">
            <AuditPage />
          </RequirePermission>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequirePermission action="org:manage">
            <SettingsPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />;
};

