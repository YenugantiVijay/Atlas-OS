/**
 * ATLAS OS — Trustworthy Numbers & Financial/Inventory Reconciliation Engine
 *
 * Provides authoritative reconciliation between:
 * 1. Financial Ledger: Total Invoiced vs Payments Allocated vs Outstanding Receivables.
 * 2. Inventory Ledger: Product Current Stock vs Stock Movement Ledger Sum.
 * 3. Metric definitions and freshness metadata.
 */

import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { calculateInvoiceBalance, formatCurrency } from '@/lib/money';
import { Invoice, Payment, Product, StockMovement } from '@/types';
import { mapDbInvoice } from './invoices.service';
import { mapDbPayment, mapDbPaymentAllocation } from './payments.service';
import { mapDbProduct } from './products.service';
import { mapDbStockMovement } from './inventory.service';

export interface FinancialReconciliationResult {
  asOf: string;
  formattedAsOf: string;
  status: 'BALANCED' | 'VARIANCE_DETECTED';
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  varianceAmount: number;
  totalPaymentsCollected: number;
  totalAllocated: number;
  unallocatedPayments: number;
  explanation: string;
  discrepancies: Array<{
    invoiceId: string;
    invoiceNumber: string;
    totalAmount: number;
    totalPaid: number;
    outstandingBalance: number;
    variance: number;
    note: string;
  }>;
}

export interface InventoryReconciliationResult {
  asOf: string;
  formattedAsOf: string;
  status: 'VERIFIED' | 'DISCREPANCY_DETECTED';
  totalProductsChecked: number;
  discrepantCount: number;
  explanation: string;
  discrepancies: Array<{
    productId: string;
    sku: string;
    name: string;
    uom: string;
    recordedStock: number;
    ledgerStock: number;
    varianceUnits: number;
    actionableAdvice: string;
  }>;
}

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
    definition: 'Current inventory asset value at cost price across all active catalog products.',
    formula: 'SUM(products.current_stock * products.purchase_cost) WHERE is_active = true',
  },
  lowStockItems: {
    title: 'Low Stock Reorder Alerts',
    definition: 'Count of active catalog SKUs whose current stock balance is at or below the configured reorder threshold.',
    formula: 'COUNT(products) WHERE is_active = true AND current_stock <= reorder_threshold',
  },
};

