import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Invoice, InvoiceItem, InvoiceStatus, UOM, PaginationParams, PaginatedResult } from '@/types';
import { parseTaxRate, isExplicitTaxRate, calculateInvoiceBalance, calculateDocumentTotals } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';
import { mapDbCustomer } from './customers.service';
import { offlineQueue, isNetworkError } from '@/lib/offline-queue';

function buildOptimisticInvoice(
  orgId: string,
  input: CreateInvoiceInput,
  idempotencyKey: string | null
): Invoice {
  // A queued invoice is NOT an issued tax invoice. The server has not confirmed it.
  // Drafts may omit a tax classification; show a clearly provisional 0% estimate,
  // never silently invent a statutory 18% rate.
  const missingTax = input.items.some((it) => !isExplicitTaxRate(it.taxRate));
  const calculated = calculateDocumentTotals(input.items.map((it) => ({
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discountPercent: it.discountPercent ?? 0,
    taxRate: isExplicitTaxRate(it.taxRate) ? Number(it.taxRate) : 0,
  })));

  const items: InvoiceItem[] = input.items.map((it, idx) => {
    const line = calculated.items[idx];
    return {
      id: `item-offline-${idempotencyKey || Date.now()}-${idx}`,
      invoiceId: `inv-offline-${idempotencyKey || Date.now()}`,
      productId: it.productId,
      productName: it.productName,
      productSku: it.productSku,
      uom: it.uom,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent ?? 0,
      taxRate: line.taxRate,
      lineSubtotal: line.taxableAmount,
      lineTax: line.taxAmount,
      lineTotal: line.totalAmount,
      documentDiscountShare: 0,
    };
  });

  return {
    id: `inv-offline-${idempotencyKey || Date.now()}`,
    organizationId: orgId,
    invoiceNumber: `INV-OFFLINE-${Date.now().toString().slice(-4)}`,
    customerId: input.customerId,
    salesOrderId: input.salesOrderId,
    status: 'DRAFT', // Queued: not an issued or authorized invoice.
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate || input.invoiceDate,
    subtotal: calculated.grossSubtotal,
    discountAmount: calculated.discountTotal,
    taxAmount: calculated.taxAmount,
    totalAmount: calculated.totalAmount,
    totalPaid: 0,
    totalsVersion: 2,
    notes: `${input.notes ? input.notes + ' ' : ''}(Offline Pending Sync${missingTax ? '; GST estimate unverified' : ''})`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
  };
}

