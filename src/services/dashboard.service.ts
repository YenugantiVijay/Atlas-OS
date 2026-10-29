import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { DashboardMetrics } from '@/types';
import { calculateInvoiceBalance, roundMoney } from '@/lib/money';
import { productsService } from './products.service';
import { ordersService } from './orders.service';
import { paymentsService } from './payments.service';

export const dashboardService = {
  async getDashboardMetrics(orgId: string, isMockAuth: boolean = false): Promise<DashboardMetrics> {
    if (isMockAuth) {
      return storage.getDashboardMetrics(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const [allOrders, allPayments, products] = await Promise.all([
      ordersService.getSalesOrders(orgId, false),
      paymentsService.getPayments(orgId, false),
      productsService.getProducts(orgId, false),
    ]);

    // 1. Fetch invoices for receivables and overdue counts
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
        .filter((o) => o.orderDate === todayStr && o.status !== 'CANCELLED')
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
