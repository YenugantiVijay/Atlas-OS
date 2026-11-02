import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { dashboardService } from '@/services/dashboard.service';
import { invoicesService } from '@/services/invoices.service';
import { auditService } from '@/services/audit.service';

vi.mock('@/features/organizations/OrgContext', () => {
  const currentOrg = { id: 'org-1' };
  return { useOrg: () => ({ currentOrg, isMockAuth: false }) };
});
vi.mock('@/services/dashboard.service', () => ({ dashboardService: { getDashboardMetrics: vi.fn() } }));
vi.mock('@/services/orders.service', () => ({ ordersService: { getSalesOrders: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/services/products.service', () => ({ productsService: { getProducts: vi.fn().mockResolvedValue([]) } }));
vi.mock('@/services/invoices.service', () => ({ invoicesService: { getInvoices: vi.fn() } }));
vi.mock('@/services/audit.service', () => ({ auditService: { getAuditEvents: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('shows a recoverable dashboard error instead of an endless skeleton', async () => {
  vi.mocked(dashboardService.getDashboardMetrics).mockRejectedValue(new Error('Metrics unavailable'));
  vi.mocked(invoicesService.getInvoices).mockResolvedValue([]);
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Metrics unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(dashboardService.getDashboardMetrics).toHaveBeenCalledTimes(2));
});

it.each([
  ['invoices', InvoicesPage, invoicesService.getInvoices, 'No invoices found'],
  ['audit', AuditPage, auditService.getAuditEvents, 'No audit events found'],
] as const)('shows a failure and retries %s instead of treating it as an empty dataset', async (_name, Page, load, emptyText) => {
  vi.mocked(load).mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValue([]);
  render(<Page />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
  expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(load).toHaveBeenCalledTimes(2);
});
