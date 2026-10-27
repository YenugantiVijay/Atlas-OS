import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/money';
import { DashboardMetrics } from '@/types';

export const DashboardPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    if (currentOrg) {
      const data = storage.getDashboardMetrics(currentOrg.id);
      setMetrics(data);
    }
  }, [currentOrg]);

  if (!metrics) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-atlas-500 via-atlas-600 to-atlas-700 p-6 text-white shadow-card">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/20 text-white">
              Operations Center
            </span>
            <span className="text-xs text-white/80">• Real-Time Ledger</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {currentOrg?.name || 'Electrical Distribution Workspace'}
          </h1>
          <p className="text-xs text-atlas-100 mt-1 max-w-xl">
            Live operations ledger: tracking inventory movements, active sales orders, GST-compliant invoicing, and customer receivables.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => navigate('/orders?action=create')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-white text-atlas-900 hover:bg-atlas-50 shadow-md hover:shadow-lg transition-all active:scale-[0.99]"
          >
            <Plus className="w-4 h-4 text-atlas-700" />
            <span>New Sales Order</span>
          </button>
          <button
            onClick={() => navigate('/ai')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-atlas-900/40 hover:bg-atlas-900/60 text-white border border-white/20 backdrop-blur-md shadow-xs transition-all active:scale-[0.99]"
          >
            <Sparkles className="w-4 h-4 text-atlas-200" />
            <span>ATLAS AI</span>
          </button>
        </div>
      </div>

      {/* Actionable Alerts (e.g. Low Stock SKUs) */}
      {metrics.lowStockItemsCount > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-amber-900">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {metrics.lowStockItemsCount} SKU{metrics.lowStockItemsCount > 1 ? 's' : ''} below reorder threshold
              </div>
              <div className="text-xs text-amber-700">
                Replenishment recommended to avoid dispatch delays on incoming contractor orders.
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/inventory')}
            className="border-amber-300 bg-white text-amber-900 hover:bg-amber-50 shrink-0"
          >
            Review Stock
          </Button>
        </div>
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <Card hover>
          <div className="flex items-center justify-between text-content-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Today's Sales</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-content-primary">
            {formatCurrency(metrics.todaySales)}
          </div>
          <div className="text-[11px] text-content-muted mt-1 flex items-center gap-1">
            <span>From confirmed orders placed today</span>
          </div>
        </Card>

        {/* Total Receivables */}
        <Card hover>
          <div className="flex items-center justify-between text-content-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Receivables</span>
            <div className="p-2 rounded-lg bg-atlas-100 text-atlas-600">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-content-primary">
            {formatCurrency(metrics.totalReceivables)}
          </div>
          <div className="text-[11px] text-content-muted mt-1">
            {metrics.overdueInvoicesCount > 0 ? (
              <span className="text-red-600 font-semibold">
                {metrics.overdueInvoicesCount} invoice(s) overdue
              </span>
            ) : (
              <span>All invoices within credit terms</span>
            )}
          </div>
        </Card>

        {/* Total Orders */}
        <Card hover>
          <div className="flex items-center justify-between text-content-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Sales Orders</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-content-primary">
            {metrics.ordersCount}
          </div>
          <div className="text-[11px] text-content-muted mt-1">
            <span>Orders logged in current period</span>
          </div>
        </Card>

        {/* Inventory Valuation */}
        <Card hover>
          <div className="flex items-center justify-between text-content-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Stock Valuation</span>
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-content-primary">
            {formatCurrency(metrics.totalStockValue)}
          </div>
          <div className="text-[11px] text-content-muted mt-1">
            <span>Calculated from active cost ledger</span>
          </div>
        </Card>
      </div>

      {/* Two Column Layout: Recent Orders & Low Stock SKUs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-atlas-600" />
              <CardTitle>Recent Sales Orders</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>
              <span>View All</span>
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </CardHeader>

          {metrics.recentOrders.length === 0 ? (
            <div className="text-center py-8 text-xs text-content-muted">
              No orders recorded yet for this organization.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {metrics.recentOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => navigate('/orders')}
                  className="py-3 flex items-center justify-between hover:bg-atlas-50/50 rounded-lg px-2 -mx-2 cursor-pointer transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-content-primary">
                        {order.orderNumber}
                      </span>
                      <Badge
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
                    <div className="text-[11px] text-content-secondary mt-0.5">
                      {order.customer?.companyName || order.customer?.name || 'Customer'} • {order.orderDate}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-content-primary">
                      {formatCurrency(order.totalAmount)}
                    </div>
                    <div className="text-[10px] text-content-muted">
                      {order.items?.length || 0} line item(s)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Low Stock Watchlist */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-atlas-600" />
              <CardTitle>Inventory Replenishment Watchlist</CardTitle>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/inventory')}>
              <span>Ledger</span>
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </CardHeader>

          {metrics.lowStockProducts.length === 0 ? (
            <div className="text-center py-8 text-xs text-content-muted">
              All electrical products are currently above their reorder thresholds.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {metrics.lowStockProducts.map((p) => (
                <div
                  key={p.id}
                  className="py-3 flex items-center justify-between hover:bg-atlas-50/50 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <div className="max-w-[70%]">
                    <div className="text-xs font-bold text-content-primary truncate">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-content-secondary mt-0.5">
                      SKU: <span className="font-mono">{p.sku}</span> • {p.brand}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-red-600">
                      {p.currentStock || 0} {p.uom}
                    </div>
                    <div className="text-[10px] text-content-muted">
                      Min: {p.reorderThreshold} {p.uom}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Quick Launchpad */}
      <Card>
        <CardHeader>
          <CardTitle>Distribution Workflows</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => navigate('/quotations?action=create')}
            className="flex flex-col items-start p-3.5 rounded-xl border border-border bg-surface-panel hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-atlas-100 text-atlas-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <FileText className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-content-primary">Create Quotation</span>
            <span className="text-[11px] text-content-muted mt-0.5">Draft contractor quote</span>
          </button>

          <button
            onClick={() => navigate('/products?action=create')}
            className="flex flex-col items-start p-3.5 rounded-xl border border-border bg-surface-panel hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Boxes className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-content-primary">Add Product SKU</span>
            <span className="text-[11px] text-content-muted mt-0.5">Cables, MCBs, lighting</span>
          </button>

          <button
            onClick={() => navigate('/payments?action=record')}
            className="flex flex-col items-start p-3.5 rounded-xl border border-border bg-surface-panel hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <IndianRupee className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-content-primary">Record Payment</span>
            <span className="text-[11px] text-content-muted mt-0.5">UPI, NEFT, Cheque</span>
          </button>

          <button
            onClick={() => navigate('/ai')}
            className="flex flex-col items-start p-3.5 rounded-xl border border-border bg-surface-panel hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-content-primary">AI Insights</span>
            <span className="text-[11px] text-content-muted mt-0.5">Reorder & receivables</span>
          </button>
        </div>
      </Card>
    </div>
  );
};
