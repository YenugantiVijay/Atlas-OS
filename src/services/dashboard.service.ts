import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { DashboardMetrics, Product, SalesTrendPoint, ReceivablesSummary, BrandValuation } from '@/types';
import { getBusinessDate } from '@/lib/dates';
import { mapDbSalesOrder, mapDbSalesOrderItem } from './orders.service';
import { mapDbPayment, mapDbPaymentAllocation } from './payments.service';

export interface ParseMetricOptions {
  allowNegative?: boolean;
}

/**
 * Validates and parses an authoritative financial metric value.
 * Strictly preserves valid 0 while explicitly rejecting null, undefined, NaN,
 * Infinity, empty/whitespace strings, and invalid financial values with descriptive errors.
 */
export function parseMetricNumber(
  val: unknown,
  metricName: string = 'metric',
  options?: ParseMetricOptions
): number {
  if (val === null) {
    throw new TypeError(`Missing required financial metric '${metricName}': value is null.`);
  }
  if (val === undefined) {
    throw new TypeError(`Missing required financial metric '${metricName}': value is undefined.`);
  }

  let num: number;

  if (typeof val === 'number') {
    if (Number.isNaN(val)) {
      throw new TypeError(`Invalid financial metric '${metricName}': value is NaN.`);
    }
    if (!Number.isFinite(val)) {
      throw new TypeError(`Invalid financial metric '${metricName}': value is non-finite (${val}).`);
    }
    num = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') {
      throw new TypeError(`Missing required financial metric '${metricName}': string is empty or whitespace.`);
    }
    num = Number(trimmed);
    if (Number.isNaN(num)) {
      throw new TypeError(`Invalid financial metric '${metricName}': '${val}' is not a valid number.`);
    }
    if (!Number.isFinite(num)) {
      throw new TypeError(`Invalid financial metric '${metricName}': value is non-finite (${val}).`);
    }
  } else {
    throw new TypeError(`Invalid financial metric '${metricName}': unexpected type '${typeof val}'.`);
  }

  if (num < 0 && !options?.allowNegative) {
    throw new RangeError(`Financial metric '${metricName}' cannot be negative (${num}).`);
  }

  return Object.is(num, -0) ? 0 : num;
}

