import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  Info,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Customer } from '@/types';
import { customersService } from '@/services/customers.service';
import { reportsService, ReportProgress, ReportFilterParams } from '@/services/reports.service';
import { triggerExcelDownload } from '@/lib/excel';
import {
  getAvailableFinancialYears,
  getFinancialYearRange,
  getMonthDateRange,
  getSingleDayDateRange,
  isValidDateRange,
} from '@/lib/financial-years';
import { getBusinessDate } from '@/lib/dates';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export const SalesReceiptsReportPage: React.FC = () => {
  const { currentOrg, isMockAuth, isDemoMode } = useOrg();

  // Reference date in business timezone
  const todayStr = useMemo(() => getBusinessDate(), []);
  const availableFys = useMemo(() => getAvailableFinancialYears(5, todayStr), [todayStr]);

  // Current and previous FY IDs
  const currentFyId = availableFys[0]?.id || '2026-27';
  const previousFyId = availableFys[1]?.id || '2025-26';
  const currentMonthStr = todayStr.slice(0, 7); // YYYY-MM

  // Filter state
  const [periodType, setPeriodType] = useState<'FY' | 'MONTH' | 'DAY' | 'CUSTOM'>('FY');
  const [selectedFy, setSelectedFy] = useState<string>(currentFyId);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedDay, setSelectedDay] = useState<string>(todayStr);
  const [customStartDate, setCustomStartDate] = useState<string>(availableFys[0]?.startDate || todayStr);
  const [customEndDate, setCustomEndDate] = useState<string>(availableFys[0]?.endDate || todayStr);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [documentType, setDocumentType] = useState<'ALL' | 'INVOICES' | 'PAYMENTS'>('ALL');
  const [invoiceStatus, setInvoiceStatus] = useState<string>('ALL');

  // Customer options
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // Preview Counts & Export state
  const [counts, setCounts] = useState<{ invoiceCount: number; paymentCount: number }>({
    invoiceCount: 0,
    paymentCount: 0,
  });
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ReportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);

  // Compute effective date range
  const dateRange = useMemo(() => {
    try {
      if (periodType === 'FY') {
        const fy = availableFys.find((f) => f.id === selectedFy) || availableFys[0];
        return getFinancialYearRange(fy.id);
      } else if (periodType === 'MONTH') {
        return getMonthDateRange(selectedMonth);
      } else if (periodType === 'DAY') {
        return getSingleDayDateRange(selectedDay);
      } else {
        return {
          startDate: customStartDate,
          endDate: customEndDate,
          label: `${customStartDate} to ${customEndDate}`,
        };
      }
    } catch {
      return {
        startDate: todayStr,
        endDate: todayStr,
        label: todayStr,
      };
    }
  }, [periodType, selectedFy, selectedMonth, selectedDay, customStartDate, customEndDate, availableFys, todayStr]);

  // Load customer directory
  useEffect(() => {
    let isMounted = true;
    if (!currentOrg?.id) return;

    setIsLoadingCustomers(true);
    customersService
      .getCustomers(currentOrg.id, isMockAuth)
      .then((data) => {
        if (isMounted) {
          setCustomers(data);
          setIsLoadingCustomers(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to load customers for report filter:', err);
          setIsLoadingCustomers(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentOrg?.id, isMockAuth]);

  // Selected customer object
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return undefined;
    return customers.find((c) => c.id === selectedCustomerId);
  }, [selectedCustomerId, customers]);

  // Fetch preview counts when filters change
  const fetchCounts = useCallback(async () => {
    if (!currentOrg?.id) return;
    if (periodType === 'CUSTOM' && !isValidDateRange(customStartDate, customEndDate)) {
      return;
    }

    setIsLoadingCounts(true);
    try {
      const filterParams: ReportFilterParams = {
        periodType,
        periodLabel: dateRange.label,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        customerId: selectedCustomerId || undefined,
        customerName: selectedCustomer ? selectedCustomer.name : undefined,
        documentType,
        invoiceStatus: invoiceStatus !== 'ALL' ? invoiceStatus : undefined,
      };

      const res = await reportsService.getMatchingCounts(currentOrg.id, filterParams, isMockAuth);
      setCounts(res);
    } catch (err: any) {
      console.error('Failed to fetch report preview counts:', err);
    } finally {
      setIsLoadingCounts(false);
    }
  }, [
    currentOrg?.id,
    periodType,
    customStartDate,
    customEndDate,
    dateRange,
    selectedCustomerId,
    selectedCustomer,
    documentType,
    invoiceStatus,
    isMockAuth,
  ]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Handle Preset Clicks
  const handlePresetClick = (type: 'current-fy' | 'prev-fy' | 'month' | 'day' | 'custom') => {
    setExportError(null);
    setExportSuccessMessage(null);

    if (type === 'current-fy') {
      setPeriodType('FY');
      setSelectedFy(currentFyId);
    } else if (type === 'prev-fy') {
      setPeriodType('FY');
      setSelectedFy(previousFyId);
    } else if (type === 'month') {
      setPeriodType('MONTH');
      setSelectedMonth(currentMonthStr);
    } else if (type === 'day') {
      setPeriodType('DAY');
      setSelectedDay(todayStr);
    } else {
      setPeriodType('CUSTOM');
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setPeriodType('FY');
    setSelectedFy(currentFyId);
    setSelectedMonth(currentMonthStr);
    setSelectedDay(todayStr);
    setCustomStartDate(availableFys[0]?.startDate || todayStr);
    setCustomEndDate(availableFys[0]?.endDate || todayStr);
    setSelectedCustomerId('');
    setDocumentType('ALL');
    setInvoiceStatus('ALL');
    setExportError(null);
    setExportSuccessMessage(null);
  };

  // Trigger Excel Export
  const handleExportExcel = async () => {
    if (!currentOrg) return;

    if (periodType === 'CUSTOM' && !isValidDateRange(customStartDate, customEndDate)) {
      setExportError('Invalid custom date range: Start date must be before or equal to End date.');
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportSuccessMessage(null);
    setExportProgress({
      stage: 'counting',
      current: 0,
      total: 1,
      message: 'Initializing authoritative export query...',
    });

    try {
      const filterParams: ReportFilterParams = {
        periodType,
        periodLabel: dateRange.label,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        customerId: selectedCustomerId || undefined,
        customerName: selectedCustomer ? selectedCustomer.name : undefined,
        documentType,
        invoiceStatus: invoiceStatus !== 'ALL' ? invoiceStatus : undefined,
      };

      const result = await reportsService.exportReport(
        currentOrg,
        filterParams,
        isMockAuth,
        (prog) => setExportProgress(prog)
      );

      triggerExcelDownload(result.buffer, result.filename);

      setExportSuccessMessage(
        `Successfully exported ${result.filename} (${counts.invoiceCount} invoices, ${counts.paymentCount} receipts).`
      );
    } catch (err: any) {
      console.error('Excel Export Error:', err);
      setExportError(err?.message || 'Failed to generate Excel report. Please verify connection and retry.');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Sales & Receipts Reports
            </h1>
            <Badge variant="info" className="gap-1.5 shrink-0">
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              <span>Excel Export Engine</span>
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Export comprehensive historical invoices, product line items, payment receipts, and reconciliation ledgers
            to Microsoft Excel (.xlsx).
          </p>
        </div>

        {/* Demo Mode Badge */}
        {(isDemoMode || isMockAuth) && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-700 text-xs font-medium">
            <Info className="w-4 h-4 shrink-0" />
            <span>Demo Mode — Sample Data Only</span>
          </div>
        )}
      </div>

      {/* Main Filter Control Card */}
      <Card className="p-6 space-y-6 shadow-sm border-border bg-surface-card">
        {/* Presets Header Row */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2.5">
            Quick Period Presets
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handlePresetClick('current-fy')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                periodType === 'FY' && selectedFy === currentFyId
                  ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                  : 'bg-surface-secondary text-content-primary border-border hover:bg-surface-tertiary'
              }`}
            >
              Current FY ({currentFyId})
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('prev-fy')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                periodType === 'FY' && selectedFy === previousFyId
                  ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                  : 'bg-surface-secondary text-content-primary border-border hover:bg-surface-tertiary'
              }`}
            >
              Previous FY ({previousFyId})
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                periodType === 'MONTH'
                  ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                  : 'bg-surface-secondary text-content-primary border-border hover:bg-surface-tertiary'
              }`}
            >
              Current Month
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('day')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                periodType === 'DAY'
                  ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                  : 'bg-surface-secondary text-content-primary border-border hover:bg-surface-tertiary'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handlePresetClick('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                periodType === 'CUSTOM'
                  ? 'bg-teal-600 text-white border-teal-600 shadow-2xs'
                  : 'bg-surface-secondary text-content-primary border-border hover:bg-surface-tertiary'
              }`}
            >
              Custom Date Range
            </button>
          </div>
        </div>

        {/* Detailed Filter Inputs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-border/60">
          {/* Period Selector Dynamic Column */}
          {periodType === 'FY' && (
            <div>
              <label htmlFor="select-fy" className="block text-xs font-medium text-content-secondary mb-1.5">
                Indian Financial Year (Apr 1 – Mar 31)
              </label>
              <select
                id="select-fy"
                value={selectedFy}
                onChange={(e) => setSelectedFy(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
              >
                {availableFys.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {periodType === 'MONTH' && (
            <div>
              <label htmlFor="select-month" className="block text-xs font-medium text-content-secondary mb-1.5">
                Select Calendar Month
              </label>
              <input
                id="select-month"
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
              />
            </div>
          )}

          {periodType === 'DAY' && (
            <div>
              <label htmlFor="select-day" className="block text-xs font-medium text-content-secondary mb-1.5">
                Select Single Calendar Date
              </label>
              <input
                id="select-day"
                type="date"
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
              />
            </div>
          )}

          {periodType === 'CUSTOM' && (
            <>
              <div>
                <label htmlFor="custom-start" className="block text-xs font-medium text-content-secondary mb-1.5">
                  Start Date (From)
                </label>
                <input
                  id="custom-start"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
                />
              </div>
              <div>
                <label htmlFor="custom-end" className="block text-xs font-medium text-content-secondary mb-1.5">
                  End Date (To)
                </label>
                <input
                  id="custom-end"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
                />
              </div>
            </>
          )}

          {/* Customer Filter */}
          <div>
            <label htmlFor="select-customer" className="block text-xs font-medium text-content-secondary mb-1.5">
              Customer Account
            </label>
            <select
              id="select-customer"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              disabled={isLoadingCustomers}
              className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs disabled:opacity-60"
            >
              <option value="">All Customers & Trade Accounts</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.companyName ? `(${c.companyName})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Document Type */}
          <div>
            <label htmlFor="select-doc-type" className="block text-xs font-medium text-content-secondary mb-1.5">
              Export Scope
            </label>
            <select
              id="select-doc-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as any)}
              className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
            >
              <option value="ALL">All Documents (Invoices + Receipts)</option>
              <option value="INVOICES">Invoices & Products Only</option>
              <option value="PAYMENTS">Payment Receipts & Allocations Only</option>
            </select>
          </div>

          {/* Invoice Status Filter */}
          {documentType !== 'PAYMENTS' && (
            <div>
              <label htmlFor="select-status" className="block text-xs font-medium text-content-secondary mb-1.5">
                Invoice Status
              </label>
              <select
                id="select-status"
                value={invoiceStatus}
                onChange={(e) => setInvoiceStatus(e.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-surface-card px-3 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="ISSUED">ISSUED</option>
                <option value="PARTIALLY_PAID">PARTIALLY_PAID</option>
                <option value="PAID">PAID</option>
                <option value="DRAFT">DRAFT</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>
          )}
        </div>

        {/* Clear Filters & Date Range Summary */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border/60">
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
            <span>
              Authoritative Filter Window:{' '}
              <strong className="text-content-primary font-semibold">
                {dateRange.startDate} to {dateRange.endDate}
              </strong>{' '}
              ({dateRange.label})
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="text-xs text-content-secondary hover:text-content-primary self-start sm:self-auto gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </Button>
        </div>
      </Card>

      {/* Live Preview & Action Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Preview Card 1: Invoices */}
        <Card className="p-5 border-border bg-surface-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
              Matching Invoices
            </span>
            <Badge variant="default" className="text-xs font-mono">
              Invoices Table
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-content-primary">
              {isLoadingCounts ? '—' : counts.invoiceCount}
            </span>
            <span className="text-xs text-content-secondary">invoices</span>
          </div>
          <p className="text-xs text-content-secondary">
            Includes all billed product line items, statutory GST splits, and current outstanding balances.
          </p>
        </Card>

        {/* Preview Card 2: Receipts */}
        <Card className="p-5 border-border bg-surface-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
              Matching Receipts
            </span>
            <Badge variant="default" className="text-xs font-mono">
              Receipts Table
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-content-primary">
              {isLoadingCounts ? '—' : counts.paymentCount}
            </span>
            <span className="text-xs text-content-secondary">receipts</span>
          </div>
          <p className="text-xs text-content-secondary">
            Includes payment methods (CASH, UPI, NEFT, RTGS, CHEQUE), reference UTRs, and invoice allocations.
          </p>
        </Card>

        {/* Export Action Card */}
        <Card className="p-5 border-border bg-surface-card flex flex-col justify-between space-y-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-content-secondary block mb-1">
              One-Click Excel Download
            </span>
            <p className="text-xs text-content-secondary">
              Generates an audit-ready multi-tab Microsoft Excel (.xlsx) workbook with full formula injection protection.
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleExportExcel}
            disabled={isExporting || isLoadingCounts}
            className="w-full gap-2 font-semibold shadow-sm"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Exporting Workbook...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Export Excel (.xlsx)</span>
              </>
            )}
          </Button>
        </Card>
      </div>

      {/* Progress & Status Banners */}
      {exportProgress && (
        <div className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-800 text-sm flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-teal-600 shrink-0" />
          <div>
            <p className="font-semibold">{exportProgress.message}</p>
            {exportProgress.total > 0 && exportProgress.current > 0 && (
              <p className="text-xs text-teal-700 mt-0.5">
                Processed {exportProgress.current} of {exportProgress.total} records...
              </p>
            )}
          </div>
        </div>
      )}

      {exportSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="font-medium">{exportSuccessMessage}</p>
        </div>
      )}

      {exportError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-800 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <p className="font-medium">{exportError}</p>
        </div>
      )}

      {/* Technical & Audit Notes Section */}
      <Card className="p-5 border-border bg-surface-secondary/40 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-content-primary flex items-center gap-2">
          <Building2 className="w-4 h-4 text-teal-600" />
          <span>Statutory Accounting & Reconciliation Standards</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-content-secondary">
          <div className="space-y-1">
            <p className="font-medium text-content-primary">Period Attribution Rules:</p>
            <p>
              Invoices are strictly filtered by their recorded business issue date (<code>invoice_date</code>), while
              collections are filtered by actual settlement date (<code>payment_date</code>). Cross-period payments are
              reconciled without misplaced revenue.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-content-primary">Historical Snapshot Integrity:</p>
            <p>
              Product names, SKUs, HSN codes, unit prices, and GST rates are extracted directly from immutable line item
              records stored at invoice issuance, preventing silent retrospective modifications.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
