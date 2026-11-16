import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { OwnerAssistant } from './OwnerAssistant';
import { OwnerOverviewScreen } from './OwnerOverview';
import { generateOwnerSummary, type OwnerOverview } from '@/services/owner-console.service';

vi.mock('@/services/owner-console.service', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/owner-console.service')>(),
  generateOwnerSummary: vi.fn(),
}));

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

describe('owner overview', () => {
  it('shows recorded purchase amounts, edition rankings and current warnings', () => {
    const navigate = vi.fn();
    const openAssistant = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <OwnerOverviewScreen snapshot={snapshot} navigate={navigate} openAssistant={openAssistant} />
    </QueryClientProvider>);
    const chart = within(screen.getByRole('region', { name: 'Monthly purchases' }));
    expect(chart.getByText('6', { exact: true })).toBeVisible();
    fireEvent.click(chart.getByRole('button', { name: 'Revenue' }));
    expect(chart.getByText('₹10,997.00', { exact: true })).toBeVisible();
    expect(screen.getByText('Professional')).toBeVisible();
    expect(screen.getByText(/urgent client report/)).toBeVisible();
    expect(screen.getByText(/Purchases fell/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open support inbox' }));
    expect(navigate).toHaveBeenLastCalledWith('tickets');
    fireEvent.click(screen.getByRole('button', { name: /Recorded this month/ }));
    expect(navigate).toHaveBeenLastCalledWith('purchases');
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscriptions' }));
    expect(navigate).toHaveBeenLastCalledWith('clients');
    fireEvent.click(screen.getByRole('button', { name: 'Open Atlas Assistant' }));
    expect(openAssistant).toHaveBeenCalledOnce();
  });
});

describe('owner assistant', () => {
  it('shows dashboard data and opens the relevant owner section', () => {
    const navigate = vi.fn();
    const close = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>
      <OwnerAssistant open onClose={close} snapshot={snapshot} overviewError={false} navigate={navigate} />
    </QueryClientProvider>);
    const panel = within(screen.getByRole('dialog', { name: 'Atlas Assistant' }));
    expect(panel.getByRole('button', { name: /urgent client report/ })).toBeVisible();
    fireEvent.click(panel.getByRole('button', { name: 'Review purchases' }));
    expect(panel.getByText(/2 recorded purchases, totalling/)).toHaveTextContent('₹4,998.00');
    expect(panel.getByText(/Professional leads/)).toBeVisible();
    fireEvent.click(panel.getByRole('button', { name: 'Check renewals' }));
    expect(panel.getByText(/1 subscription reaches/)).toBeVisible();
    fireEvent.click(panel.getByRole('button', { name: 'Review client reports' }));
    expect(panel.getByText('Export stalled')).toBeVisible();
    fireEvent.click(panel.getByRole('button', { name: 'Open support inbox' }));
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('tickets');
  });

  it('runs the AI brief only on demand and restores focus on Escape', async () => {
    const generateSummary = vi.mocked(generateOwnerSummary).mockResolvedValueOnce('Review the export report.');
    function Console() {
      const [open, setOpen] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open assistant</button>
        <OwnerAssistant open={open} onClose={() => setOpen(false)} snapshot={snapshot}
          overviewError={false} navigate={vi.fn()} />
      </>;
    }
    render(<QueryClientProvider client={new QueryClient()}><Console /></QueryClientProvider>);
    const launcher = screen.getByRole('button', { name: 'Open assistant' });
    launcher.focus();
    fireEvent.click(launcher);
    expect(screen.getByRole('button', { name: 'Close Atlas Assistant' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Summarise with AI' }));
    expect(generateSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText('Review the export report.')).toBeVisible();
    expect(generateSummary).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(launcher).toHaveFocus();
  });
});
