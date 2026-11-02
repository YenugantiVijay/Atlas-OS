import React, { useState, useMemo } from 'react';
import { SalesOrder } from '@/types';
import { formatCurrency } from '@/lib/money';

export interface SalesTrendChartProps {
  orders: SalesOrder[];
  className?: string;
}

type TimeRange = '7D' | '30D' | '90D' | 'ALL';

export const SalesTrendChart: React.FC<SalesTrendChartProps> = ({ orders, className = '' }) => {
  const [range, setRange] = useState<TimeRange>('30D');
  const [hoveredPoint, setHoveredPoint] = useState<{ date: string; label: string; amount: number; x: number; y: number } | null>(null);

  // Filter orders by time range and group by date
  const chartData = useMemo(() => {
    const now = new Date();
    const days = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : 365;
    
    // Generate consecutive dates up to today
    const dateMap: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dateMap[key] = 0;
    }

    // Aggregate real order values
    orders.forEach((o) => {
      if ((o.status === 'CONFIRMED' || o.status === 'FULFILLED') && dateMap[o.orderDate] !== undefined) {
        dateMap[o.orderDate] += o.totalAmount;
      }
    });

    const entries = Object.entries(dateMap).map(([date, amount]) => ({
      date,
      amount,
      label: new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    }));

    return entries;
  }, [orders, range]);

  const maxAmount = useMemo(() => {
    const max = Math.max(...chartData.map((d) => d.amount), 0);
    return max > 0 ? Math.ceil(max * 1.15) : 10000;
  }, [chartData]);

  // SVG dimensions & coordinate transforms
  const svgWidth = 600;
  const svgHeight = 200;
  const padding = { top: 20, right: 25, bottom: 35, left: 55 };
  const graphWidth = svgWidth - padding.left - padding.right;
  const graphHeight = svgHeight - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (chartData.length === 0) return [];
    return chartData.map((d, index) => {
      const x = padding.left + (index / (chartData.length - 1 || 1)) * graphWidth;
      const y = padding.top + graphHeight - (d.amount / maxAmount) * graphHeight;
      return { ...d, x, y };
    });
  }, [chartData, maxAmount, graphWidth, graphHeight, padding.left, padding.top]);

  // Generate smooth cubic bezier SVG path
  const pathData = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, point, i, arr) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      const prev = arr[i - 1];
      const cx = (prev.x + point.x) / 2;
      return `${acc} C ${cx} ${prev.y}, ${cx} ${point.y}, ${point.x} ${point.y}`;
    }, '');
  }, [points]);

  const areaData = useMemo(() => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    const baselineY = padding.top + graphHeight;
    return `${pathData} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
  }, [pathData, points, padding.top, graphHeight]);

  const totalPeriodRevenue = useMemo(() => {
    return chartData.reduce((sum, d) => sum + d.amount, 0);
  }, [chartData]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Chart Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
            Sales Performance Over Time
          </div>
          <div className="text-xl font-bold text-navy-700 tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(totalPeriodRevenue)}
            <span className="text-xs font-normal text-content-secondary ml-2">
              total confirmed in {range === '7D' ? 'last 7 days' : range === '30D' ? 'last 30 days' : range === '90D' ? 'last 90 days' : 'period'}
            </span>
          </div>
        </div>

        {/* Range Buttons */}
        <div className="inline-flex rounded-lg border border-border bg-slate-50 p-0.5 self-start sm:self-auto shadow-2xs">
          {(['7D', '30D', '90D'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                range === r
                  ? 'bg-teal-600 text-white shadow-2xs'
                  : 'text-content-secondary hover:text-content-primary hover:bg-slate-100'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full overflow-hidden rounded-xl bg-slate-50/50 p-2 border border-border/80">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-48 sm:h-56 overflow-visible"
        >
          <defs>
            <linearGradient id="tealAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0D9488" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0D9488" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = padding.top + graphHeight * (1 - pct);
            const val = maxAmount * pct;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="text-2xs fill-slate-400 font-mono"
                  fontSize="9.5"
                >
                  {val >= 1000 ? `₹${(val / 1000).toFixed(0)}k` : `₹${val.toFixed(0)}`}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          {areaData && <path d={areaData} fill="url(#tealAreaGradient)" />}

          {/* Line stroke */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke="#0D9488"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points */}
          {points.map((p, i) => {
            // Show every nth point label on X-axis to avoid crowding
            const step = Math.ceil(points.length / 6);
            const showLabel = i % step === 0 || i === points.length - 1;

            return (
              <g key={p.date}>
                {showLabel && (
                  <text
                    x={p.x}
                    y={svgHeight - 12}
                    textAnchor="middle"
                    className="text-2xs fill-slate-400 font-medium"
                    fontSize="9.5"
                  >
                    {p.label}
                  </text>
                )}

                {/* Point dot circle with interactive hover trigger */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoveredPoint?.date === p.date ? 5 : p.amount > 0 ? 3 : 2}
                  fill={p.amount > 0 ? '#0D9488' : '#CBD5E1'}
                  stroke="#FFFFFF"
                  strokeWidth={hoveredPoint?.date === p.date ? 2 : 1}
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => setHoveredPoint(p)}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              </g>
            );
          })}
        </svg>

        {/* Hover Floating Tooltip */}
        {hoveredPoint && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-navy-700 px-2.5 py-1.5 text-2xs text-white shadow-dropdown animate-in fade-in"
            style={{
              left: `${(hoveredPoint.x / svgWidth) * 100}%`,
              top: `${(hoveredPoint.y / svgHeight) * 100}%`,
              marginTop: '-8px',
            }}
          >
            <div className="font-semibold text-teal-300">{hoveredPoint.label}</div>
            <div className="font-bold tabular-nums text-white mt-0.5">
              {formatCurrency(hoveredPoint.amount)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
