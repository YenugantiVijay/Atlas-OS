/**
 * Atlas OS — Financial Reporting & Bounded Excel Data Service
 *
 * Implements bounded pagination, stream chunking, tenant-isolated data retrieval,
 * authoritative count enforcement, and pre-export integrity verification
 * for complete historical invoice and payment receipt reporting.
 */

import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Invoice, Payment, Organization, Role } from '@/types';
import { ReportCriteria, generateSalesReceiptsWorkbook, ReferencedInvoiceMeta } from '@/lib/excel';
import { mapDbInvoice, mapDbInvoiceItem } from './invoices.service';
import { mapDbPayment, mapDbPaymentAllocation } from './payments.service';
import { hasPermission } from '@/lib/permissions';

export class ExportIntegrityError extends Error {
  constructor(message: string, public readonly code: string = 'EXPORT_INTEGRITY_ERROR') {
    super(message);
    this.name = 'ExportIntegrityError';
  }
}

/**
 * Maximum safe number of invoices for client-side browser Excel generation.
 * Beyond 10,000 records, browser tab memory and network payload constraints
 * necessitate narrowing the date range or filtering by customer.
 */
export const MAX_SAFE_EXPORT_INVOICES = 10000;

export interface ReportFilterParams {
  periodType: 'FY' | 'MONTH' | 'DAY' | 'CUSTOM';
  periodLabel: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  customerId?: string;
  customerName?: string;
  documentType: 'ALL' | 'INVOICES' | 'PAYMENTS';
  invoiceStatus?: string; // 'ALL' or specific status
  userRole?: Role;
}

export interface ReportCounts {
  invoiceCount: number;
  paymentCount: number;
}

export interface ReportProgress {
  stage: 'counting' | 'invoices' | 'payments' | 'referencing' | 'building' | 'complete';
  current: number;
  total: number;
  message: string;
}

export interface ReportDataResult {
  invoices: Invoice[];
  payments: Payment[];
  referencedInvoices: Map<string, ReferencedInvoiceMeta>;
}

/**
 * The browser role is presentation state, not authority. PostgreSQL verifies
 * authenticated membership and role before any financial report is fetched.
 *
 * This is a report-operation gate, not a substitute for narrow table SELECT
 * policies; the latter are intentionally preserved for other ERP workflows.
 */
async function assertCloudFinancialReportAccess(orgId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
  }

  const { data, error } = await supabase.rpc('assert_financial_report_access', {
    p_org_id: orgId,
  });

  // Fail closed on unavailable/misconfigured RPC, revoked membership, or
  // unexpected response shape. No financial query should execute afterward.
  if (error || data !== true) {
    throw new Error(
      `Unauthorized: Database could not verify financial reporting permission. ${error?.message || 'Access was not granted.'}`
    );
  }
}

