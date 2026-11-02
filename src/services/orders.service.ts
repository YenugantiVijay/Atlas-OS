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
} from '@/types';
import { parseTaxRate } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
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
    taxRate: parseTaxRate(row.tax_rate, 18),
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
    taxRate: parseTaxRate(row.tax_rate, 18),
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

export const ordersService = {
  // --------------------------------------------------------------------------
  // SALES ORDERS
  // --------------------------------------------------------------------------
  async getSalesOrders(orgId: string, isMockAuth: boolean = false): Promise<SalesOrder[]> {
    if (isMockAuth) {
      return storage.getSalesOrders(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data: dbOrders, error: ordersErr } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*), customer:customers!fk_sales_orders_customer_org(*)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (ordersErr) {
      throw new Error(`Failed to fetch sales orders: ${ordersErr.message}`);
    }

    return (dbOrders || []).map((row) => {
      const items = (row.items || []).map(mapDbSalesOrderItem);
      return mapDbSalesOrder(row, items);
    });
  },

  async createSalesOrder(
    orgId: string,
    input: {
      customerId: string;
      quotationId?: string;
      orderDate: string;
      notes?: string;
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
    const idempotencyKey = crypto.randomUUID();
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_sales_order_atomic', {
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
      p_quotation_id: input.quotationId || null,
      p_idempotency_key: idempotencyKey,
    });

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
  async getQuotations(orgId: string, isMockAuth: boolean = false): Promise<Quotation[]> {
    if (isMockAuth) {
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
  },

  async createQuotation(
    orgId: string,
    input: {
      customerId: string;
      validUntil: string;
      notes?: string;
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

    const idempotencyKey = crypto.randomUUID();
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
    isMockAuth: boolean = false
  ): Promise<SalesOrder> {
    if (isMockAuth) {
      return storage.convertQuotationToOrder(orgId, quotationId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const idempotencyKey = crypto.randomUUID();
    const { data: rpcData, error: rpcErr } = await supabase.rpc('convert_quotation_atomic', {
      p_org_id: orgId,
      p_quotation_id: quotationId,
      p_idempotency_key: idempotencyKey,
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
