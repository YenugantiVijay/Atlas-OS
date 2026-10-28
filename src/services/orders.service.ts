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
import { calculateDocumentTotals, parseTaxRate } from '@/lib/money';
import { withDocumentNumberRetry } from '@/services/numbering.service';

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
    if (isMockAuth || !supabase) {
      return storage.getSalesOrders(orgId);
    }

    const { data: dbOrders, error: ordersErr } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*)')
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
    if (isMockAuth || !supabase) {
      return storage.createSalesOrder(orgId, input);
    }

    // 1. Calculate financials using audited money calculations
    const docTotals = calculateDocumentTotals(
      input.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      }))
    );

    const formattedItems = input.items.map((it, idx) => {
      const line = docTotals.items[idx];
      return {
        product_id: it.productId,
        product_name: it.productName,
        product_sku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        discount_percent: it.discountPercent,
        tax_rate: parseTaxRate(it.taxRate, 18),
        line_subtotal: line.taxableAmount,
        line_tax: line.taxAmount,
        line_total: line.totalAmount,
        document_discount_share: line.documentDiscountShare ?? 0,
      };
    });

    const client = supabase!;
    // 2. Insert sales order header with atomic sequential numbering and collision retry
    const orderHeader = await withDocumentNumberRetry<{ id: string } & Record<string, any>>(
      orgId,
      'SALES_ORDER',
      async (allocatedOrderNumber) => {
        return client
          .from('sales_orders')
          .insert({
            organization_id: orgId,
            order_number: allocatedOrderNumber,
            customer_id: input.customerId,
            quotation_id: input.quotationId || null,
            status: 'DRAFT',
            order_date: input.orderDate,
            subtotal: docTotals.grossSubtotal,
            discount_amount: docTotals.discountTotal,
            tax_amount: docTotals.taxAmount,
            total_amount: docTotals.totalAmount,
            totals_version: 2,
            notes: input.notes || null,
          })
          .select()
          .single();
      }
    );

    // 3. Insert line items
    const lineItemPayload = formattedItems.map((it) => ({
      ...it,
      sales_order_id: orderHeader.id,
    }));

    const { data: insertedItems, error: itemsErr } = await supabase
      .from('sales_order_items')
      .insert(lineItemPayload)
      .select();

    if (itemsErr) {
      throw new Error(`Failed to insert order items: ${itemsErr.message}`);
    }

    const items = (insertedItems || []).map(mapDbSalesOrderItem);
    return mapDbSalesOrder(orderHeader, items);
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
    if (isMockAuth || !supabase) {
      storage.confirmSalesOrder(orgId, orderId, userRole as any);
      return { success: true, status: 'CONFIRMED' };
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
    if (isMockAuth || !supabase) {
      return storage.getQuotations(orgId);
    }

    const { data: dbQuotations, error } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*)')
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
    if (isMockAuth || !supabase) {
      return storage.createQuotation(orgId, input);
    }

    const docTotals = calculateDocumentTotals(
      input.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      }))
    );

    const formattedItems = input.items.map((it, idx) => {
      const line = docTotals.items[idx];
      return {
        product_id: it.productId,
        product_name: it.productName,
        product_sku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        discount_percent: it.discountPercent,
        tax_rate: parseTaxRate(it.taxRate, 18),
        line_subtotal: line.taxableAmount,
        line_tax: line.taxAmount,
        line_total: line.totalAmount,
        document_discount_share: line.documentDiscountShare ?? 0,
      };
    });

    const client = supabase!;
    // 2. Insert quotation header with atomic sequential numbering and collision retry
    const quotHeader = await withDocumentNumberRetry<{ id: string } & Record<string, any>>(
      orgId,
      'QUOTATION',
      async (allocatedQuotationNumber) => {
        return client
          .from('quotations')
          .insert({
            organization_id: orgId,
            quotation_number: allocatedQuotationNumber,
            customer_id: input.customerId,
            status: 'DRAFT',
            valid_until: input.validUntil,
            subtotal: docTotals.grossSubtotal,
            discount_amount: docTotals.discountTotal,
            tax_amount: docTotals.taxAmount,
            total_amount: docTotals.totalAmount,
            totals_version: 2,
            notes: input.notes || null,
          })
          .select()
          .single();
      }
    );

    const lineItemPayload = formattedItems.map((it) => ({
      ...it,
      quotation_id: quotHeader.id,
    }));

    const { data: insertedItems, error: itemsErr } = await supabase
      .from('quotation_items')
      .insert(lineItemPayload)
      .select();

    if (itemsErr) {
      throw new Error(`Failed to insert quotation items: ${itemsErr.message}`);
    }

    const items = (insertedItems || []).map(mapDbQuotationItem);
    return mapDbQuotation(quotHeader, items);
  },

  async convertQuotationToOrder(
    orgId: string,
    quotationId: string,
    isMockAuth: boolean = false
  ): Promise<SalesOrder> {
    if (isMockAuth || !supabase) {
      return storage.convertQuotationToOrder(orgId, quotationId);
    }

    const { data: quot, error: quotErr } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*)')
      .eq('id', quotationId)
      .eq('organization_id', orgId)
      .single();

    if (quotErr || !quot) {
      throw new Error(`Quotation not found: ${quotErr?.message || 'Invalid ID'}`);
    }

    const orderItems = (quot.items || []).map((it: any) => ({
      productId: it.product_id,
      productName: it.product_name,
      productSku: it.product_sku,
      uom: it.uom,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      discountPercent: Number(it.discount_percent) || 0,
      taxRate: parseTaxRate(it.tax_rate ?? it.taxRate, 18),
    }));

    const order = await this.createSalesOrder(
      orgId,
      {
        customerId: quot.customer_id,
        orderDate: new Date().toISOString().split('T')[0],
        quotationId: quot.id,
        notes: `Converted from Quotation ${quot.quotation_number}`,
        items: orderItems,
      },
      false
    );

    const { error: updateErr } = await supabase
      .from('quotations')
      .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
      .eq('id', quotationId)
      .eq('organization_id', orgId);

    if (updateErr) {
      throw new Error(`Order created, but failed to update quotation status: ${updateErr.message}`);
    }

    return order;
  },
};
