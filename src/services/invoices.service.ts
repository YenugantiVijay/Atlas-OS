import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Invoice, InvoiceItem, InvoiceStatus, UOM } from '@/types';
import { calculateDocumentTotals, parseTaxRate } from '@/lib/money';
import { withDocumentNumberRetry } from '@/services/numbering.service';

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
    taxRate: parseTaxRate(row.tax_rate, 18),
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

export const invoicesService = {
  async getInvoices(orgId: string, isMockAuth: boolean = false): Promise<Invoice[]> {
    if (isMockAuth || !supabase) {
      return storage.getInvoices(orgId);
    }

    const { data: dbInvoices, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
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

  async createInvoice(
    orgId: string,
    input: {
      customerId: string;
      salesOrderId?: string;
      invoiceDate: string;
      dueDate: string;
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
  ): Promise<Invoice> {
    if (isMockAuth || !supabase) {
      return storage.createInvoice(orgId, input);
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
    // 2. Insert invoice header with atomic sequential numbering and collision retry
    const invHeader = await withDocumentNumberRetry<{ id: string } & Record<string, any>>(
      orgId,
      'INVOICE',
      async (allocatedInvoiceNumber) => {
        return client
          .from('invoices')
          .insert({
            organization_id: orgId,
            invoice_number: allocatedInvoiceNumber,
            customer_id: input.customerId,
            sales_order_id: input.salesOrderId || null,
            status: 'ISSUED',
            invoice_date: input.invoiceDate,
            due_date: input.dueDate,
            subtotal: docTotals.grossSubtotal,
            discount_amount: docTotals.discountTotal,
            tax_amount: docTotals.taxAmount,
            total_amount: docTotals.totalAmount,
            total_paid: 0,
            totals_version: 2,
            notes: input.notes || null,
          })
          .select()
          .single();
      }
    );

    const lineItemPayload = formattedItems.map((it) => ({
      ...it,
      invoice_id: invHeader.id,
    }));

    const { data: insertedItems, error: itemsErr } = await supabase
      .from('invoice_items')
      .insert(lineItemPayload)
      .select();

    if (itemsErr) {
      throw new Error(`Failed to insert invoice items: ${itemsErr.message}`);
    }

    const items = (insertedItems || []).map(mapDbInvoiceItem);
    return mapDbInvoice(invHeader, items);
  },

  async createInvoiceFromOrder(
    orgId: string,
    orderId: string,
    isMockAuth: boolean = false
  ): Promise<Invoice> {
    if (isMockAuth || !supabase) {
      return storage.createInvoiceFromOrder(orgId, orderId);
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
      taxRate: parseTaxRate(it.tax_rate ?? it.taxRate, 18),
    }));

    return this.createInvoice(
      orgId,
      {
        customerId: order.customer_id,
        salesOrderId: order.id,
        invoiceDate: new Date().toISOString().split('T')[0],
        dueDate,
        notes: `Generated from Sales Order ${order.order_number}`,
        items: orderItems,
      },
      false
    );
  },
};
