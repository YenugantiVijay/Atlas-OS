/**
 * Atlas OS — Financial Reporting & Bounded Excel Data Service
 *
 * Implements bounded pagination, stream chunking, and tenant-isolated data retrieval
 * for complete historical invoice and payment receipt reporting.
 */

import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Invoice, Payment, Organization } from '@/types';
import { ReportCriteria, generateSalesReceiptsWorkbook } from '@/lib/excel';
import { mapDbInvoice, mapDbInvoiceItem } from './invoices.service';
import { mapDbPayment, mapDbPaymentAllocation } from './payments.service';

export interface ReportFilterParams {
  periodType: 'FY' | 'MONTH' | 'DAY' | 'CUSTOM';
  periodLabel: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  customerId?: string;
  customerName?: string;
  documentType: 'ALL' | 'INVOICES' | 'PAYMENTS';
  invoiceStatus?: string; // 'ALL' or specific status
}

export interface ReportCounts {
  invoiceCount: number;
  paymentCount: number;
}

export interface ReportProgress {
  stage: 'counting' | 'invoices' | 'payments' | 'building' | 'complete';
  current: number;
  total: number;
  message: string;
}

export const reportsService = {
  /**
   * Authoritatively retrieves exact record counts matching current criteria
   * without downloading any record payloads.
   */
  async getMatchingCounts(
    orgId: string,
    params: ReportFilterParams,
    isMockAuth: boolean = false
  ): Promise<ReportCounts> {
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
   * Fetches full historical data using bounded batch pagination
   * to strictly prevent memory bloat and PostgREST payload truncations.
   */
  async fetchReportData(
    orgId: string,
    params: ReportFilterParams,
    isMockAuth: boolean = false,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<{ invoices: Invoice[]; payments: Payment[] }> {
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

      onProgress?.({
        stage: 'complete',
        current: invoices.length + payments.length,
        total: invoices.length + payments.length,
        message: 'Demo records loaded.',
      });

      return { invoices, payments };
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const BATCH_SIZE = 250;
    const allInvoices: Invoice[] = [];
    const allPayments: Payment[] = [];

    // --- 1. Fetch Invoices in bounded batches ---
    if (params.documentType !== 'PAYMENTS') {
      // First count exact records
      let countQuery = supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('invoice_date', params.startDate)
        .lte('invoice_date', params.endDate);

      if (params.customerId) {
        countQuery = countQuery.eq('customer_id', params.customerId);
      }
      if (params.invoiceStatus && params.invoiceStatus !== 'ALL') {
        countQuery = countQuery.eq('status', params.invoiceStatus);
      }

      const { count: totalInvoices, error: countErr } = await countQuery;
      if (countErr) {
        throw new Error(`Failed to count invoices: ${countErr.message}`);
      }

      const total = totalInvoices || 0;
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

        dataQuery = dataQuery
          .order('invoice_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);

        const { data: rows, error } = await dataQuery;
        if (error) {
          throw new Error(`Failed to fetch invoice batch [${from}..${to}]: ${error.message}`);
        }

        if (!rows || rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const items = (row.items || []).map(mapDbInvoiceItem);
          allInvoices.push(mapDbInvoice(row, items));
        }

        fetched += rows.length;
      }
    }

    // --- 2. Fetch Payments in bounded batches ---
    if (params.documentType !== 'INVOICES') {
      let countQuery = supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('payment_date', params.startDate)
        .lte('payment_date', params.endDate);

      if (params.customerId) {
        countQuery = countQuery.eq('customer_id', params.customerId);
      }

      const { count: totalPayments, error: countErr } = await countQuery;
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

        dataQuery = dataQuery
          .order('payment_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);

        const { data: rows, error } = await dataQuery;
        if (error) {
          throw new Error(`Failed to fetch payment batch [${from}..${to}]: ${error.message}`);
        }

        if (!rows || rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const allocations = (row.allocations || []).map(mapDbPaymentAllocation);
          allPayments.push(mapDbPayment(row, allocations));
        }

        fetched += rows.length;
      }
    }

    return { invoices: allInvoices, payments: allPayments };
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
   * Coordinates fetching data, generating the workbook, and returning the buffer and filename.
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
