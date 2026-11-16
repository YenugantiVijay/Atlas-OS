import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerOverviewScreen } from './OwnerOverview';
import type { OwnerOverview } from '@/services/owner-console.service';

describe('owner overview', () => {
  it('shows recorded purchase amounts, edition rankings and current warnings', () => {
    const snapshot: OwnerOverview = {
      clients: 4, active: 2, open_reports: 3, urgent_reports: 1, overdue_reports: 2, due_renewals: 1,
      months: [
        { month: '2026-09', purchases: 3, revenue: 3500 },
        { month: '2026-10', purchases: 1, revenue: 2499 },
        { month: '2026-11', purchases: 2, revenue: 4998 },
      ],
      products: [{ product: 'professional', purchases: 3, revenue: 7497 }],
      recent_reports: [{ id: 'open-ticket', subject: 'Export stalled', source: 'erp', area: 'billing', priority: 'urgent', created_at: '2026-11-16' }],
      report_areas: [{ area: 'billing', reports: 3 }],
      updated_at: '2026-11-16',
    };
    const openReports = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <OwnerOverviewScreen snapshot={snapshot} openReports={openReports} />
    </QueryClientProvider>);
    const chart = within(screen.getByRole('region', { name: 'Monthly purchases' }));
    expect(chart.getByText('6', { exact: true })).toBeVisible();
    fireEvent.click(chart.getByRole('button', { name: 'Revenue' }));
    expect(chart.getByText('₹10,997.00', { exact: true })).toBeVisible();
    expect(screen.getByText('Professional')).toBeVisible();
    expect(screen.getByText(/urgent client report/)).toBeVisible();
    expect(screen.getByText(/Purchases fell/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open support inbox' }));
    expect(openReports).toHaveBeenCalledOnce();
  });
});