export const dashboardService = {
  /**
   * Fetches authoritative dashboard KPI metrics and bounded recent activity.
   * Completely avoids unpaginated catalog or transaction history downloads.
   */
  async getDashboardMetrics(orgId: string, isMockAuth: boolean = false): Promise<DashboardMetrics> {
    if (isMockAuth) {
      return storage.getDashboardMetrics(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const todayStr = getBusinessDate();

    // 1. Authoritative database-side metric aggregation
    const { data: dbMetrics, error: rpcErr } = await supabase.rpc('get_dashboard_metrics', {
      p_org_id: orgId,
      p_today: todayStr,
    });

    if (rpcErr) {
      throw new Error(`Failed to load authoritative dashboard metrics: ${rpcErr.message}`);
    }

    if (!dbMetrics || typeof dbMetrics !== 'object') {
      throw new Error('Authoritative dashboard service returned an empty or invalid response.');
    }

    // 2. Fetch bounded recent 5 orders and payments for dashboard activity feeds
    const [recentOrdersRes, recentPaymentsRes] = await Promise.all([
      supabase
        .from('sales_orders')
        .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('payments')
        .select('*, allocations:payment_allocations(*), customer:customers!fk_payments_customer_org(*)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    if (recentOrdersRes.error) {
      throw new Error(`Failed to load recent orders: ${recentOrdersRes.error.message}`);
    }
    if (recentPaymentsRes.error) {
      throw new Error(`Failed to load recent payments: ${recentPaymentsRes.error.message}`);
    }

    const recentOrders = (recentOrdersRes.data || []).map((row) => {
      const items = (row.items || []).map(mapDbSalesOrderItem);
      return mapDbSalesOrder(row, items);
    });

    const recentPayments = (recentPaymentsRes.data || []).map((row) => {
      const allocations = (row.allocations || []).map(mapDbPaymentAllocation);
      return mapDbPayment(row, allocations);
    });

    // 3. Map bounded low-stock preview directly from PostgreSQL aggregation
    const rawPreview = Array.isArray(dbMetrics.low_stock_preview) ? dbMetrics.low_stock_preview : [];
    const lowStockProducts: Product[] = rawPreview.map((item: Record<string, unknown>) => ({
      id: String(item.id || ''),
      organizationId: orgId,
      sku: String(item.sku || ''),
      name: String(item.name || ''),
      brand: item.brand ? String(item.brand) : undefined,
      category: String(item.category || 'General'),
      uom: (item.uom as Product['uom']) || 'Nos',
      purchaseCost: Number(item.purchaseCost) || 0,
      sellingPrice: 0,
      taxRate: 18,
      reorderThreshold: Number(item.reorderThreshold) || 0,
      currentStock: Number(item.currentStock) || 0,
      isActive: item.isActive !== false,
      createdAt: '',
      updatedAt: '',
    }));

    return {
      todaySales: parseMetricNumber(dbMetrics.today_sales, 'today_sales'),
      ordersCount: parseMetricNumber(dbMetrics.orders_count, 'orders_count'),
      totalReceivables: parseMetricNumber(dbMetrics.total_receivables, 'total_receivables'),
      overdueInvoicesCount: parseMetricNumber(dbMetrics.overdue_invoices_count, 'overdue_invoices_count'),
      lowStockItemsCount: parseMetricNumber(dbMetrics.low_stock_items_count, 'low_stock_items_count'),
      totalStockValue: parseMetricNumber(dbMetrics.total_stock_value, 'total_stock_value'),
      recentOrders,
      recentPayments,
      lowStockProducts,
    };
  },

  /**
   * Fetches authoritative daily sales performance trend from database.
   */
  async getSalesTrend(orgId: string, days: number = 30, isMockAuth: boolean = false): Promise<SalesTrendPoint[]> {
    if (isMockAuth) {
      const orders = storage.getSalesOrders(orgId);
      const now = new Date();
      const dateMap: Record<string, number> = {};
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dateMap[d.toISOString().split('T')[0]] = 0;
      }
      orders.forEach((o) => {
        if ((o.status === 'CONFIRMED' || o.status === 'FULFILLED') && dateMap[o.orderDate] !== undefined) {
          dateMap[o.orderDate] += o.totalAmount;
        }
      });
      return Object.entries(dateMap).map(([date, amount]) => ({
        date,
        amount,
        label: new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      }));
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('get_sales_trend', {
      p_org_id: orgId,
      p_days: days,
      p_today: getBusinessDate(),
    });

    if (error) {
      throw new Error(`Failed to load sales trend: ${error.message}`);
    }

    return (data || []).map((row: { order_date: string; total_amount: number | string }) => ({
      date: row.order_date,
      amount: Number(row.total_amount) || 0,
      label: new Date(row.order_date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    }));
  },

  /**
   * Fetches authoritative receivables and recovery breakdown from database.
   */
  async getReceivablesSummary(orgId: string, isMockAuth: boolean = false): Promise<ReceivablesSummary> {
    if (isMockAuth) {
      const invoices = storage.getInvoices(orgId);
      let invoiced = 0;
      let settled = 0;
      let outstanding = 0;
      let overdue = 0;
      const todayStr = new Date().toISOString().split('T')[0];

      invoices.forEach((inv) => {
        // Strictly exclude DRAFT and CANCELLED invoices from issued commercial metrics
        if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
          invoiced += inv.totalAmount;
          settled += inv.totalPaid || 0;
          if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') {
            const bal = Math.max(0, inv.totalAmount - (inv.totalPaid || 0));
            outstanding += bal;
            if (inv.dueDate && inv.dueDate < todayStr) {
              overdue++;
            }
          }
        }
      });

      const settledPct = invoiced > 0 ? Math.round((settled / invoiced) * 100) : 100;
      return {
        totalInvoiced: invoiced,
        totalSettled: settled,
        totalOutstanding: outstanding,
        overdueCount: overdue,
        settledPct,
      };
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('get_receivables_summary', {
      p_org_id: orgId,
      p_today: getBusinessDate(),
    });

    if (error) {
      throw new Error(`Failed to load receivables summary: ${error.message}`);
    }

    return {
      totalInvoiced: parseMetricNumber(data.total_invoiced, 'total_invoiced'),
      totalSettled: parseMetricNumber(data.total_settled, 'total_settled'),
      totalOutstanding: parseMetricNumber(data.total_outstanding, 'total_outstanding'),
      overdueCount: parseMetricNumber(data.overdue_count, 'overdue_count'),
      settledPct: parseMetricNumber(data.settled_pct, 'settled_pct'),
    };
  },

  /**
   * Fetches top brands by inventory valuation directly from database aggregation.
   */
  async getTopBrandValuation(orgId: string, limit: number = 5, isMockAuth: boolean = false): Promise<BrandValuation[]> {
    if (isMockAuth) {
      const products = storage.getProducts(orgId);
      const map: Record<string, BrandValuation> = {};
      products.forEach((p) => {
        if (p.isActive) {
          const brandKey = p.brand?.trim() || 'Generic / Unbranded';
          const value = (p.currentStock || 0) * (p.purchaseCost || 0);
          if (!map[brandKey]) {
            map[brandKey] = { brand: brandKey, totalValue: 0, skuCount: 0, totalUnits: 0 };
          }
          map[brandKey].totalValue += value;
          map[brandKey].skuCount += 1;
          map[brandKey].totalUnits += p.currentStock || 0;
        }
      });
      return Object.values(map)
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, limit);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('get_top_brand_stock_valuation', {
      p_org_id: orgId,
      p_limit: limit,
    });

    if (error) {
      throw new Error(`Failed to load brand stock valuation: ${error.message}`);
    }

    return (data || []).map((row: { brand: string; total_value: number | string; sku_count: number | string; total_units: number | string }) => ({
      brand: row.brand,
      totalValue: Number(row.total_value) || 0,
      skuCount: Number(row.sku_count) || 0,
      totalUnits: Number(row.total_units) || 0,
    }));
  },
};
