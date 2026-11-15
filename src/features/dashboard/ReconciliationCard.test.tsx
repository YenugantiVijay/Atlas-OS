import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconciliationService } from '@/services/reconciliation.service';
import { ReconciliationCard } from './ReconciliationCard';

const asOf = '2026-11-14T00:00:00Z';
const stock = { asOf, productCount: 1, activeProductCount: 1, lowStockCount: 0, catalogCostValue: 20, lowStock: [] };
const finance = {
  asOf, invoiceCount: 1, receiptCount: 0, totalInvoiced: 100, totalPaid: 0, totalOutstanding: 100,
  varianceAmount: 0, totalPaymentsCollected: 0, totalAllocated: 0, unallocatedPayments: 0,
  receiptIssueCount: 0, discrepancyCount: 0, discrepancies: [], overdueCount: 0, overdueTotal: 0, overdue: [],
};

function renderCard(canSeeFinancialBalances = true) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>
    <ReconciliationCard orgId="org-1" userId="user-1" isMockAuth={false}
      canSeeFinancialBalances={canSeeFinancialBalances} />
  </QueryClientProvider>);
}

describe('ReconciliationCard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows unavailable on the first failure and keeps the stock result', async () => {
    vi.spyOn(reconciliationService, 'getStockLedgerSummary').mockResolvedValue(stock);
    vi.spyOn(reconciliationService, 'reconcileFinancials').mockRejectedValue(new Error('offline'));
    renderCard();
    expect(screen.getByRole('heading', { name: 'Invoices and Payment Allocations' }).parentElement).toHaveTextContent('Checking');
    expect(await screen.findByText('Unavailable')).toBeVisible();
    expect(await screen.findByText('Ledger available')).toBeVisible();
    expect(screen.queryByText('Reconciled')).not.toBeInTheDocument();
  });

  it('marks a prior result stale after a failed refresh and disables its detail view', async () => {
    vi.spyOn(reconciliationService, 'getStockLedgerSummary').mockResolvedValue(stock);
    vi.spyOn(reconciliationService, 'reconcileFinancials').mockResolvedValueOnce(finance)
      .mockRejectedValue(new Error('offline'));
    renderCard();
    expect(await screen.findByText('Reconciled')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/Stale.*refresh failed/)).toBeVisible();
    expect(screen.queryByText('Reconciled')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect Financials' })).not.toBeInTheDocument();
    expect(screen.getByText(/Last successful check/)).toBeVisible();
  });

  it('only offers stock details to a role outside finance', async () => {
    vi.spyOn(reconciliationService, 'getStockLedgerSummary').mockResolvedValue(stock);
    const handler = vi.spyOn(reconciliationService, 'reconcileFinancials');
    renderCard(false);
    expect(await screen.findByText('Ledger available')).toBeVisible();
    expect(handler).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region')).queryByText('Invoices and Payment Allocations')).not.toBeInTheDocument();
  });
});
