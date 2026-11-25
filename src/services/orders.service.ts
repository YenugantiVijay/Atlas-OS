import { validateOnlineReference, type OnlineOrderReference, type OrderDispatch } from '@/lib/online-orders';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import {
  SalesOrder,
  SalesOrderItem,
  Quotation,
  QuotationItem,
  OrderStatus,
  QuotationStatus,
  UOM,
  PaginationParams,
  PaginatedResult,
} from '@/types';
import { parseTaxRate } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';
import { mapDbCustomer } from './customers.service';

export function mapDbSalesOrderItem(row: any): SalesOrderItem {
  return {
    id: row.id,
    salesOrderId: row.sales_order_id,
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

export function mapDbSalesOrder(row: any, items: SalesOrderItem[] = []): SalesOrder {
  return {
    id: row.id,
    organizationId: row.organization_id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    customer: row.customer ? mapDbCustomer(row.customer) : undefined,
    quotationId: row.quotation_id || undefined,
    status: row.status as OrderStatus,
    orderDate: row.order_date,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    totalsVersion: row.totals_version ? Number(row.totals_version) : 1,
    notes: row.notes || undefined,
    ...(row.online_channel && row.online_reference && {
      onlineOrder: { channel: row.online_channel, reference: row.online_reference },
    }),
    ...(row.dispatch_carrier && row.dispatch_tracking && row.dispatched_at && {
      dispatch: { carrier: row.dispatch_carrier, tracking: row.dispatch_tracking, recordedAt: row.dispatched_at },
    }),
    createdBy: row.created_by || undefined,
    confirmedAt: row.confirmed_at || undefined,
    confirmedBy: row.confirmed_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

export function mapDbQuotationItem(row: any): QuotationItem {
  return {
    id: row.id,
    quotationId: row.quotation_id,
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

export function mapDbQuotation(row: any, items: QuotationItem[] = []): Quotation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    customer: row.customer ? mapDbCustomer(row.customer) : undefined,
    status: row.status as QuotationStatus,
    validUntil: row.valid_until,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    totalsVersion: row.totals_version ? Number(row.totals_version) : 1,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    items,
  };
}

async function getQuotationsPaginatedImpl(
  orgId: string,
  params: PaginationParams = {},
  isMockAuth: boolean = false
): Promise<PaginatedResult<Quotation>> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (isMockAuth) {
    const allQuotes = await storage.getQuotations(orgId);
    return paginateArray(
      allQuotes,
      params,
      (q, s) =>
        q.quotationNumber.toLowerCase().includes(s) ||
        Boolean(q.customer?.name && q.customer.name.toLowerCase().includes(s)) ||
        Boolean(q.customer?.companyName && q.customer.companyName.toLowerCase().includes(s)) ||
        q.status.toLowerCase().includes(s),
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  if (!supabase) {
    throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
  }

  let query = supabase
    .from('quotations')
    .select('*, items:quotation_items(*), customer:customers!fk_quotations_customer_org(*)', { count: 'exact' })
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
        query = query.or(`quotation_number.ilike.%${s}%,customer_id.in.(${matchingCustomerIds.join(',')})`);
      } else {
        query = query.or(`quotation_number.ilike.%${s}%`);
      }
    }
  }

  if (params.status && params.status !== 'ALL') {
    query = query.eq('status', params.status);
  }

  const ALLOWED_QUOT_SORT_FIELDS: Record<string, string> = {
    quotationNumber: 'quotation_number',
    validUntil: 'valid_until',
    totalAmount: 'total_amount',
    status: 'status',
    createdAt: 'created_at',
  };
  const sortBy = ALLOWED_QUOT_SORT_FIELDS[params.sortBy || 'createdAt'] || 'created_at';
  const ascending = params.sortOrder === 'asc' ? true : false;
  query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

  const { data: dbQuotations, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch quotations: ${error.message}`);
  }

  const totalCount = count || 0;
  const mapped = (dbQuotations || []).map((row) => {
    const items = (row.items || []).map(mapDbQuotationItem);
    return mapDbQuotation(row, items);
  });

  return buildPaginatedResult(mapped, totalCount, page, pageSize);
}

function getQuotationsImpl(
  orgId: string,
  params: PaginationParams,
  isMockAuth?: boolean
): Promise<PaginatedResult<Quotation>>;
function getQuotationsImpl(
  orgId: string,
  isMockAuth?: boolean
): Promise<Quotation[]>;
async function getQuotationsImpl(
  orgId: string,
  paramsOrMock: PaginationParams | boolean = false,
  isMockAuth: boolean = false
): Promise<Quotation[] | PaginatedResult<Quotation>> {
  if (typeof paramsOrMock === 'object' && paramsOrMock !== null) {
    return getQuotationsPaginatedImpl(orgId, paramsOrMock, isMockAuth);
  }
  const mock = typeof paramsOrMock === 'boolean' ? paramsOrMock : isMockAuth;
  if (mock) {
    return storage.getQuotations(orgId);
  }

  if (!supabase) {
    throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
  }

  const { data: dbQuotations, error } = await supabase
    .from('quotations')
    .select('*, items:quotation_items(*), customer:customers!fk_quotations_customer_org(*)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch quotations: ${error.message}`);
  }

  return (dbQuotations || []).map((row) => {
    const items = (row.items || []).map(mapDbQuotationItem);
    return mapDbQuotation(row, items);
  });
}

export const ordersService = {
  // --------------------------------------------------------------------------
  // SALES ORDERS
  // --------------------------------------------------------------------------
  async getSalesOrdersPaginated(
    orgId: string,
    params: PaginationParams & { onlineOnly?: boolean } = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<SalesOrder>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const allOrders = await storage.getSalesOrders(orgId);
      return paginateArray(
        params.onlineOnly ? allOrders.filter(order => order.onlineOrder) : allOrders,
        params,
        (o, s) =>
          o.orderNumber.toLowerCase().includes(s) ||
          Boolean(o.onlineOrder?.reference.toLowerCase().includes(s)) ||
          Boolean(o.customer?.name && o.customer.name.toLowerCase().includes(s)) ||
          Boolean(o.customer?.companyName && o.customer.companyName.toLowerCase().includes(s)) ||
          o.status.toLowerCase().includes(s),
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)', { count: 'exact' })
      .eq('organization_id', orgId);

    if (params.onlineOnly) query = query.not('online_channel', 'is', null);

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

        const customerFilter =
          matchingCustomerIds.length > 0 ? `,customer_id.in.(${matchingCustomerIds.join(',')})` : '';

        query = params.onlineOnly
          ? query.or(`order_number.ilike.%${s}%,online_reference.ilike.%${s}%${customerFilter}`)
          : query.or(`order_number.ilike.%${s}%${customerFilter}`);
      }
    }

    if (params.status && params.status !== 'ALL') {
      query = query.eq('status', params.status);
    }

    const ALLOWED_ORDER_SORT_FIELDS: Record<string, string> = {
      orderNumber: 'order_number',
      orderDate: 'order_date',
      totalAmount: 'total_amount',
      status: 'status',
      createdAt: 'created_at',
    };
    const sortBy = ALLOWED_ORDER_SORT_FIELDS[params.sortBy || 'createdAt'] || 'created_at';
    const ascending = params.sortOrder === 'asc' ? true : false;
    query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

    const { data: dbOrders, error: ordersErr, count } = await query;

    if (ordersErr) {
      throw new Error(`Failed to fetch sales orders: ${ordersErr.message}`);
    }

    const totalCount = count || 0;
    const mapped = (dbOrders || []).map((row) => {
      const items = (row.items || []).map(mapDbSalesOrderItem);
      return mapDbSalesOrder(row, items);
    });

    return buildPaginatedResult(mapped, totalCount, page, pageSize);
  },

  async getSalesOrders(orgId: string, isMockAuth: boolean = false): Promise<SalesOrder[]> {
    if (isMockAuth) {
      return storage.getSalesOrders(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const allOrders: SalesOrder[] = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const query = supabase
        .from('sales_orders')
        .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      // The real Supabase builder always exposes range(); retaining the
      // fallback keeps lightweight test doubles and older adapters usable.
      const pageQuery = typeof (query as { range?: unknown }).range === 'function'
        ? (query as typeof query & { range: (from: number, to: number) => typeof query }).range(offset, offset + pageSize - 1)
        : query;
      const { data: dbOrders, error: ordersErr } = await pageQuery;

      if (ordersErr) {
        throw new Error(`Failed to fetch sales orders: ${ordersErr.message}`);
      }
      if (!Array.isArray(dbOrders)) throw new Error('Failed to fetch sales orders: invalid response.');
      allOrders.push(...dbOrders.map((row) => {
        const items = (row.items || []).map(mapDbSalesOrderItem);
        return mapDbSalesOrder(row, items);
      }));
      if (dbOrders.length < pageSize) break;
    }
    return allOrders;
  },

  async createSalesOrder(
    orgId: string,
    input: {
      customerId: string;
      quotationId?: string;
      orderDate: string;
      notes?: string;
      onlineOrder?: OnlineOrderReference;
      idempotencyKey?: string;
      items: Array<{
        productId: string;
        productName: string;
        productSku: string;
        uom: UOM;
        quantity: number;
        unitPrice: number;
        discountPercent: number;
        taxRate: number;
      }>;
    },
    isMockAuth: boolean = false
  ): Promise<SalesOrder> {
    if (isMockAuth) {
      return storage.createSalesOrder(orgId, input);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // Input validation prior to database submission
    if (!input.items || input.items.length === 0) {
      throw new Error('Sales order must contain at least one line item');
    }

    for (const item of input.items) {
      if (item.quantity <= 0) {
        throw new Error('Quantity cannot be negative or invalid');
      }
      if (item.unitPrice < 0) {
        throw new Error('Unit price cannot be negative or invalid');
      }
      if (item.discountPercent < 0 || item.discountPercent > 100) {
        throw new Error('Discount percentage must be between 0 and 100');
      }
    }

    // Authoritative atomic RPC execution with request idempotency
    const idempotencyKey =
      input.idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    const online = input.onlineOrder && validateOnlineReference(input.onlineOrder);
    const common = {
      p_org_id: orgId,
      p_customer_id: input.customerId,
      p_order_date: input.orderDate || getBusinessDate(),
      p_items: input.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      })),
      p_notes: input.notes?.trim() || null,
      p_idempotency_key: idempotencyKey,
    };
    if (online && input.quotationId) throw new Error('Create online orders directly from the e-commerce workspace.');
    const { data: rpcData, error: rpcErr } = online
      ? await supabase.rpc('create_online_sales_order', { ...common, p_channel: online.channel, p_reference: online.reference })
      : await supabase.rpc('create_sales_order_atomic', { ...common, p_quotation_id: input.quotationId || null });

    if (rpcErr) {
      throw new Error(`Failed to create sales order: ${rpcErr.message}`);
    }

    // Attempt to load customer relation for UI presentation
    const { data: createdOrder } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)')
      .eq('id', rpcData.id)
      .single();

    if (createdOrder) {
      const items = (createdOrder.items || []).map(mapDbSalesOrderItem);
      return mapDbSalesOrder(createdOrder, items);
    }

    const items = (rpcData.items || []).map(mapDbSalesOrderItem);
    return mapDbSalesOrder(rpcData, items);
  },

  async recordOnlineDispatch(orgId: string, order: SalesOrder, carrierInput: string, trackingInput: string, isMockAuth: boolean): Promise<OrderDispatch> {
    const carrier = carrierInput.trim();
    const tracking = trackingInput.trim();
    if (!carrier || carrier.length > 80 || !tracking || tracking.length > 100) {
      throw new Error('Enter a carrier and tracking reference.');
    }
    const expected = order.dispatch?.recordedAt ?? null;
    if (isMockAuth) return storage.recordOnlineDispatch(orgId, order.id, carrier, tracking, expected);
    if (!supabase) throw new Error('Connect Atlas OS to save dispatch details.');
    const { data, error } = await supabase.rpc('record_online_dispatch', {
      p_org_id: orgId, p_order_id: order.id, p_carrier: carrier, p_tracking: tracking,
      p_expected_dispatch: expected,
    });
    if (error) throw new Error(error.message);
    return data as OrderDispatch;
  },

  /**
   * ATOMIC ORDER CONFIRMATION
   * Executes remote SECURITY DEFINER function confirm_sales_order(p_order_id, p_org_id)
   * Server validates inventory, performs atomic deductions, updates status, and logs audit event.
   */
  async confirmSalesOrder(
    orgId: string,
    orderId: string,
    userRole: string | null = null,
    isMockAuth: boolean = false
  ): Promise<{ success: boolean; status: string }> {
    if (isMockAuth) {
      storage.confirmSalesOrder(orgId, orderId, userRole as any);
      return { success: true, status: 'CONFIRMED' };
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('confirm_sales_order', {
      p_order_id: orderId,
      p_org_id: orgId,
    });

    if (error) {
      throw new Error(`Confirmation rejected: ${error.message}`);
    }

    return {
      success: data?.success ?? true,
      status: data?.status || 'CONFIRMED',
    };
  },

  // --------------------------------------------------------------------------
  // QUOTATIONS
  // --------------------------------------------------------------------------
  getQuotationsPaginated: getQuotationsPaginatedImpl,
  getQuotations: getQuotationsImpl,

  async getQuotationById(orgId: string, quotationId: string): Promise<Quotation | null> {
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*), customer:customers!fk_quotations_customer_org(*)')
      .eq('organization_id', orgId)
      .eq('id', quotationId)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch quotation: ${error.message}`);
    return data ? mapDbQuotation(data, (data.items || []).map(mapDbQuotationItem)) : null;
  },

  async createQuotation(
    orgId: string,
    input: {
      customerId: string;
      validUntil: string;
      notes?: string;
      idempotencyKey?: string;
      items: Array<{
        productId: string;
        productName: string;
        productSku: string;
        uom: UOM;
        quantity: number;
        unitPrice: number;
        discountPercent: number;
        taxRate: number;
      }>;
    },
    isMockAuth: boolean = false
  ): Promise<Quotation> {
    if (isMockAuth) {
      return storage.createQuotation(orgId, input);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    if (!input.items || input.items.length === 0) {
      throw new Error('Quotation must contain at least one line item');
    }

    for (const item of input.items) {
      if (item.quantity <= 0) {
        throw new Error('Quantity cannot be negative or invalid');
      }
      if (item.unitPrice < 0) {
        throw new Error('Unit price cannot be negative or invalid');
      }
      if (item.discountPercent < 0 || item.discountPercent > 100) {
        throw new Error('Discount percentage must be between 0 and 100');
      }
    }

    const idempotencyKey =
      input.idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_quotation_atomic', {
      p_org_id: orgId,
      p_customer_id: input.customerId,
      p_valid_until: input.validUntil,
      p_items: input.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      })),
      p_notes: input.notes?.trim() || null,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcErr) {
      throw new Error(`Failed to create quotation: ${rpcErr.message}`);
    }

    const { data: createdQuot } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*), customer:customers!fk_quotations_customer_org(*)')
      .eq('id', rpcData.id)
      .single();

    if (createdQuot) {
      const items = (createdQuot.items || []).map(mapDbQuotationItem);
      return mapDbQuotation(createdQuot, items);
    }

    const items = (rpcData.items || []).map(mapDbQuotationItem);
    return mapDbQuotation(rpcData, items);
  },

  async convertQuotationToOrder(
    orgId: string,
    quotationId: string,
    isMockAuth: boolean = false,
    idempotencyKey?: string
  ): Promise<SalesOrder> {
    if (isMockAuth) {
      return storage.convertQuotationToOrder(orgId, quotationId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const key =
      idempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
    const { data: rpcData, error: rpcErr } = await supabase.rpc('convert_quotation_atomic', {
      p_org_id: orgId,
      p_quotation_id: quotationId,
      p_idempotency_key: key,
    });

    if (rpcErr) {
      throw new Error(`Failed to convert quotation: ${rpcErr.message}`);
    }

    const { data: orderRow } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)')
      .eq('id', rpcData.id)
      .single();

    if (orderRow) {
      const items = (orderRow.items || []).map(mapDbSalesOrderItem);
      return mapDbSalesOrder(orderRow, items);
    }

    const items = (rpcData.items || []).map(mapDbSalesOrderItem);
    return mapDbSalesOrder(rpcData, items);
  },
};
