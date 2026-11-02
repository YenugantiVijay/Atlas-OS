import React, { useState, useEffect } from 'react';
import { LoadError } from '@/components/ui/LoadError';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  FileText,
  CreditCard,
  Boxes,
  Plus,
  Sparkles,
  ChevronRight,
  IndianRupee,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { dashboardService } from '@/services/dashboard.service';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { productsService } from '@/services/products.service';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCurrency } from '@/lib/money';
import { DashboardMetrics, SalesOrder, Invoice, Product } from '@/types';
import { SalesTrendChart, ReceivablesDonutChart, InventoryValuationBarChart } from '@/components/charts';

export const DashboardPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const fetchDashboardData = async () => {
      if (currentOrg) {
        setIsLoading(true);
        setLoadError(null);
        try {
          const [metricsData, ordersData, invoicesData, productsData] = await Promise.all([
            dashboardService.getDashboardMetrics(currentOrg.id, isMockAuth),
            ordersService.getSalesOrders(currentOrg.id, isMockAuth),
            invoicesService.getInvoices(currentOrg.id, isMockAuth),
            productsService.getProducts(currentOrg.id, isMockAuth),
          ]);

          if (isMounted) {
            setMetrics(metricsData);
            setOrders(ordersData);
            setInvoices(invoicesData);
            setProducts(productsData);
          }
        } catch (err) {
          if (isMounted) setLoadError(err instanceof Error ? err.message : 'Dashboard data could not be loaded.');
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }
    };
    fetchDashboardData();
    return () => {
      isMounted = false;
    };
  }, [currentOrg, isMockAuth, retryCount]);

  if (loadError) {
    return <LoadError message={loadError} onRetry={() => setRetryCount((count) => count + 1)} />;
  }

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Executive Operations Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-navy-700 border border-navy-800 p-6 sm:p-7 text-white shadow-card">
        {/* Subtle decorative radial teal accent */}
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-teal-500/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold tracking-wide uppercase px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-400/30">
                Operations Center
              </span>
              <span className="text-xs text-slate-300 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {isMockAuth ? 'Demo workspace' : 'Cloud workspace'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {currentOrg?.name || 'Electrical Distribution Workspace'}
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Consolidated business dashboard for tracking stock ledger movements, contractor sales orders, GST-compliant tax invoices, and customer receivables.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              variant="primary"
              size="md"
              onClick={() => navigate('/orders?action=create')}
              leftIcon={<Plus className="w-4 h-4" />}
              className="bg-teal-500 hover:bg-teal-600 text-white shadow-sm font-semibold"
            >
              New Sales Order
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/ai')}
              leftIcon={<Sparkles className="w-4 h-4 text-teal-300" />}
              className="border-slate-700 bg-slate-800/80 text-white hover:bg-slate-800 hover:border-slate-600"
            >
              ATLAS AI
            </Button>
          </div>
        </div>
      </div>

      {/* Actionable Alerts (Low Stock Warning Banner) */}
      {metrics.lowStockItemsCount > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-amber-950 shadow-xs">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {metrics.lowStockItemsCount} electrical SKU{metrics.lowStockItemsCount > 1 ? 's' : ''} below reorder threshold
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                Replenishment recommended to avoid dispatch delays on pending and incoming contractor orders.
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/inventory')}
            className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100/50 shrink-0 font-medium self-start sm:self-auto"
          >
            Review Stock Ledger
          </Button>
        </div>
      )}

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Metric 1: Today's Sales */}
        <Card hover className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-content-secondary mb-3">
              <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                Today's Sales
              </span>
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-navy-700 tabular-nums tracking-tight">
              {formatCurrency(metrics.todaySales)}
            </div>
          </div>
          <div className="text-xs text-content-secondary mt-3 pt-3 border-t border-border flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>From confirmed orders placed today</span>
          </div>
        </Card>

        {/* Metric 2: Total Receivables */}
        <Card hover className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-content-secondary mb-3">
              <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                Outstanding Receivables
              </span>
              <div className="p-2 rounded-lg bg-teal-50 text-teal-700">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-navy-700 tabular-nums tracking-tight">
              {formatCurrency(metrics.totalReceivables)}
            </div>
          </div>
          <div className="text-xs mt-3 pt-3 border-t border-border">
            {metrics.overdueInvoicesCount > 0 ? (
              <span className="text-rose-700 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                {metrics.overdueInvoicesCount} invoice{metrics.overdueInvoicesCount > 1 ? 's' : ''} overdue
              </span>
            ) : (
              <span className="text-emerald-700 font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                All invoices within agreed credit terms
              </span>
            )}
          </div>
        </Card>

        {/* Metric 3: Total Orders */}
        <Card hover className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-content-secondary mb-3">
              <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                Total Orders
              </span>
              <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
                <FileText className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-navy-700 tabular-nums tracking-tight">
              {metrics.ordersCount}
            </div>
          </div>
          <div className="text-xs text-content-secondary mt-3 pt-3 border-t border-border flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Recorded in organization ledger</span>
          </div>
        </Card>

        {/* Metric 4: Inventory Valuation */}
        <Card hover className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-content-secondary mb-3">
              <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                Inventory Valuation
              </span>
              <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-navy-700 tabular-nums tracking-tight">
              {formatCurrency(metrics.totalStockValue)}
            </div>
          </div>
          <div className="text-xs text-content-secondary mt-3 pt-3 border-t border-border">
            <span>Calculated from active cost ledger</span>
          </div>
        </Card>
      </div>

      {/* Primary Analytics Section: Sales Trend Area Chart & Receivables Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Performance Area Chart (2 Cols) */}
        <Card className="lg:col-span-2">
          <SalesTrendChart orders={orders} />
        </Card>

        {/* Receivables & Collections Donut (1 Col) */}
        <Card>
          <ReceivablesDonutChart invoices={invoices} />
        </Card>
      </div>

      {/* Secondary Analytics Section: Inventory Breakdown & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Brand Stock Valuation Breakdown */}
        <Card>
          <InventoryValuationBarChart products={products} />
        </Card>

        {/* Recent Sales Orders Feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-teal-600 shrink-0" />
              <CardTitle>Recent Sales Orders</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/orders')}
              rightIcon={<ChevronRight className="w-4 h-4" />}
              className="text-xs text-teal-700 hover:text-teal-900"
            >
              View All
            </Button>
          </CardHeader>

          {metrics.recentOrders.length === 0 ? (
            <div className="text-center py-10 text-sm text-content-secondary">
              No orders recorded yet for this organization.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {metrics.recentOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => navigate('/orders')}
                  className="py-3.5 flex items-center justify-between hover:bg-slate-50/80 rounded-lg px-2.5 -mx-2.5 cursor-pointer transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-content-primary">
                        {order.orderNumber}
                      </span>
                      <Badge
                        showDot
                        variant={
                          order.status === 'CONFIRMED'
                            ? 'success'
                            : order.status === 'DRAFT'
                            ? 'warning'
                            : 'default'
                        }
                        size="sm"
                      >
                        {order.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-content-secondary">
                      {order.customer?.companyName || order.customer?.name || 'Customer'} • {order.orderDate}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-bold text-navy-700 tabular-nums">
                      {formatCurrency(order.totalAmount)}
                    </div>
                    <div className="text-xs text-content-muted">
                      {order.items?.length || 0} line item{order.items?.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Inventory Watchlist & Reorder Alert */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 min-w-0">
            <Boxes className="w-4 h-4 text-amber-600 shrink-0" />
            <CardTitle>Inventory Replenishment Watchlist</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/inventory')}
            rightIcon={<ChevronRight className="w-4 h-4" />}
            className="text-xs text-teal-700 hover:text-teal-900"
          >
            Stock Ledger
          </Button>
        </CardHeader>

        {metrics.lowStockProducts.length === 0 ? (
          <div className="text-center py-10 text-sm text-content-secondary flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            <span>All electrical catalog SKUs are above reorder thresholds.</span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {metrics.lowStockProducts.map((p) => (
              <div
                key={p.id}
                className="py-3.5 flex items-center justify-between hover:bg-slate-50/80 rounded-lg px-2.5 -mx-2.5 transition-colors"
              >
                <div className="max-w-[70%] space-y-0.5">
                  <div className="text-sm font-semibold text-content-primary truncate">
                    {p.name}
                  </div>
                  <div className="text-xs text-content-secondary">
                    SKU: <span className="font-mono text-content-primary font-medium">{p.sku}</span> • {p.brand}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-bold text-rose-700 tabular-nums">
                    {p.currentStock || 0} {p.uom}
                  </div>
                  <div className="text-xs text-content-muted">
                    Min: {p.reorderThreshold} {p.uom}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick Launchpad: Standard Distribution Workflows */}
      <Card>
        <CardHeader>
          <CardTitle>Distribution Workflows</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => navigate('/quotations?action=create')}
            className="flex flex-col items-start p-4 rounded-xl border border-border bg-slate-50 hover:bg-teal-50/70 hover:border-teal-200 transition-all text-left group focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <FileText className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-content-primary">Create Quotation</span>
            <span className="text-xs text-content-secondary mt-0.5">Draft contractor pricing</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/products?action=create')}
            className="flex flex-col items-start p-4 rounded-xl border border-border bg-slate-50 hover:bg-teal-50/70 hover:border-teal-200 transition-all text-left group focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <Boxes className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-content-primary">Add Product SKU</span>
            <span className="text-xs text-content-secondary mt-0.5">Cables, MCBs, lighting</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/payments?action=record')}
            className="flex flex-col items-start p-4 rounded-xl border border-border bg-slate-50 hover:bg-teal-50/70 hover:border-teal-200 transition-all text-left group focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <IndianRupee className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-content-primary">Record Payment</span>
            <span className="text-xs text-content-secondary mt-0.5">UPI, NEFT, Cheques</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/ai')}
            className="flex flex-col items-start p-4 rounded-xl border border-border bg-slate-50 hover:bg-teal-50/70 hover:border-teal-200 transition-all text-left group focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-content-primary">AI Copilot</span>
            <span className="text-xs text-content-secondary mt-0.5">Reorder & receivables</span>
          </button>
        </div>
      </Card>
    </div>
  );
};
