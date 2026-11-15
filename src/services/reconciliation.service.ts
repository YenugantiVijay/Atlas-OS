import { z } from 'zod';
import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { getBusinessDate } from '@/lib/dates';
import { fromPaise, toPaise } from '@/lib/money';

const previewLimit = 25;
const count = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
const timestamp = z.string().datetime({ offset: true });

const lowStockRow = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  uom: z.string(),
  reorderThreshold: count,
  quantity: z.number().int(),
});

const stockSummary = z.object({
  asOf: timestamp,
  productCount: count,
  activeProductCount: count,
  lowStockCount: count,
  catalogCostValue: amount.nullable(),
  lowStock: z.array(lowStockRow).max(previewLimit),
}).refine((r) => r.productCount >= r.activeProductCount && r.activeProductCount >= r.lowStockCount
  && r.lowStock.length === Math.min(r.lowStockCount, previewLimit));

const discrepancy = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  totalAmount: amount,
  totalPaid: amount,
  allocated: amount,
  outstandingBalance: amount,
  variance: amount.positive(),
});

const overdueRow = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  dueDate: z.iso.date(),
  outstanding: amount.positive(),
});

const financialSnapshot = z.object({
  asOf: timestamp,
  invoiceCount: count,
  receiptCount: count,
  totalInvoiced: amount,
  totalPaid: amount,
  totalOutstanding: amount,
  varianceAmount: amount,
  totalPaymentsCollected: amount,
  totalAllocated: amount,
  unallocatedPayments: amount,
  receiptIssueCount: count,
  discrepancyCount: count,
  discrepancies: z.array(discrepancy).max(previewLimit),
  overdueCount: count,
  overdueTotal: amount,
  overdue: z.array(overdueRow).max(previewLimit),
}).refine((r) => r.discrepancyCount <= r.invoiceCount && r.overdueCount <= r.invoiceCount
  && r.receiptIssueCount <= r.receiptCount
  && (r.discrepancyCount === 0) === (r.varianceAmount === 0)
  && (r.overdueCount === 0) === (r.overdueTotal === 0)
  && r.discrepancies.length === Math.min(r.discrepancyCount, previewLimit)
  && r.overdue.length === Math.min(r.overdueCount, previewLimit));

export type StockLedgerSummary = z.infer<typeof stockSummary>;
export type FinancialReconciliationResult = z.infer<typeof financialSnapshot>;

export const METRIC_DEFINITIONS: Record<string, { title: string; definition: string; formula: string }> = {
  todaySales: {
    title: "Today's Sales",
    definition: 'Gross value of all confirmed and fulfilled sales orders placed today (in Indian Standard Time). Excludes draft and cancelled orders.',
    formula: 'SUM(sales_orders.total_amount) WHERE order_date = TODAY AND status IN (CONFIRMED, FULFILLED)',
  },
  totalReceivables: {
    title: 'Outstanding Receivables',
    definition: 'Cumulative unpaid balance across all issued and partially paid tax invoices. Accounts for all recorded customer payment allocations.',
    formula: 'SUM(invoices.total_amount - invoices.total_paid) WHERE status IN (ISSUED, PARTIALLY_PAID)',
  },
  totalStockValue: {
    title: 'Total Stock Valuation',
    definition: 'Recorded positive quantities valued at current catalog cost price.',
    formula: 'SUM(MAX(ledger_quantity, 0) × catalog_purchase_cost)',
  },
  lowStockItems: {
    title: 'Low Stock Reorder Alerts',
    definition: 'Count of active catalog SKUs whose current stock balance is at or below the configured reorder threshold.',
    formula: 'COUNT(active products WHERE ledger_quantity <= reorder_threshold)',
  },
};