export const reportsService = {
  /**
   * Authoritatively retrieves exact record counts matching current criteria
   * without downloading full record payloads.
   */
  async getMatchingCounts(
    orgId: string,
    params: ReportFilterParams,
    isMockAuth: boolean = false
  ): Promise<ReportCounts> {
    if (params.userRole && !hasPermission(params.userRole, 'reports:financial')) {
      throw new Error('Unauthorized: User role does not have permission to view financial reports.');
    }

    if (isMockAuth) {
      let invoices = storage.getInvoices(orgId);
      let payments = storage.getPayments(orgId);

      // Filter invoices
      invoices = invoices.filter((inv) => {
        if (inv.invoiceDate < params.startDate || inv.invoiceDate > params.endDate) {
          return false;
        }
        if (params.customerId && inv.customerId !== params.customerId) {
          return false;
        }
        if (params.invoiceStatus && params.invoiceStatus !== 'ALL' && inv.status !== params.invoiceStatus) {
          return false;
        }
        return true;
      });

      // Filter payments
      payments = payments.filter((p) => {
        if (p.paymentDate < params.startDate || p.paymentDate > params.endDate) {
          return false;
        }
        if (params.customerId && p.customerId !== params.customerId) {
          return false;
        }
        return true;
      });

      return {
        invoiceCount: params.documentType === 'PAYMENTS' ? 0 : invoices.length,
        paymentCount: params.documentType === 'INVOICES' ? 0 : payments.length,
      };
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    await assertCloudFinancialReportAccess(orgId);

    await assertCloudFinancialReportAccess(orgId);

    let invoiceCount = 0;
    let paymentCount = 0;

    // 1. Invoices Count Query (head: true transfers 0 data rows)
    if (params.documentType !== 'PAYMENTS') {
      let invQuery = supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('invoice_date', params.startDate)
        .lte('invoice_date', params.endDate);

      if (params.customerId) {
        invQuery = invQuery.eq('customer_id', params.customerId);
      }
      if (params.invoiceStatus && params.invoiceStatus !== 'ALL') {
        invQuery = invQuery.eq('status', params.invoiceStatus);
      }

      const { count: invCount, error: invErr } = await invQuery;
      if (invErr) {
        throw new Error(`Failed to count invoices for reporting: ${invErr.message}`);
      }
      invoiceCount = invCount || 0;
    }

    // 2. Payments Count Query
    if (params.documentType !== 'INVOICES') {
      let payQuery = supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('payment_date', params.startDate)
        .lte('payment_date', params.endDate);

      if (params.customerId) {
        payQuery = payQuery.eq('customer_id', params.customerId);
      }

      const { count: payCount, error: payErr } = await payQuery;
      if (payErr) {
        throw new Error(`Failed to count payments for reporting: ${payErr.message}`);
      }
      paymentCount = payCount || 0;
    }

    return { invoiceCount, paymentCount };
  },

  /**
   * Fetches full historical data using deterministic bounded batch pagination
   * with strict duplicate detection, missing record verification, and cross-period
   * payment allocation reference resolution.
   */
  async fetchReportData(
    orgId: string,
    params: ReportFilterParams,
    isMockAuth: boolean = false,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<ReportDataResult> {
    if (params.userRole && !hasPermission(params.userRole, 'reports:financial')) {
      throw new Error('Unauthorized: User role does not have permission to export financial reports.');
    }

    if (isMockAuth) {
      onProgress?.({
        stage: 'invoices',
        current: 0,
        total: 1,
        message: 'Loading demo records from local storage...',
      });

      let invoices = storage.getInvoices(orgId);
      let payments = storage.getPayments(orgId);

      if (params.documentType !== 'PAYMENTS') {
        invoices = invoices.filter((inv) => {
          if (inv.invoiceDate < params.startDate || inv.invoiceDate > params.endDate) return false;
          if (params.customerId && inv.customerId !== params.customerId) return false;
          if (params.invoiceStatus && params.invoiceStatus !== 'ALL' && inv.status !== params.invoiceStatus) return false;
          return true;
        });
      } else {
        invoices = [];
      }

      if (params.documentType !== 'INVOICES') {
        payments = payments.filter((p) => {
          if (p.paymentDate < params.startDate || p.paymentDate > params.endDate) return false;
          if (params.customerId && p.customerId !== params.customerId) return false;
          return true;
        });
      } else {
        payments = [];
      }

      // Check export limit
      if (invoices.length > MAX_SAFE_EXPORT_INVOICES) {
        throw new ExportIntegrityError(
          `Export threshold exceeded: The selected period contains ${invoices.length} invoices, exceeding the browser memory safety limit of ${MAX_SAFE_EXPORT_INVOICES} invoices. Please refine your filter.`,
          'EXPORT_THRESHOLD_EXCEEDED'
        );
      }

      // Check for integrity in demo invoices
      const seenDemoIds = new Set<string>();
      for (const inv of invoices) {
        if (seenDemoIds.has(inv.id)) {
          throw new ExportIntegrityError(
            `Duplicate invoice detected in dataset: Invoice ID '${inv.id}' (${inv.invoiceNumber}) appears multiple times.`,
            'DUPLICATE_ROW'
          );
        }
        seenDemoIds.add(inv.id);
        if (inv.subtotal > 0 && (!inv.items || inv.items.length === 0)) {
          throw new ExportIntegrityError(
            `Missing invoice line items: Invoice '${inv.invoiceNumber}' (ID: ${inv.id}) has subtotal ₹${inv.subtotal} but 0 line items. Export aborted to prevent corrupt reports.`,
            'MISSING_ITEMS'
          );
        }
      }

      // Resolve cross-period referenced invoices from demo storage
      const referencedInvoices = new Map<string, ReferencedInvoiceMeta>();
      for (const inv of invoices) {
        referencedInvoices.set(inv.id, {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          status: inv.status,
        });
      }

      const allOrgInvoices = storage.getInvoices(orgId);
      for (const p of payments) {
        if (p.allocations) {
          for (const a of p.allocations) {
            if (a.invoiceId && !referencedInvoices.has(a.invoiceId)) {
              const match = allOrgInvoices.find((i) => i.id === a.invoiceId);
              if (match) {
                referencedInvoices.set(match.id, {
                  id: match.id,
                  invoiceNumber: match.invoiceNumber,
                  invoiceDate: match.invoiceDate,
                  status: match.status,
                });
              }
            }
          }
        }
      }

      onProgress?.({
        stage: 'complete',
        current: invoices.length + payments.length,
        total: invoices.length + payments.length,
        message: 'Demo records loaded.',
      });

      return { invoices, payments, referencedInvoices };
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const BATCH_SIZE = 250;
    const allInvoices: Invoice[] = [];
    const allPayments: Payment[] = [];
    const seenInvoiceIds = new Set<string>();
    const seenPaymentIds = new Set<string>();

    // --- 1. Fetch Invoices in deterministic bounded batches ---
    if (params.documentType !== 'PAYMENTS') {
      const buildInvoiceCountQuery = () => {
        let q = supabase!
          .from('invoices')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .gte('invoice_date', params.startDate)
          .lte('invoice_date', params.endDate);

        if (params.customerId) {
          q = q.eq('customer_id', params.customerId);
        }
        if (params.invoiceStatus && params.invoiceStatus !== 'ALL') {
          q = q.eq('status', params.invoiceStatus);
        }
        return q;
      };

      const { count: totalInvoices, error: countErr } = await buildInvoiceCountQuery();
      if (countErr) {
        throw new Error(`Failed to count invoices: ${countErr.message}`);
      }

      const total = totalInvoices || 0;

      if (total > MAX_SAFE_EXPORT_INVOICES) {
        throw new ExportIntegrityError(
          `Export threshold exceeded: The selected period contains ${total} invoices, exceeding the safe limit of ${MAX_SAFE_EXPORT_INVOICES} invoices. Please refine your filter by choosing a shorter period or specific customer.`,
          'EXPORT_THRESHOLD_EXCEEDED'
        );
      }

      let fetched = 0;

      while (fetched < total) {
        const from = fetched;
        const to = Math.min(fetched + BATCH_SIZE - 1, total - 1);

        onProgress?.({
          stage: 'invoices',
          current: fetched,
          total,
          message: `Fetching invoices ${from + 1} to ${to + 1} of ${total}...`,
        });

        let dataQuery = supabase
          .from('invoices')
          .select('*, items:invoice_items(*), customer:customers!fk_invoices_customer_org(*)')
          .eq('organization_id', orgId)
          .gte('invoice_date', params.startDate)
          .lte('invoice_date', params.endDate);

        if (params.customerId) {
          dataQuery = dataQuery.eq('customer_id', params.customerId);
        }
        if (params.invoiceStatus && params.invoiceStatus !== 'ALL') {
          dataQuery = dataQuery.eq('status', params.invoiceStatus);
        }

        // Deterministic sorting by invoice_date ascending with primary key tie-breaker
        dataQuery = dataQuery
          .order('invoice_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);

        const { data: rows, error } = await dataQuery;
        if (error) {
          throw new Error(`Failed to fetch invoice batch [${from}..${to}]: ${error.message}`);
        }

        if (!rows || rows.length === 0) {
          throw new ExportIntegrityError(
            `Incomplete invoice export: Expected ${total} invoices, but batch [${from}..${to}] unexpectedly returned 0 records. Data retrieval was interrupted.`,
            'INCOMPLETE_BATCH'
          );
        }

        for (const row of rows) {
          if (seenInvoiceIds.has(row.id)) {
            throw new ExportIntegrityError(
              `Duplicate invoice detected during export: Invoice ID '${row.id}' (${row.invoice_number}) was returned multiple times. Database records may have shifted concurrently.`,
              'DUPLICATE_ROW'
            );
          }
          seenInvoiceIds.add(row.id);

          let items = (row.items || []).map(mapDbInvoiceItem);

          // Nested item truncation protection: If an invoice has >= 1000 items, verify count
          if (items.length >= 1000) {
            items = await this.fetchAllInvoiceItemsIfTruncated(row.id, items);
          }

          if (row.subtotal > 0 && items.length === 0) {
            throw new ExportIntegrityError(
              `Missing invoice line items: Invoice '${row.invoice_number}' (ID: ${row.id}) has a subtotal of ₹${row.subtotal} but 0 line items were returned. Export aborted to prevent corrupt reports.`,
              'MISSING_ITEMS'
            );
          }

          allInvoices.push(mapDbInvoice(row, items));
        }

        fetched += rows.length;
      }

      // Post-batch verification
      if (allInvoices.length !== total) {
        throw new ExportIntegrityError(
          `Invoice count mismatch: Authoritative query counted ${total} invoices, but retrieved ${allInvoices.length}. Concurrent database changes detected.`,
          'COUNT_MISMATCH'
        );
      }

      // Re-verify snapshot consistency: check that count hasn't drifted mid-stream
      const { count: finalCount, error: recheckErr } = await buildInvoiceCountQuery();
      if (recheckErr || finalCount === null) {
        throw new ExportIntegrityError(
          `Invoice count recheck failed: ${recheckErr?.message || 'No count returned'}. Export aborted because completeness cannot be verified.`,
          'COUNT_RECHECK_FAILED'
        );
      }
      if (finalCount !== total) {
        throw new ExportIntegrityError(
          `Inconsistent database snapshot: Invoice count shifted from ${total} to ${finalCount} during retrieval. Concurrent modifications occurred. Please retry export.`,
          'SNAPSHOT_DRIFT'
        );
      }
    }

    // --- 2. Fetch Payments in deterministic bounded batches ---
    if (params.documentType !== 'INVOICES') {
      const buildPaymentCountQuery = () => {
        let q = supabase!
          .from('payments')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .gte('payment_date', params.startDate)
          .lte('payment_date', params.endDate);

        if (params.customerId) {
          q = q.eq('customer_id', params.customerId);
        }
        return q;
      };

      const { count: totalPayments, error: countErr } = await buildPaymentCountQuery();
      if (countErr) {
        throw new Error(`Failed to count payments: ${countErr.message}`);
      }

      const total = totalPayments || 0;
      let fetched = 0;

      while (fetched < total) {
        const from = fetched;
        const to = Math.min(fetched + BATCH_SIZE - 1, total - 1);

        onProgress?.({
          stage: 'payments',
          current: fetched,
          total,
          message: `Fetching receipts ${from + 1} to ${to + 1} of ${total}...`,
        });

        let dataQuery = supabase
          .from('payments')
          .select('*, allocations:payment_allocations(*), customer:customers!fk_payments_customer_org(*)')
          .eq('organization_id', orgId)
          .gte('payment_date', params.startDate)
          .lte('payment_date', params.endDate);

        if (params.customerId) {
          dataQuery = dataQuery.eq('customer_id', params.customerId);
        }

        // Deterministic sorting with tie-breaker
        dataQuery = dataQuery
          .order('payment_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);

        const { data: rows, error } = await dataQuery;
        if (error) {
          throw new Error(`Failed to fetch payment batch [${from}..${to}]: ${error.message}`);
        }

        if (!rows || rows.length === 0) {
          throw new ExportIntegrityError(
            `Incomplete payment export: Expected ${total} receipts, but batch [${from}..${to}] unexpectedly returned 0 records. Data retrieval was interrupted.`,
            'INCOMPLETE_BATCH'
          );
        }

        for (const row of rows) {
          if (seenPaymentIds.has(row.id)) {
            throw new ExportIntegrityError(
              `Duplicate payment detected during export: Payment ID '${row.id}' (${row.payment_number}) was returned multiple times.`,
              'DUPLICATE_ROW'
            );
          }
          seenPaymentIds.add(row.id);

          let allocations = (row.allocations || []).map(mapDbPaymentAllocation);

          // PostgREST embedded arrays may stop at the server's row limit.
          // Apply the same fail-closed completeness check as invoice line items.
          if (allocations.length >= 1000) {
            allocations = await this.fetchAllPaymentAllocationsIfTruncated(row.id, allocations);
          }

          allPayments.push(mapDbPayment(row, allocations));
        }

        fetched += rows.length;
      }

      // Post-batch verification
      if (allPayments.length !== total) {
        throw new ExportIntegrityError(
          `Payment count mismatch: Authoritative query counted ${total} receipts, but retrieved ${allPayments.length}. Concurrent database changes detected.`,
          'COUNT_MISMATCH'
        );
      }

      // Re-verify payment count snapshot consistency
      const { count: finalPayCount, error: recheckPayErr } = await buildPaymentCountQuery();
      if (recheckPayErr || finalPayCount === null) {
        throw new ExportIntegrityError(
          `Payment count recheck failed: ${recheckPayErr?.message || 'No count returned'}. Export aborted because completeness cannot be verified.`,
          'COUNT_RECHECK_FAILED'
        );
      }
      if (finalPayCount !== total) {
        throw new ExportIntegrityError(
          `Inconsistent database snapshot: Payment count shifted from ${total} to ${finalPayCount} during retrieval. Concurrent modifications occurred. Please retry export.`,
          'SNAPSHOT_DRIFT'
        );
      }
    }

    // --- 3. Resolve Cross-Period Referenced Invoices for Payment Allocations ---
    onProgress?.({
      stage: 'referencing',
      current: 1,
      total: 1,
      message: 'Resolving cross-period payment allocation references...',
    });

    const referencedInvoices = new Map<string, ReferencedInvoiceMeta>();

    // Seed with already retrieved period invoices
    for (const inv of allInvoices) {
      referencedInvoices.set(inv.id, {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        status: inv.status,
      });
    }

    // Identify referenced invoices that fall outside the reporting period
    const missingInvoiceIds = new Set<string>();
    for (const p of allPayments) {
      if (p.allocations) {
        for (const alloc of p.allocations) {
          if (alloc.invoiceId && !referencedInvoices.has(alloc.invoiceId)) {
            missingInvoiceIds.add(alloc.invoiceId);
          }
        }
      }
    }

    if (missingInvoiceIds.size > 0) {
      const missingArray = Array.from(missingInvoiceIds);
      for (let i = 0; i < missingArray.length; i += BATCH_SIZE) {
        const chunk = missingArray.slice(i, i + BATCH_SIZE);
        const { data: refRows, error: refErr } = await supabase
          .from('invoices')
          .select('id, invoice_number, invoice_date, status')
          .eq('organization_id', orgId)
          .in('id', chunk);

        if (refErr) {
          console.warn(`Failed to resolve cross-period referenced invoices: ${refErr.message}`);
        } else if (refRows) {
          for (const row of refRows) {
            referencedInvoices.set(row.id, {
              id: row.id,
              invoiceNumber: row.invoice_number,
              invoiceDate: row.invoice_date,
              status: row.status,
            });
          }
        }
      }
    }

    return { invoices: allInvoices, payments: allPayments, referencedInvoices };
  },

  /**
   * A PostgREST embedded relation can silently stop at 1,000 rows.
   * Verify and reload large invoice item arrays rather than exporting partial data.
   */
  async fetchAllInvoiceItemsIfTruncated(invoiceId: string, currentItems: any[]): Promise<any[]> {
    return this.fetchAllNestedRowsIfTruncated(
      'invoice_items',
      'invoice_id',
      invoiceId,
      currentItems,
      mapDbInvoiceItem
    );
  },

  /**
   * Payment allocations are subject to the same embedded row limit as invoice items.
   * An incomplete allocation list would misrepresent where a receipt was applied.
   */
  async fetchAllPaymentAllocationsIfTruncated(paymentId: string, currentAllocations: any[]): Promise<any[]> {
    return this.fetchAllNestedRowsIfTruncated(
      'payment_allocations',
      'payment_id',
      paymentId,
      currentAllocations,
      mapDbPaymentAllocation
    );
  },

  /**
   * Fail-closed and deterministic nested-record pagination. The count check is
   * mandatory: a network or authorization failure must never produce a partial
   * financial export presented as complete.
   */
  async fetchAllNestedRowsIfTruncated(
    table: 'invoice_items' | 'payment_allocations',
    parentColumn: 'invoice_id' | 'payment_id',
    parentId: string,
    embeddedRows: Array<{ id: string }>,
    mapRow: (row: any) => any
  ): Promise<any[]> {
    if (!supabase) {
      throw new ExportIntegrityError('Cloud backend is not configured for nested export verification.', 'NESTED_COUNT_UNVERIFIED');
    }

    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(parentColumn, parentId);

    if (error || count === null) {
      throw new ExportIntegrityError(
        `Could not verify complete ${table} for ${parentId}: ${error?.message || 'No count returned'}.`,
        'NESTED_COUNT_UNVERIFIED'
      );
    }

    // A count decrease during export is also a concurrency/integrity fault.
    if (count < embeddedRows.length) {
      throw new ExportIntegrityError(
        `Inconsistent ${table} count for ${parentId}: embedded ${embeddedRows.length}, database ${count}.`,
        'NESTED_SNAPSHOT_DRIFT'
      );
    }

    const seenEmbeddedIds = new Set(embeddedRows.map((row) => row.id));
    if (seenEmbeddedIds.size !== embeddedRows.length || embeddedRows.some((row) => !row.id)) {
      throw new ExportIntegrityError(`Duplicate or missing ${table} IDs for ${parentId}.`, 'NESTED_DUPLICATE_ROW');
    }

    // The embedded relation is complete when its verified count matches.
    if (count === embeddedRows.length) return embeddedRows;

    const rows: any[] = [];
    const seenIds = new Set<string>();
    const BATCH_SIZE = 250;

    while (rows.length < count) {
      const from = rows.length;
      const to = Math.min(from + BATCH_SIZE - 1, count - 1);
      const { data, error: pageError } = await supabase
        .from(table)
        .select('*')
        .eq(parentColumn, parentId)
        .order('id', { ascending: true })
        .range(from, to);

      if (pageError || !data?.length) {
        throw new ExportIntegrityError(
          `Could not fetch complete ${table} for ${parentId}: expected ${count}, retrieved ${rows.length}. ${pageError?.message || ''}`,
          'NESTED_INCOMPLETE_BATCH'
        );
      }

      for (const row of data) {
        if (!row.id || row[parentColumn] !== parentId || seenIds.has(row.id)) {
          throw new ExportIntegrityError(
            `Duplicate, missing, or incorrect ${table} record while exporting ${parentId}.`,
            'NESTED_DUPLICATE_ROW'
          );
        }
        seenIds.add(row.id);
        rows.push(mapRow(row));
      }
    }

    if (rows.length !== count) {
      throw new ExportIntegrityError(
        `Unexpected ${table} row count for ${parentId}: expected ${count}, got ${rows.length}.`,
        'NESTED_COUNT_MISMATCH'
      );
    }

    const { count: verifiedCount, error: verifyError } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(parentColumn, parentId);

    if (verifyError || verifiedCount === null) {
      throw new ExportIntegrityError(
        `Unable to recheck ${table} for ${parentId}: ${verifyError?.message || 'No count returned'}.`,
        'NESTED_COUNT_UNVERIFIED'
      );
    }
    if (verifiedCount !== count) {
      throw new ExportIntegrityError(
        `Inconsistent ${table} count for ${parentId}: changed from ${count} to ${verifiedCount} during export.`,
        'NESTED_SNAPSHOT_DRIFT'
      );
    }

    return rows;
  },

  /**
   * Generates a descriptive, standardized file name for the export.
   */
  generateFilename(criteria: ReportFilterParams): string {
    const cleanLabel = criteria.periodLabel
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');

    const prefix = 'AtlasOS_Sales_Receipts';
    const dateRangeStr = `${criteria.startDate}_to_${criteria.endDate}`;

    if (criteria.periodType === 'FY' || criteria.periodType === 'MONTH' || criteria.periodType === 'DAY') {
      return `${prefix}_${cleanLabel}.xlsx`;
    }

    return `${prefix}_Custom_${dateRangeStr}.xlsx`;
  },

  /**
   * Master Export Function
   * Coordinates fetching data, checking pre-export integrity, generating the workbook,
   * and returning the buffer and filename.
   */
  async exportReport(
    organization: Organization,
    params: ReportFilterParams,
    isMockAuth: boolean = false,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<{ buffer: ArrayBuffer; filename: string }> {
    const data = await this.fetchReportData(organization.id, params, isMockAuth, onProgress);

    onProgress?.({
      stage: 'building',
      current: 1,
      total: 1,
      message: 'Compiling sheets and formatting Excel workbook...',
    });

    const criteria: ReportCriteria = {
      ...params,
      isDemoMode: isMockAuth,
    };

    const buffer = await generateSalesReceiptsWorkbook({
      organization,
      criteria,
      invoices: data.invoices,
      payments: data.payments,
      referencedInvoices: data.referencedInvoices,
    });

    const filename = this.generateFilename(params);

    onProgress?.({
      stage: 'complete',
      current: 1,
      total: 1,
      message: 'Export complete.',
    });

    return { buffer, filename };
  },
};
