import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Invoice, InvoiceItem, InvoiceStatus, UOM, PaginationParams, PaginatedResult } from '@/types';
import { parseTaxRate, isExplicitTaxRate } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';
import { mapDbCustomer } from './customers.service';

export function mapDbInvoiceItem(row: any): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    uom: (row.uom as UOM) || 'Nos',
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    discountPercent: Number(row.discount_percent) || 0,
    taxRate: parseTaxRate(row.tax_rate),
    lineSubtotal: Number(row.line_subtotal),
    lineTax: Number(row.line_tax),
    lineTotal: Number(row.line_total),
    documentDiscountShare: Number(row.document_discount_share) || 0,
  };
}

export function mapDbInvoice(row: any, items: InvoiceItem[] = []): Invoice {
  return {
    id: row.id,
    organizationId: row.organization_id,
    invoiceNumber: row.invoice_number,
    customerId: row.customer_id,
    customer: row.customer ? mapDbCustomer(row.customer) : undefined,
    salesOrderId: row.sales_order_id || undefined,
    status: row.status as InvoiceStatus,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    totalPaid: Number(row.total_paid) || 0,
    totalsVersion: row.totals_version ? Number(row.totals_version) : 1,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

export interface CreateInvoiceItemInput {
  productId: string;
  productName: string;
  productSku: string;
  uom: UOM;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  salesOrderId?: string;
  invoiceDate: string;
  dueDate: string;
  status?: InvoiceStatus;
  idempotencyKey?: string;
  notes?: string;
  items: CreateInvoiceItemInput[];
}

export const invoicesService = {
  async getInvoicesPaginated(
    orgId: string,
    params: PaginationParams = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<Invoice>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const allInvoices = await storage.getInvoices(orgId);
      return paginateArray(
        allInvoices,
        params,
        (inv, s) =>
          inv.invoiceNumber.toLowerCase().includes(s) ||
          Boolean(inv.customer?.name && inv.customer.name.toLowerCase().includes(s)) ||
          Boolean(inv.customer?.companyName && inv.customer.companyName.toLowerCase().includes(s)) ||
          inv.status.toLowerCase().includes(s),
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('invoices')
      .select('*, items:invoice_items(*), customer:customers!fk_invoices_customer_org(*)', { count: 'exact' })
      .eq('organization_id', orgId);

    if (params.search && params.search.trim()) {
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').trim();
      if (s) {
        query = query.or(`invoice_number.ilike.%${s}%`);
      }
    }

    if (params.status && params.status !== 'ALL') {
      query = query.eq('status', params.status);
    }

    const ALLOWED_INV_SORT_FIELDS: Record<string, string> = {
      invoiceNumber: 'invoice_number',
      invoiceDate: 'invoice_date',
      dueDate: 'due_date',
      totalAmount: 'total_amount',
      status: 'status',
      createdAt: 'created_at',
    };
    const sortBy = ALLOWED_INV_SORT_FIELDS[params.sortBy || 'createdAt'] || 'created_at';
    const ascending = params.sortOrder === 'asc' ? true : false;
    query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

    const { data: dbInvoices, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch invoices: ${error.message}`);
    }

    const totalCount = count || 0;
    const mapped = (dbInvoices || []).map((row) => {
      const items = (row.items || []).map(mapDbInvoiceItem);
      return mapDbInvoice(row, items);
    });

    return buildPaginatedResult(mapped, totalCount, page, pageSize);
  },

  async getInvoices(orgId: string, isMockAuth: boolean = false): Promise<Invoice[]> {
    if (isMockAuth) {
      return storage.getInvoices(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data: dbInvoices, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*), customer:customers!fk_invoices_customer_org(*)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch invoices: ${error.message}`);
    }

    return (dbInvoices || []).map((row) => {
      const items = (row.items || []).map(mapDbInvoiceItem);
      return mapDbInvoice(row, items);
    });
  },

  /**
   * ATOMIC INVOICE CREATION
   * Replaces non-atomic, 3-step PostgREST insertion with single ACID RPC:
   * `public.create_invoice_atomic(...)`.
   * Enforces server-side authentication, role authorization, tenant isolation,
   * deterministic product locking, sequence numbering, and idempotency in one transaction.
   */
  async createInvoice(
    orgId: string,
    input: CreateInvoiceInput,
    isMockAuth: boolean = false
  ): Promise<Invoice> {
    if (isMockAuth) {
      return storage.createInvoice(orgId, input as any);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const finalStatus = input.status || 'ISSUED';
    // Strict Tax Rate Verification on Final Issuance:
    // When issuing an invoice (status = 'ISSUED'), every line item must contain an explicit, verified tax rate.
    // Unverified or missing tax rates cannot be silently zero-rated or fabricated.
    // Draft invoices (status = 'DRAFT') do not enforce tax rates prematurely.
    if (input.status === 'ISSUED') {
      input.items.forEach((it, idx) => {
        if (!isExplicitTaxRate(it.taxRate)) {
          throw new Error(
            `Failed to create invoice: Item ${idx + 1} (${it.productName || it.productSku || 'unnamed'}) is missing an explicit tax rate. Issued invoices require an explicit, verified tax rate (0% for exempt supplies).`
          );
        }
      });
    }

    const idempotencyKey =
      input.idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);

    const { data: rpcRes, error: rpcErr } = await supabase.rpc(
      'create_invoice_atomic',
      {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_items: input.items.map((it) => ({
          product_id: it.productId,
          product_name: it.productName,
          product_sku: it.productSku,
          uom: it.uom,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          discount_percent: it.discountPercent ?? 0,
          tax_rate: isExplicitTaxRate(it.taxRate) ? Number(it.taxRate) : null,
        })),
        p_invoice_date: input.invoiceDate,
        p_due_date: input.dueDate || null,
        p_status: finalStatus,
        p_notes: input.notes?.trim() || null,
        p_sales_order_id: input.salesOrderId || null,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcErr) {
      throw new Error(`Failed to create invoice: ${rpcErr.message}`);
    }

    if (!rpcRes) {
      throw new Error('Invoice creation succeeded but no invoice payload was returned from server.');
    }

    const items = (rpcRes.items || []).map(mapDbInvoiceItem);
    return mapDbInvoice(rpcRes, items);
  },

  async createInvoiceFromOrder(
    orgId: string,
    orderId: string,
    isMockAuth: boolean = false,
    idempotencyKey?: string
  ): Promise<Invoice> {
    if (isMockAuth) {
      return storage.createInvoiceFromOrder(orgId, orderId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // 1. Fetch order details
    const { data: order, error: orderErr } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*)')
      .eq('id', orderId)
      .eq('organization_id', orgId)
      .single();

    if (orderErr || !order) {
      throw new Error(`Sales order not found: ${orderErr?.message || 'Invalid ID'}`);
    }

    // 2. Validate order status (defense-in-depth pre-check before calling RPC)
    if (order.status !== 'CONFIRMED') {
      throw new Error(
        `Cannot invoice sales order in status "${order.status}". Only CONFIRMED orders can be invoiced.`
      );
    }

    // 3. User-friendly pre-check for existing non-cancelled invoice (non-blocking)
    const { data: existingInvoices, error: invErr } = await supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('organization_id', orgId)
      .eq('sales_order_id', orderId)
      .neq('status', 'CANCELLED')
      .limit(1);

    if (!invErr && existingInvoices && existingInvoices.length > 0) {
      throw new Error(
        `Sales order ${order.order_number} has already been invoiced under invoice ${existingInvoices[0].invoice_number}.`
      );
    }

    if (invErr) {
      console.warn('Non-blocking existing invoice pre-check query failed:', invErr.message);
    }

    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const orderItems = (order.items || []).map((it: any) => ({
      productId: it.product_id,
      productName: it.product_name,
      productSku: it.product_sku,
      uom: it.uom,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      discountPercent: Number(it.discount_percent) || 0,
      taxRate: parseTaxRate(it.tax_rate ?? it.taxRate),
    }));

    return this.createInvoice(
      orgId,
      {
        customerId: order.customer_id,
        salesOrderId: order.id,
        invoiceDate: getBusinessDate(),
        dueDate,
        idempotencyKey,
        notes: `Generated from Sales Order ${order.order_number}`,
        items: orderItems,
      },
      false
    );
  },
};
