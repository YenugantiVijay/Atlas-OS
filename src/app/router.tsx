import React from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { QuotationsPage } from '@/features/quotations/QuotationsPage';
import { OrdersPage } from '@/features/orders/OrdersPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { AIPage } from '@/features/ai/AIPage';
import { TeamPage } from '@/features/team/TeamPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SettingsPage } from '@/features/organizations/SettingsPage';

export const router = createHashRouter([
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
      { path: 'team', element: <TeamPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export const AppRouter: React.FC = () => {
  return <RouterProvider router={router} />;
};
