import React from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout, RouteLoadingFallback } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { isSpecialtyToolId } from '@/lib/industry-tools';
import { allowsIndustryRoute, useIndustryTool } from '@/hooks/useIndustryTool';
import { hasPermission, Action } from '@/lib/permissions';

// Code-split feature modules for production bundle optimization and fast initial shell render
const OnboardingPage = React.lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage }))
);
const TeamInvitationPage = React.lazy(() =>
  import('@/features/team/TeamInvitationPage').then((m) => ({ default: m.TeamInvitationPage }))
);
const SpecialtyWorkspace = React.lazy(() => import('@/features/industry/SpecialtyWorkspace'));
const DashboardPage = React.lazy(() =>
  import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const ProductsPage = React.lazy(() =>
  import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage }))
);
const ImportPreviewPage = React.lazy(() =>
  import('@/features/import-preview/ImportPreviewPage').then((m) => ({ default: m.ImportPreviewPage }))
);
const InventoryPage = React.lazy(() =>
  import('@/features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const GoodsReceivingPage = React.lazy(() =>
  import('@/features/receiving/GoodsReceivingPage').then((m) => ({ default: m.GoodsReceivingPage }))
);
const SupplierFollowUpPage = React.lazy(() =>
  import('@/features/receiving/SupplierFollowUpPage').then((m) => ({ default: m.SupplierFollowUpPage }))
);
const PurchaseOrdersPage = React.lazy(() =>
  import('@/features/purchasing/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage }))
);
const SupplierPriceHistoryPage = React.lazy(() =>
  import('@/features/pricing/SupplierPriceHistoryPage').then((m) => ({ default: m.SupplierPriceHistoryPage }))
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
const RetailPosPage = React.lazy(() =>
  import('@/features/pos/RetailPosPage').then((m) => ({ default: m.RetailPosPage }))
);
const CounterShiftPage = React.lazy(() =>
  import('@/features/pos/CounterShiftPage').then((m) => ({ default: m.CounterShiftPage }))
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
const StaffPaySetupPage = React.lazy(() =>
  import('@/features/team/StaffPaySetupPage').then((m) => ({ default: m.StaffPaySetupPage }))
);
const StaffAdvancesPage = React.lazy(() =>
  import('@/features/team/StaffAdvancesPage').then((m) => ({ default: m.StaffAdvancesPage }))
);
const StaffAttendancePage = React.lazy(() =>
  import('@/features/team/StaffAttendancePage').then((m) => ({ default: m.StaffAttendancePage }))
);
const AuditPage = React.lazy(() =>
  import('@/features/audit/AuditPage').then((m) => ({ default: m.AuditPage }))
);
const SalesReceiptsReportPage = React.lazy(() =>
  import('@/features/reports/SalesReceiptsReportPage').then((m) => ({ default: m.SalesReceiptsReportPage }))
);
const SettingsPage = React.lazy(() =>
  import('@/features/organizations/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const SupportReportsPage = React.lazy(() =>
  import('@/features/support/SupportReportsPage').then((m) => ({ default: m.SupportReportsPage }))
);
const IntegrationsPage = React.lazy(() =>
  import('@/features/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage }))
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

function WorkspaceHome() {
  const tool = useIndustryTool();
  return isSpecialtyToolId(tool?.id) ? <SpecialtyWorkspace /> : <DashboardPage />;
}

function IndustryRoute({ path, children }: { path: string; children: React.ReactElement }) {
  const tool = useIndustryTool();
  return allowsIndustryRoute(tool?.id, path) ? children : <Navigate to="/" replace />;
}

function RouteFailure() {
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-border bg-surface-card p-6" aria-labelledby="route-failure-title">
      <h1 id="route-failure-title" className="text-lg font-semibold text-content-primary">This page couldn’t load</h1>
      <p className="mt-2 text-sm text-content-secondary">Check your connection, then reload this page to continue.</p>
      <Button type="button" onClick={() => window.location.reload()} className="mt-4">
        Reload page
      </Button>
    </section>
  );
}

export const router = createHashRouter([
  {
    path: '/invite/:inviteId',
    errorElement: <RouteFailure />,
    element: <React.Suspense fallback={<RouteLoadingFallback />}><TeamInvitationPage /></React.Suspense>,
  },
  {
    path: '/onboarding',
    errorElement: <RouteFailure />,
    element: (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <OnboardingPage />
      </React.Suspense>
    ),
  },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteFailure />,
    children: [{
      errorElement: <RouteFailure />,
      children: [
        { index: true, element: <WorkspaceHome /> },
        { path: 'studio-jobs', element: <RequirePermission action="data:read"><IndustryRoute path="/studio-jobs"><SpecialtyWorkspace /></IndustryRoute></RequirePermission> },
        { path: 'ice-cream-counter', element: <RequirePermission action="data:read"><IndustryRoute path="/ice-cream-counter"><SpecialtyWorkspace /></IndustryRoute></RequirePermission> },
        { path: 'cold-chain', element: <RequirePermission action="data:read"><IndustryRoute path="/cold-chain"><SpecialtyWorkspace /></IndustryRoute></RequirePermission> },
        { path: 'products', element: <ProductsPage /> },
        { path: 'import-preview', element: <RequirePermission action="data:read"><ImportPreviewPage /></RequirePermission> },
        { path: 'inventory', element: <InventoryPage /> },
        { path: 'receiving', element: <RequirePermission action="inventory:receive"><GoodsReceivingPage /></RequirePermission> },
        { path: 'receiving/follow-up', element: <RequirePermission action="inventory:receive"><SupplierFollowUpPage /></RequirePermission> },
        { path: 'purchase-orders', element: <RequirePermission action="inventory:receive"><PurchaseOrdersPage /></RequirePermission> },
        { path: 'supplier-prices', element: <RequirePermission action="supplier-prices:read"><SupplierPriceHistoryPage /></RequirePermission> },
        { path: 'customers', element: <CustomersPage /> },
        { path: 'suppliers', element: <SuppliersPage /> },
        { path: 'quotations', element: <QuotationsPage /> },
        { path: 'orders', element: <OrdersPage key="all-orders" /> },
        { path: 'support', element: <SupportReportsPage /> },
        { path: 'ecommerce', element: <RequirePermission action="data:read"><IndustryRoute path="/ecommerce"><OrdersPage key="online-orders" onlineOnly /></IndustryRoute></RequirePermission> },
        { path: 'pos', element: <RequirePermission action="orders:create"><IndustryRoute path="/pos"><RetailPosPage /></IndustryRoute></RequirePermission> },
        { path: 'counter-shift', element: <RequirePermission action="orders:create"><IndustryRoute path="/counter-shift"><CounterShiftPage /></IndustryRoute></RequirePermission> },
        { path: 'invoices', element: <RequirePermission action="reports:financial"><InvoicesPage /></RequirePermission> },
        { path: 'payments', element: <RequirePermission action="reports:financial"><PaymentsPage /></RequirePermission> },
        { path: 'ai', element: <AIPage /> },
        {
          path: 'team',
          element: (
            <RequirePermission action="members:manage">
              <TeamPage />
            </RequirePermission>
          ),
        },
        { path: 'team/staff', element: <RequirePermission action="members:manage"><StaffPaySetupPage /></RequirePermission> },
        { path: 'team/advances', element: <RequirePermission action="members:manage"><StaffAdvancesPage /></RequirePermission> },
        { path: 'attendance', element: <StaffAttendancePage /> },
        {
          path: 'audit',
          element: (
            <RequirePermission action="audit:read">
              <AuditPage />
            </RequirePermission>
          ),
        },
        {
          path: 'reports/sales-receipts',
          element: (
            <RequirePermission action="reports:financial">
              <SalesReceiptsReportPage />
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
        {
          path: 'integrations',
          element: (
            <RequirePermission action="org:manage">
              <IntegrationsPage />
            </RequirePermission>
          ),
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    }],
  },
]);

export const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />;
};