export function mapDbInvoiceItem(row: any): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    hsnCode: row.hsn_code || undefined,
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
    gstJurisdiction: row.gst_place_of_supply_code && row.gst_seller_state_code
      ? { placeOfSupplyCode: row.gst_place_of_supply_code, sellerStateCode: row.gst_seller_state_code }
      : undefined,
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
  async confirmGstJurisdiction(orgId: string, invoiceId: string, placeOfSupplyCode: string): Promise<NonNullable<Invoice['gstJurisdiction']>> {
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.rpc('confirm_invoice_gst_jurisdiction', {
      p_org_id: orgId,
      p_invoice_id: invoiceId,
      p_place_of_supply_code: placeOfSupplyCode,
    });
    if (error || !data?.place_of_supply_code || !data?.seller_state_code) {
      throw new Error(error?.message ?? 'No GST jurisdiction confirmation returned.');
    }
    return { placeOfSupplyCode: data.place_of_supply_code, sellerStateCode: data.seller_state_code };
  },

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
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s) {
        // Query matching customer IDs in tenant organization for cross-table search parity
        const { data: matchedCustomers } = await supabase
          .from('customers')
          .select('id')
          .eq('organization_id', orgId)
          .or(`name.ilike.%${s}%,company_name.ilike.%${s}%`);

        const matchingCustomerIds = (matchedCustomers || [])
          .map((c: any) => c.id)
          .filter(Boolean);

        if (matchingCustomerIds.length > 0) {
          query = query.or(`invoice_number.ilike.%${s}%,customer_id.in.(${matchingCustomerIds.join(',')})`);
        } else {
          query = query.or(`invoice_number.ilike.%${s}%`);
        }
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

    const invoices: Invoice[] = [];
    const seen = new Set<string>();
    let page = 1;
    let expectedTotal: number;
    do {
      const result = await invoicesService.getInvoicesPaginated(orgId, { page, pageSize: 100 });
      expectedTotal = result.total;
      for (const invoice of result.data) {
        if (seen.has(invoice.id)) throw new Error('Invoices changed while loading. Please try again.');
        seen.add(invoice.id);
        invoices.push(invoice);
      }
      if (!result.hasNextPage) break;
      if (result.data.length === 0) throw new Error('Could not load every invoice.');
      page += 1;
    } while (true);
    if (invoices.length !== expectedTotal) throw new Error('Could not load every invoice. Please try again.');
    return invoices;
  },

  async getInvoiceById(orgId: string, invoiceId: string, isMockAuth: boolean = false): Promise<Invoice | null> {
    if (isMockAuth) {
      const inv = storage.getInvoices(orgId).find((i) => i.id === invoiceId);
      return inv || null;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*), customer:customers!fk_invoices_customer_org(*)')
      .eq('organization_id', orgId)
      .eq('id', invoiceId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch invoice: ${error.message}`);
    }

    if (!data) return null;
    const items = (data.items || []).map(mapDbInvoiceItem);
    return mapDbInvoice(data, items);
  },

  /**
   * Bounded, server-side lookup of eligible ISSUED and PARTIALLY_PAID invoices
   * with positive balance for a specific customer.
   */
  async getEligiblePaymentInvoices(
    orgId: string,
    customerId: string,
    params: {
      search?: string;
      page?: number;
      pageSize?: number;
      exactInvoiceId?: string;
    } = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<Invoice>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const all = storage.getInvoices(orgId);
      const eligible = all.filter((inv: any) => {
        if (inv.customerId !== customerId) return false;
        if (inv.id === params.exactInvoiceId) return true;
        const isEligibleStatus = inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID';
        const hasBalance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid) > 0;
        return isEligibleStatus && hasBalance;
      });
      return paginateArray(
        eligible,
        { page, pageSize, search: params.search },
        (inv, s) => inv.invoiceNumber.toLowerCase().includes(s),
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('invoices')
      .select('*, items:invoice_items(*), customer:customers!fk_invoices_customer_org(*)', { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('customer_id', customerId)
      .in('status', ['ISSUED', 'PARTIALLY_PAID']);

    if (params.search && params.search.trim()) {
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').trim();
      if (s) {
        query = query.ilike('invoice_number', `%${s}%`);
      }
    }

    query = query
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    const { data: dbInvoices, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch eligible invoices: ${error.message}`);
    }

    const totalCount = count || 0;
    let mapped = (dbInvoices || [])
      .map((row) => {
        const items = (row.items || []).map(mapDbInvoiceItem);
        return mapDbInvoice(row, items);
      })
      .filter((inv) => calculateInvoiceBalance(inv.totalAmount, inv.totalPaid) > 0 || inv.id === params.exactInvoiceId);

    if (params.exactInvoiceId && !mapped.some((i) => i.id === params.exactInvoiceId)) {
      const exact = await this.getInvoiceById(orgId, params.exactInvoiceId, isMockAuth);
      if (exact && exact.customerId === customerId) {
        mapped = [exact, ...mapped];
      }
    }

    return buildPaginatedResult(mapped, totalCount, page, pageSize);
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
    // When issuing an invoice (effective finalStatus = 'ISSUED'), every line item must contain an explicit, verified tax rate.
    // Both explicit and implicit/defaulted ISSUED invoices enforce required tax rates.
    // Unverified or missing tax rates cannot be silently zero-rated or fabricated.
    // Draft invoices (status = 'DRAFT') do not enforce tax rates prematurely.
    if (finalStatus === 'ISSUED') {
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

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      offlineQueue.enqueue(
        orgId,
        'CREATE_INVOICE',
        input,
        {
          idempotencyKey: idempotencyKey || undefined,
          description: `Invoice for customer ${input.customerId} (${input.invoiceDate})`,
        }
      );
      return buildOptimisticInvoice(orgId, input, idempotencyKey);
    }

    try {
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
        if (isNetworkError(rpcErr)) {
          offlineQueue.enqueue(
            orgId,
            'CREATE_INVOICE',
            input,
            {
              idempotencyKey: idempotencyKey || undefined,
              description: `Invoice for customer ${input.customerId} (${input.invoiceDate})`,
            }
          );
          return buildOptimisticInvoice(orgId, input, idempotencyKey);
        }
        throw new Error(`Failed to create invoice: ${rpcErr.message}`);
      }

      if (!rpcRes) {
        throw new Error('Invoice creation succeeded but no invoice payload was returned from server.');
      }

      const items = (rpcRes.items || []).map(mapDbInvoiceItem);
      return mapDbInvoice(rpcRes, items);
    } catch (err: any) {
      if (isNetworkError(err)) {
        offlineQueue.enqueue(
          orgId,
          'CREATE_INVOICE',
          input,
          {
            idempotencyKey: idempotencyKey || undefined,
            description: `Invoice for customer ${input.customerId} (${input.invoiceDate})`,
          }
        );
        return buildOptimisticInvoice(orgId, input, idempotencyKey);
      }
      throw err;
    }
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
