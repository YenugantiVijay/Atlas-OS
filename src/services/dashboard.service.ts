import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { DashboardMetrics } from '@/types';
import { calculateInvoiceBalance, roundMoney } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { productsService } from './products.service';
import { ordersService, mapDbSalesOrder, mapDbSalesOrderItem } from './orders.service';
import { paymentsService, mapDbPayment, mapDbPaymentAllocation } from './payments.service';

export const dashboardService = {
  async getDashboardMetrics(orgId: string, isMockAuth: boolean = false): Promise<DashboardMetrics> {
    if (isMockAuth) {
      return storage.getDashboardMetrics(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const todayStr = getBusinessDate();

    // 1. Attempt authoritative database-side metric aggregation
    const { data: dbMetrics, error: rpcErr } = await supabase.rpc('get_dashboard_metrics', {
      p_org_id: orgId,
      p_today: todayStr,
    });

    if (!rpcErr && dbMetrics) {
      // Efficiently fetch only the recent 5 orders and payments for display
      const [allProducts, recentOrdersRes, recentPaymentsRes] = await Promise.all([
        productsService.getProducts(orgId, false),
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

      const lowStockProducts = allProducts.filter(
        (p) => p.isActive && (p.currentStock ?? 0) <= p.reorderThreshold
      );

      const recentOrders = (recentOrdersRes.data || []).map((row) => {
        const items = (row.items || []).map(mapDbSalesOrderItem);
        return mapDbSalesOrder(row, items);
      });

      const recentPayments = (recentPaymentsRes.data || []).map((row) => {
        const allocations = (row.allocations || []).map(mapDbPaymentAllocation);
        return mapDbPayment(row, allocations);
      });

      return {
        todaySales: Number(dbMetrics.today_sales) || 0,
        ordersCount: Number(dbMetrics.orders_count) || 0,
        totalReceivables: Number(dbMetrics.total_receivables) || 0,
        overdueInvoicesCount: Number(dbMetrics.overdue_invoices_count) || 0,
        lowStockItemsCount: Number(dbMetrics.low_stock_items_count) || lowStockProducts.length,
        totalStockValue: Number(dbMetrics.total_stock_value) || 0,
        recentOrders,
        recentPayments,
        lowStockProducts,
      };
    }

    // Fallback: in environments where RPC is not yet applied
    const [allOrders, allPayments, products] = await Promise.all([
      ordersService.getSalesOrders(orgId, false),
      paymentsService.getPayments(orgId, false),
      productsService.getProducts(orgId, false),
    ]);

    const { data: invoices, error: invErr } = await supabase
      .from('invoices')
      .select('total_amount, total_paid, status, due_date')
      .eq('organization_id', orgId);

    if (invErr) {
      throw new Error(`Failed to load metrics: ${invErr.message}`);
    }

    let totalReceivables = 0;
    let overdueInvoicesCount = 0;
    if (invoices) {
      for (const inv of invoices) {
        if (inv.status !== 'CANCELLED' && inv.status !== 'PAID') {
          const bal = calculateInvoiceBalance(Number(inv.total_amount) || 0, Number(inv.total_paid) || 0);
          totalReceivables = roundMoney(totalReceivables + bal);
          if (inv.due_date && inv.due_date < todayStr) {
            overdueInvoicesCount++;
          }
        }
      }
    }

    const todaySales = roundMoney(
      allOrders
        .filter((o) => o.orderDate === todayStr && (o.status === 'CONFIRMED' || o.status === 'FULFILLED'))
        .reduce((sum, o) => sum + o.totalAmount, 0)
    );

    const lowStockProducts = products.filter(
      (p) => p.isActive && (p.currentStock ?? 0) <= p.reorderThreshold
    );

    const totalStockValue = roundMoney(
      products.reduce(
        (sum, p) => sum + (p.currentStock || 0) * p.purchaseCost,
        0
      )
    );

    return {
      todaySales,
      ordersCount: allOrders.length,
      totalReceivables,
      overdueInvoicesCount,
      lowStockItemsCount: lowStockProducts.length,
      totalStockValue,
      recentOrders: allOrders.slice(0, 5),
      recentPayments: allPayments.slice(0, 5),
      lowStockProducts,
    };
  },
};
