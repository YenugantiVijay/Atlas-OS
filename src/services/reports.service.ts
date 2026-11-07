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

    await assertCloudFinancialReportAccess(orgId);

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
   * FIN-01: The XLSX cloud export must use ONE server-side MVCC snapshot.
   * Each separate PostgREST query sees its own snapshot, even if counts match.
   * This RPC returns all bounded parent/child rows and cross-period references
   * under a single PostgreSQL statement snapshot. Never silently fall back
   * to the legacy multi-request loader if this RPC is missing or rejected.
   */
  async fetchSnapshotReportData(
    orgId: string,
    params: ReportFilterParams,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<ReportDataResult> {
    if (params.userRole && !hasPermission(params.userRole, 'reports:financial')) {
      throw new Error('Unauthorized: User role does not have permission to export financial reports.');
    }
    if (!supabase) {
      throw new ExportIntegrityError('Cloud backend is unavailable for financial snapshot export.', 'SNAPSHOT_UNAVAILABLE');
    }

    await assertCloudFinancialReportAccess(orgId);
    onProgress?.({
      stage: 'invoices',
      current: 0,
      total: 1,
      message: 'Retrieving one consistent financial snapshot...',
    });

    const { data, error } = await supabase.rpc('get_financial_export_snapshot', {
      p_org_id: orgId,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_document_type: params.documentType,
      p_customer_id: params.customerId || null,
      p_invoice_status: params.invoiceStatus && params.invoiceStatus !== 'ALL'
        ? params.invoiceStatus : null,
    });

    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ExportIntegrityError(
        `Financial snapshot could not be verified: ${error?.message || 'Invalid server response'}. Export stopped.`,
        'SNAPSHOT_UNAVAILABLE'
      );
    }

    const payload = data as Record<string, unknown>;
    if (!Array.isArray(payload.invoices) ||
        !Array.isArray(payload.payments) ||
        !Array.isArray(payload.referenced_invoices) ||
        typeof payload.snapshot_at !== 'string') {
      throw new ExportIntegrityError('Financial snapshot has an incomplete response structure.', 'SNAPSHOT_INVALID');
    }

    const validCount = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (![payload.invoice_count, payload.payment_count,
          payload.invoice_item_count, payload.payment_allocation_count].every(validCount)) {
      throw new ExportIntegrityError('Financial snapshot counts are missing or invalid.', 'SNAPSHOT_INVALID');
    }
    if (payload.invoices.length !== payload.invoice_count ||
        payload.payments.length !== payload.payment_count ||
        payload.invoice_count > MAX_SAFE_EXPORT_INVOICES ||
        payload.payment_count > 10000 ||
        payload.invoice_item_count + payload.payment_allocation_count > 100000) {
      throw new ExportIntegrityError('Financial snapshot count or safe size mismatch.', 'SNAPSHOT_COUNT_MISMATCH');
    }

    const seenInvoices = new Set<string>();
    const seenPayments = new Set<string>();
    let invoiceItemCount = 0;
    let paymentAllocationCount = 0;

    const invoices = payload.invoices.map((value: unknown) => {
      const row = value as Record<string, any>;
      if (!row || typeof row !== 'object' || !row.id ||
          row.organization_id !== orgId || seenInvoices.has(row.id) ||
          !Array.isArray(row.items) || !row.customer ||
          row.customer.id !== row.customer_id) {
        throw new ExportIntegrityError('Invalid, duplicate, or cross-tenant invoice in snapshot.', 'SNAPSHOT_INVALID');
      }
      seenInvoices.add(row.id);
      const itemIds = new Set<string>();
      const items = row.items.map((item: any) => {
        if (!item || !item.id || item.invoice_id !== row.id || itemIds.has(item.id)) {
          throw new ExportIntegrityError('Invalid or duplicate invoice item in snapshot.', 'SNAPSHOT_INVALID');
        }
        itemIds.add(item.id);
        invoiceItemCount++;
        return mapDbInvoiceItem(item);
      });
      if (Number(row.subtotal) > 0 && items.length === 0) {
        throw new ExportIntegrityError('Invoice snapshot is missing line items.', 'SNAPSHOT_INVALID');
      }
      return mapDbInvoice(row, items);
    });

    const payments = payload.payments.map((value: unknown) => {
      const row = value as Record<string, any>;
      if (!row || typeof row !== 'object' || !row.id ||
          row.organization_id !== orgId || seenPayments.has(row.id) ||
          !Array.isArray(row.allocations) || !row.customer ||
          row.customer.id !== row.customer_id) {
        throw new ExportIntegrityError('Invalid, duplicate, or cross-tenant payment in snapshot.', 'SNAPSHOT_INVALID');
      }
      seenPayments.add(row.id);
      const allocationIds = new Set<string>();
      const allocations = row.allocations.map((alloc: any) => {
        if (!alloc || !alloc.id || alloc.payment_id !== row.id ||
            !alloc.invoice_id || allocationIds.has(alloc.id)) {
          throw new ExportIntegrityError('Invalid or duplicate payment allocation in snapshot.', 'SNAPSHOT_INVALID');
        }
        allocationIds.add(alloc.id);
        paymentAllocationCount++;
        return mapDbPaymentAllocation(alloc);
      });
      return mapDbPayment(row, allocations);
    });

    if (invoiceItemCount !== payload.invoice_item_count ||
        paymentAllocationCount !== payload.payment_allocation_count) {
      throw new ExportIntegrityError(
        'Financial snapshot is missing invoice line items or payment allocations.',
        'SNAPSHOT_COUNT_MISMATCH'
      );
    }

    const referencedInvoices = new Map<string, ReferencedInvoiceMeta>();
    for (const invoice of invoices) {
      referencedInvoices.set(invoice.id, {
        id: invoice.id, invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate, status: invoice.status,
      });
    }

    for (const value of payload.referenced_invoices) {
      const row = value as Record<string, any>;
      if (!row || !row.id || row.organization_id !== orgId || !row.invoice_number ||
          !row.invoice_date || !row.status) {
        throw new ExportIntegrityError('Invalid referenced invoice in snapshot.', 'SNAPSHOT_INVALID');
      }
      referencedInvoices.set(row.id, {
        id: row.id, invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date, status: row.status,
      });
    }

    for (const payment of payments) {
      for (const allocation of payment.allocations || []) {
        if (!referencedInvoices.has(allocation.invoiceId)) {
          throw new ExportIntegrityError(
            'Snapshot is missing the invoice referenced by a payment allocation.',
            'SNAPSHOT_REFERENCE_MISSING'
          );
        }
      }
    }

    onProgress?.({
      stage: 'complete', current: invoices.length + payments.length,
      total: invoices.length + payments.length,
      message: 'Consistent financial snapshot verified.',
    });
    return { invoices, payments, referencedInvoices };
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
    // FIN-01: The downloaded cloud workbook must never use the multi-query
    // pagination path because independent requests cannot share one MVCC view.
    const data = isMockAuth
      ? await this.fetchReportData(organization.id, params, true, onProgress)
      : await this.fetchSnapshotReportData(organization.id, params, onProgress);

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
