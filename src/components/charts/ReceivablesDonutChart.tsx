import React, { useMemo } from 'react';
import { Invoice } from '@/types';
import { formatCurrency, calculateInvoiceBalance } from '@/lib/money';

export interface ReceivablesDonutChartProps {
  invoices: Invoice[];
  className?: string;
}

export const ReceivablesDonutChart: React.FC<ReceivablesDonutChartProps> = ({ invoices, className = '' }) => {
  const { totalInvoiced, totalSettled, totalOutstanding, settledPct, overdueCount } = useMemo(() => {
    let invoiced = 0;
    let settled = 0;
    let outstanding = 0;
    let overdue = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    invoices.forEach((inv) => {
      if (inv.status !== 'CANCELLED') {
        invoiced += inv.totalAmount;
        settled += inv.totalPaid || 0;
        const bal = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid || 0);
        if (bal > 0) {
          outstanding += bal;
          if (inv.dueDate && inv.dueDate < todayStr) {
            overdue++;
          }
        }
      }
    });

    const pct = invoiced > 0 ? Math.round((settled / invoiced) * 100) : 100;
    return {
      totalInvoiced: invoiced,
      totalSettled: settled,
      totalOutstanding: outstanding,
      settledPct: pct,
      overdueCount: overdue,
    };
  }, [invoices]);

  // Donut geometry constants
  const size = 180;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Calculate stroke dash offsets
  const settledStroke = (settledPct / 100) * circumference;
  const outstandingStroke = circumference - settledStroke;

  return (
    <div className={`flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
            Receivables & Collections
          </h4>
          <div className="text-lg font-bold text-navy-700 tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(totalOutstanding)}
            <span className="text-xs font-medium text-content-secondary ml-1.5">outstanding</span>
          </div>
        </div>
        {overdueCount > 0 ? (
          <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            {overdueCount} Overdue
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Good Standing
          </span>
        )}
      </div>

      {/* Donut graphic and metric breakdown */}
      <div className="flex flex-col sm:flex-row items-center justify-around gap-6 py-4">
        {/* SVG Donut */}
        <div className="relative w-40 h-40 shrink-0">
          <svg className="w-full h-full -rotate-90 transform" viewBox={`0 0 ${size} ${size}`}>
            {/* Background Ring (Outstanding / Unsettled) */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#E2E8F0"
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Settled / Paid segment (Teal) */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#0D9488"
              strokeWidth={strokeWidth}
              strokeDasharray={`${settledStroke} ${circumference}`}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-500 ease-out"
            />
            {/* Outstanding segment (Navy / Amber) */}
            {totalOutstanding > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={overdueCount > 0 ? '#F59E0B' : '#142B4D'}
                strokeWidth={strokeWidth}
                strokeDasharray={`${outstandingStroke} ${circumference}`}
                strokeDashoffset={-settledStroke}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-500 ease-out"
              />
            )}
          </svg>

          {/* Centered Donut Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold text-navy-700 tabular-nums">
              {settledPct}%
            </span>
            <span className="text-3xs uppercase font-bold tracking-wider text-slate-400">
              Recovered
            </span>
          </div>
        </div>

        {/* Legend & Amounts */}
        <div className="flex-1 w-full space-y-3">
          {/* Settled Row */}
          <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-teal-50/70 border border-teal-200/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-600 shrink-0" />
              <span className="font-semibold text-teal-900">Settled (Paid)</span>
            </div>
            <span className="font-bold tabular-nums text-teal-900">
              {formatCurrency(totalSettled)}
            </span>
          </div>

          {/* Outstanding Row */}
          <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 border border-border">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${overdueCount > 0 ? 'bg-amber-500' : 'bg-navy-700'}`} />
              <span className="font-semibold text-content-primary">Pending Balance</span>
            </div>
            <span className="font-bold tabular-nums text-navy-700">
              {formatCurrency(totalOutstanding)}
            </span>
          </div>

          {/* Total Invoiced Row */}
          <div className="flex items-center justify-between text-xs px-2 pt-1 text-content-secondary">
            <span>Total Invoiced</span>
            <span className="font-semibold tabular-nums text-content-primary">
              {formatCurrency(totalInvoiced)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