function demoFinancialSnapshot(orgId: string): FinancialReconciliationResult {
  const today = getBusinessDate();
  const invoices = storage.getInvoices(orgId).filter((i) =>
    i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID' || i.status === 'PAID');
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));
  const payments = storage.getPayments(orgId);
  const allocatedToInvoice = new Map<string, number>();
  let collected = 0;
  let allocated = 0;
  let unapplied = 0;
  let receiptIssueCount = 0;
  for (const payment of payments) {
    const value = toPaise(payment.amount);
    let receiptAllocated = 0;
    let invalidTarget = false;
    for (const allocation of payment.allocations ?? []) {
      const cents = toPaise(allocation.amountAllocated);
      receiptAllocated += cents;
      if (byInvoice.get(allocation.invoiceId)?.customerId !== payment.customerId) {
        invalidTarget = true;
        continue;
      }
      allocatedToInvoice.set(allocation.invoiceId, (allocatedToInvoice.get(allocation.invoiceId) ?? 0) + cents);
    }
    collected += value;
    allocated += receiptAllocated;
    unapplied += Math.max(value - receiptAllocated, 0);
    if (invalidTarget || receiptAllocated > value) receiptIssueCount++;
  }

  const discrepancies: FinancialReconciliationResult['discrepancies'] = [];
  const overdue: FinancialReconciliationResult['overdue'] = [];
  let invoiced = 0;
  let paid = 0;
  let outstanding = 0;
  let variance = 0;
  let overdueTotal = 0;
  for (const invoice of invoices) {
    const total = toPaise(invoice.totalAmount);
    const recordedPaid = toPaise(invoice.totalPaid);
    const applied = allocatedToInvoice.get(invoice.id) ?? 0;
    const balance = Math.max(total - applied, 0);
    const difference = Math.max(Math.abs(recordedPaid - applied), applied - total, recordedPaid - total,
      invoice.status === 'PAID' ? balance : 0);
    invoiced += total;
    paid += recordedPaid;
    outstanding += balance;
    if (difference > 0) {
      variance += difference;
      discrepancies.push({
        invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: fromPaise(total),
        totalPaid: fromPaise(recordedPaid), allocated: fromPaise(applied),
        outstandingBalance: fromPaise(balance), variance: fromPaise(difference),
      });
    }
    if (invoice.status !== 'PAID' && invoice.dueDate < today && balance > 0) {
      overdueTotal += balance;
      overdue.push({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate, outstanding: fromPaise(balance) });
    }
  }
  return {
    asOf: new Date().toISOString(),
    invoiceCount: invoices.length, receiptCount: payments.length,
    totalInvoiced: fromPaise(invoiced), totalPaid: fromPaise(paid), totalOutstanding: fromPaise(outstanding),
    varianceAmount: fromPaise(variance), totalPaymentsCollected: fromPaise(collected),
    totalAllocated: fromPaise(allocated), unallocatedPayments: fromPaise(unapplied), receiptIssueCount,
    discrepancyCount: discrepancies.length,
    discrepancies: discrepancies.sort((a, b) => b.variance - a.variance).slice(0, previewLimit),
    overdueCount: overdue.length, overdueTotal: fromPaise(overdueTotal),
    overdue: overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, previewLimit),
  };
}

export const reconciliationService = {
  async reconcileFinancials(orgId: string, isMockAuth = false): Promise<FinancialReconciliationResult> {
    if (!orgId) throw new Error('Organization ID is required for financial reconciliation.');
    if (isMockAuth) return demoFinancialSnapshot(orgId);
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.rpc('get_financial_reconciliation', {
      p_org_id: orgId, p_today: getBusinessDate(),
    });
    if (error) throw new Error('Financial reconciliation is unavailable.');
    const result = financialSnapshot.safeParse(data);
    if (!result.success) throw new Error('Financial reconciliation returned incomplete data.');
    return result.data;
  },

  async getStockLedgerSummary(orgId: string, isMockAuth = false): Promise<StockLedgerSummary> {
    if (!orgId) throw new Error('Organization ID is required for the stock ledger.');
    if (!isMockAuth) {
      if (!supabase) throw new Error('Cloud backend is not configured.');
      const { data, error } = await supabase.rpc('get_stock_ledger_summary', { p_org_id: orgId });
      if (error) throw new Error('The stock ledger is unavailable.');
      const result = stockSummary.safeParse(data);
      if (!result.success) throw new Error('The stock ledger returned incomplete data.');
      return result.data;
    }

    const products = storage.getProducts(orgId);
    const activeProducts = products.filter((p) => p.isActive);
    const lowStock = activeProducts
      .map(({ id, sku, name, uom, reorderThreshold, currentStock }) =>
        lowStockRow.parse({ id, sku, name, uom, reorderThreshold, quantity: currentStock }))
      .filter((p) => p.quantity <= p.reorderThreshold)
      .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      asOf: new Date().toISOString(), productCount: products.length, activeProductCount: activeProducts.length,
      lowStockCount: lowStock.length,
      catalogCostValue: fromPaise(products.reduce((sum, p) => sum + Math.max(z.number().int().parse(p.currentStock), 0) * toPaise(p.purchaseCost), 0)),
      lowStock: lowStock.slice(0, previewLimit),
    };
  },
};
