import React, { useMemo } from 'react';
import { Product } from '@/types';
import { formatCurrency } from '@/lib/money';

export interface InventoryValuationBarChartProps {
  products: Product[];
  className?: string;
}

export const InventoryValuationBarChart: React.FC<InventoryValuationBarChartProps> = ({
  products,
  className = '',
}) => {
  // Aggregate real inventory value grouped by brand
  const brandData = useMemo(() => {
    const map: Record<string, { brand: string; totalValue: number; skuCount: number; totalUnits: number }> = {};

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

    const list = Object.values(map).sort((a, b) => b.totalValue - a.totalValue);
    return list.slice(0, 5);
  }, [products]);

  const maxVal = useMemo(() => {
    return Math.max(...brandData.map((b) => b.totalValue), 1);
  }, [brandData]);

  const totalCatalogValue = useMemo(() => {
    return products.reduce((acc, p) => acc + (p.currentStock || 0) * (p.purchaseCost || 0), 0);
  }, [products]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
            Top Brands by Stock Valuation
          </h4>
          <div className="text-lg font-bold text-navy-700 tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(totalCatalogValue)}
            <span className="text-xs font-medium text-content-secondary ml-1.5">total warehouse inventory</span>
          </div>
        </div>
        <span className="text-2xs font-semibold text-content-secondary px-2.5 py-1 bg-slate-100 rounded-lg">
          {products.length} Active SKUs
        </span>
      </div>

      {brandData.length === 0 ? (
        <div className="py-8 text-center text-xs text-content-muted">
          No inventory stock records available.
        </div>
      ) : (
        <div className="space-y-3.5 pt-1">
          {brandData.map((item) => {
            const pct = Math.min(100, Math.round((item.totalValue / maxVal) * 100));
            return (
              <div key={item.brand} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-content-primary">{item.brand}</span>
                    <span className="text-2xs text-content-muted font-medium">
                      ({item.skuCount} SKU{item.skuCount > 1 ? 's' : ''} • {item.totalUnits} units)
                    </span>
                  </div>
                  <span className="font-bold tabular-nums text-navy-700">
                    {formatCurrency(item.totalValue)}
                  </span>
                </div>

                {/* Progress bar container */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-600 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