export const reconciliationService = {
  /**
   * Reconciles financial ledgers: verifies that Invoiced == Paid + Outstanding.
   */
  async reconcileFinancials(
    orgId: string,
    isMockAuth: boolean = false
  ): Promise<FinancialReconciliationResult> {
    if (!orgId) throw new Error('Organization ID is required for financial reconciliation.');

    let invoices: Invoice[] = [];
    let payments: Payment[] = [];

    if (isMockAuth) {
      invoices = storage.getInvoices(orgId);
      payments = storage.getPayments(orgId);
    } else {
      if (!supabase) throw new Error('Cloud backend is not configured.');
      const [invRes, payRes] = await Promise.all([
        supabase.from('invoices').select('*').eq('organization_id', orgId),
        supabase.from('payments').select('*, allocations:payment_allocations(*)').eq('organization_id', orgId),
      ]);
      if (invRes.error) throw new Error(`Failed to load invoices: ${invRes.error.message}`);
      if (payRes.error) throw new Error(`Failed to load payments: ${payRes.error.message}`);
      invoices = (invRes.data || []).map((row) => mapDbInvoice(row));
      payments = (payRes.data || []).map((row) =>
        mapDbPayment(row, (row.allocations || []).map(mapDbPaymentAllocation))
      );
    }

    const activeInvoices = invoices.filter((inv) => inv.status !== 'CANCELLED');
    const totalInvoiced = activeInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    const totalPaid = activeInvoices.reduce((sum, inv) => sum + Number(inv.totalPaid || 0), 0);
    const totalOutstanding = activeInvoices.reduce(
      (sum, inv) => sum + calculateInvoiceBalance(inv.totalAmount, inv.totalPaid),
      0
    );

    const totalPaymentsCollected = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalAllocated = payments.reduce(
      (sum, p) =>
        sum + (p.allocations || []).reduce((aSum: number, a: any) => aSum + Number(a.amountAllocated || a.amount || 0), 0),
      0
    );

    const discrepancies: FinancialReconciliationResult['discrepancies'] = [];

    for (const inv of activeInvoices) {
      const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
      const computedTotal = Number((Number(inv.totalPaid) + balance).toFixed(2));
      const expectedTotal = Number(Number(inv.totalAmount).toFixed(2));
      const variance = Number(Math.abs(expectedTotal - computedTotal).toFixed(2));

      if (variance > 0.01) {
        discrepancies.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          totalAmount: expectedTotal,
          totalPaid: Number(inv.totalPaid),
          outstandingBalance: balance,
          variance,
          note: `Invoice total (${formatCurrency(expectedTotal)}) does not equal paid (${formatCurrency(inv.totalPaid)}) + balance (${formatCurrency(balance)}).`,
        });
      }
    }

    const overallVariance = Number(Math.abs(totalInvoiced - (totalPaid + totalOutstanding)).toFixed(2));
    const isBalanced = overallVariance <= 0.01 && discrepancies.length === 0;

    const now = new Date();
    const explanation = isBalanced
      ? `Financial ledgers balanced: Total Invoiced (${formatCurrency(totalInvoiced)}) equals Collected (${formatCurrency(totalPaid)}) + Outstanding Receivables (${formatCurrency(totalOutstanding)}).`
      : `Financial variance of ${formatCurrency(overallVariance)} detected across ${discrepancies.length} invoice(s).`;

    return {
      asOf: now.toISOString(),
      formattedAsOf: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + now.toLocaleDateString(),
      status: isBalanced ? 'BALANCED' : 'VARIANCE_DETECTED',
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      varianceAmount: overallVariance,
      totalPaymentsCollected,
      totalAllocated,
      unallocatedPayments: Math.max(0, totalPaymentsCollected - totalAllocated),
      explanation,
      discrepancies,
    };
  },

  /**
   * Reconciles inventory: verifies that for every product, currentStock == sum(stock_movements).
   */
  async reconcileInventory(
    orgId: string,
    isMockAuth: boolean = false
  ): Promise<InventoryReconciliationResult> {
    if (!orgId) throw new Error('Organization ID is required for inventory reconciliation.');

    let products: Product[] = [];
    let movements: StockMovement[] = [];

    if (isMockAuth) {
      products = storage.getProducts(orgId);
      movements = storage.getStockMovements(orgId);
    } else {
      if (!supabase) throw new Error('Cloud backend is not configured.');
      const [prodRes, movRes] = await Promise.all([
        supabase.from('products').select('*').eq('organization_id', orgId),
        supabase.from('stock_movements').select('*').eq('organization_id', orgId),
      ]);
      if (prodRes.error) throw new Error(`Failed to load products: ${prodRes.error.message}`);
      if (movRes.error) throw new Error(`Failed to load stock movements: ${movRes.error.message}`);
      products = (prodRes.data || []).map((row) =>
        mapDbProduct(row, Number(row.current_stock ?? 0))
      );
      movements = (movRes.data || []).map(mapDbStockMovement);
    }

    const discrepancies: InventoryReconciliationResult['discrepancies'] = [];

    for (const prod of products) {
      const prodMovements = movements.filter((m) => m.productId === prod.id);
      const ledgerStock = prodMovements.reduce((sum, m) => sum + Number(m.quantityChange || 0), 0);
      const recordedStock = Number(prod.currentStock ?? 0);
      const variance = recordedStock - ledgerStock;

      if (variance !== 0) {
        discrepancies.push({
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          uom: prod.uom,
          recordedStock,
          ledgerStock,
          varianceUnits: variance,
          actionableAdvice:
            variance > 0
              ? `Physical recorded stock (${recordedStock} ${prod.uom}) exceeds ledger sum (${ledgerStock} ${prod.uom}) by +${variance} ${prod.uom}. Check for unrecorded supplier intake.`
              : `Physical recorded stock (${recordedStock} ${prod.uom}) is less than ledger sum (${ledgerStock} ${prod.uom}) by ${variance} ${prod.uom}. Check for unlogged counter sales or record a Stock Adjustment.`,
        });
      }
    }

    const now = new Date();
    const isVerified = discrepancies.length === 0;
    const explanation = isVerified
      ? `Inventory ledger verified: All ${products.length} products reconcile exactly with stock movement ledger history.`
      : `${discrepancies.length} of ${products.length} product(s) have variances between recorded physical stock and movement ledger.`;

    return {
      asOf: now.toISOString(),
      formattedAsOf: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + now.toLocaleDateString(),
      status: isVerified ? 'VERIFIED' : 'DISCREPANCY_DETECTED',
      totalProductsChecked: products.length,
      discrepantCount: discrepancies.length,
      explanation,
      discrepancies,
    };
  },
};
