import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/money';
import { METRIC_DEFINITIONS, reconciliationService } from '@/services/reconciliation.service';

interface ReconciliationCardProps {
  orgId: string;
  userId?: string;
  isMockAuth: boolean;
  canSeeFinancialBalances: boolean;
}

function checkState(query: {
  isFetching: boolean;
  isError: boolean;
  data?: { asOf: string };
}): string | undefined {
  if (query.isFetching) return 'Checking…';
  if (query.isError && query.data) return 'Stale · refresh failed';
  if (query.isError || !query.data) return 'Unavailable';
}

function checkedTime(asOf: string) {
  return new Date(asOf).toLocaleString();
}

export function ReconciliationCard({ orgId, userId, isMockAuth, canSeeFinancialBalances }: ReconciliationCardProps) {
  const [modal, setModal] = useState<'finance' | 'definitions' | null>(null);
  const scope = [userId, orgId, isMockAuth];
  const stock = useQuery({
    queryKey: ['stock-ledger-check', ...scope],
    queryFn: () => reconciliationService.getStockLedgerSummary(orgId, isMockAuth),
    retry: false,
  });
  const finance = useQuery({
    queryKey: ['financial-ledger-check', ...scope, canSeeFinancialBalances],
    queryFn: () => reconciliationService.reconcileFinancials(orgId, isMockAuth),
    enabled: canSeeFinancialBalances,
    retry: false,
  });
  const stockState = checkState(stock);
  const financeState = canSeeFinancialBalances ? checkState(finance) : undefined;
  const financials = canSeeFinancialBalances ? finance.data : undefined;
  const needsReview = Boolean(financials && (financials.discrepancyCount > 0 || financials.receiptIssueCount > 0));
  const hasFinancialRecords = Boolean(financials && (financials.invoiceCount > 0 || financials.receiptCount > 0));
  const isChecking = stock.isFetching || (canSeeFinancialBalances && finance.isFetching);
  const hasCurrentFinance = !financeState && Boolean(financials);
  const financeLabel = financeState ?? (needsReview ? 'Discrepancies found' : hasFinancialRecords ? 'Reconciled' : 'No posted records');

  function verify() {
    void stock.refetch();
    if (canSeeFinancialBalances) void finance.refetch();
  }

  return (
    <section aria-labelledby="ledger-check-heading" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="ledger-check-heading" className="text-sm font-bold text-navy-800">Ledger &amp; Data Integrity</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setModal('definitions')}>Metric Formulas</Button>
          <Button variant="outline" size="sm" onClick={verify} disabled={isChecking}>Verify</Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-700">Recorded Stock Ledger</h4>
            <Badge size="sm" variant={stockState ? 'warning' : 'info'}>
              {stockState ?? (stock.data?.productCount ? 'Ledger available' : 'No products')}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-slate-700">Recorded quantities come from stock movements. Physical variance requires a separate count.</p>
          {stock.data && <p className="mt-2 text-xs text-slate-600">
            {stock.data.productCount} catalog SKU(s) · {stock.data.lowStockCount} at or below reorder level.
            {' '}Last successful snapshot {checkedTime(stock.data.asOf)}.
          </p>}
        </div>

        {canSeeFinancialBalances && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2" role="status">
            <h4 className="text-xs font-semibold text-slate-700">Invoices and Payment Allocations</h4>
            <Badge size="sm" variant={financeState || needsReview ? 'warning' : hasFinancialRecords ? 'success' : 'info'}>
              {financeLabel}
            </Badge>
          </div>
          {financials && <p className="mt-2 text-xs text-slate-600">
            {financials.invoiceCount} posted invoice(s) · {financials.receiptCount} receipt(s).
            {' '}Last successful check {checkedTime(financials.asOf)}.
          </p>}
          {hasCurrentFinance && financials && <Button
            variant="outline" size="sm" className="mt-2"
            onClick={() => setModal('finance')}
          >Inspect Financials</Button>}
        </div>}
      </div>

      <Modal isOpen={modal === 'finance' && hasCurrentFinance} onClose={() => setModal(null)} title="Financial Reconciliation" maxWidth="2xl">
        {financials && <div className="space-y-3 text-sm text-slate-700">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Posted invoices</dt><dd>{formatCurrency(financials.totalInvoiced)}</dd></div>
            <div><dt>Outstanding from allocations</dt><dd>{formatCurrency(financials.totalOutstanding)}</dd></div>
            <div><dt>Receipts collected</dt><dd>{formatCurrency(financials.totalPaymentsCollected)}</dd></div>
            <div><dt>Unapplied receipts</dt><dd>{formatCurrency(financials.unallocatedPayments)}</dd></div>
          </dl>
          {financials.receiptIssueCount > 0 && <p>{financials.receiptIssueCount} receipt(s) have invalid or excess allocations.</p>}
          {financials.discrepancyCount > 0 && <>
            <p>Showing {financials.discrepancies.length} of {financials.discrepancyCount} invoice discrepancies.</p>
            <ul className="space-y-2">
              {financials.discrepancies.map((invoice) => <li key={invoice.invoiceId} className="rounded-lg border border-rose-200 p-2">
                <strong>{invoice.invoiceNumber}</strong> · Recorded paid {formatCurrency(invoice.totalPaid)}
                {' '}· Allocated {formatCurrency(invoice.allocated)} · Difference {formatCurrency(invoice.variance)}
              </li>)}
            </ul>
          </>}
        </div>}
      </Modal>

      <Modal isOpen={modal === 'definitions'} onClose={() => setModal(null)} title="Metric Definitions & Formulas">
        <dl className="space-y-3">
          {Object.entries(METRIC_DEFINITIONS).map(([key, metric]) => <div key={key} className="rounded-lg border border-slate-200 p-3">
            <dt className="font-semibold text-navy-800">{metric.title}</dt>
            <dd className="text-sm text-slate-700">{metric.definition}</dd>
            <dd className="mt-1 font-mono text-xs text-slate-700">{metric.formula}</dd>
          </div>)}
        </dl>
      </Modal>
    </section>
  );
}
