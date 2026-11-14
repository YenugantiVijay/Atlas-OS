import { ordersService } from './orders.service';
import { invoicesService } from './invoices.service';
import { paymentsService } from './payments.service';
import { goodsReceivingService } from './goods-receiving.service';
import { auditService } from './audit.service';
import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import {
  Quotation,
  SalesOrder,
  Invoice,
  Payment,
  PaymentMethod,
  Role,
  AuditEvent,
  StockMovement,
} from '@/types';
import { calculateInvoiceBalance } from '@/lib/money';
import { mapDbStockMovement } from './inventory.service';

export type WorkflowEntityType = 'QUOTATION' | 'SALES_ORDER' | 'INVOICE' | 'PAYMENT' | 'GOODS_RECEIPT';

export interface WorkflowTransitionRecord {
  timestamp: string;
  fromStatus?: string;
  toStatus: string;
  actorId?: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface WorkflowLineage {
  quotation?: Quotation | null;
  salesOrder?: SalesOrder | null;
  invoice?: Invoice | null;
  payments: Payment[];
  stockMovements: StockMovement[];
  auditHistory: AuditEvent[];
}

export interface RecordWorkflowPaymentInput {
  customerId: string;
  invoiceId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  paymentDate: string;
  notes?: string;
  idempotencyKey?: string;
}

/**
 * Validates whether a requested order status transition is permissible under ERP rules.
 */
export function validateOrderTransition(currentStatus: string, targetStatus: string): void {
  const allowedTransitions: Record<string, string[]> = {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['FULFILLED', 'CANCELLED'],
    FULFILLED: [], // Terminal once invoiced and fulfilled
    CANCELLED: [], // Terminal
  };

  const allowed = allowedTransitions[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid sales order transition from "${currentStatus}" to "${targetStatus}". Allowed next states: ${
        allowed.length > 0 ? allowed.join(', ') : 'None (Terminal state)'
      }`
    );
  }
}

/**
 * Validates whether an invoice can accept an incoming payment amount.
 */
export function validateInvoicePaymentAcceptance(invoice: Invoice, amountToPay: number): void {
  if (invoice.status === 'CANCELLED') {
    throw new Error(`Cannot record payment against cancelled invoice ${invoice.invoiceNumber}.`);
  }
  if (invoice.status === 'PAID') {
    throw new Error(`Invoice ${invoice.invoiceNumber} is already fully paid.`);
  }
  if (amountToPay <= 0) {
    throw new Error('Payment allocation amount must be strictly positive.');
  }

  const remainingBalance = calculateInvoiceBalance(invoice.totalAmount, invoice.totalPaid);
  // Allow slight epsilon tolerance for sub-paisa floating point rounding
  if (amountToPay > remainingBalance + 0.01) {
    throw new Error(
      `Payment amount ₹${amountToPay.toFixed(2)} exceeds invoice outstanding balance ₹${remainingBalance.toFixed(2)}.`
    );
  }
}

export const coreWorkflowService = {
  /**
   * 1. QUOTATION -> SALES ORDER
   * Converts a quotation to a sales order, preserving line items, discounts, and taxes.
   * Quotation status transitions to CONVERTED.
   */
  async convertQuotationToSalesOrder(
    orgId: string,
    quotationId: string,
    isMockAuth: boolean = false,
    idempotencyKey?: string
  ): Promise<SalesOrder> {
    const existingQuot = isMockAuth
      ? storage.getQuotations(orgId).find((q) => q.id === quotationId)
      : await ordersService.getQuotationById(orgId, quotationId);

    if (!existingQuot) {
      throw new Error(`Quotation not found: ${quotationId}`);
    }

    if (existingQuot.status === 'CONVERTED') {
      // Idempotency: find already created sales order linked to this quotation
      const existingOrders = await ordersService.getSalesOrders(orgId, isMockAuth);
      const linkedOrder = existingOrders.find((o) => o.quotationId === quotationId);
      if (linkedOrder) {
        return linkedOrder;
      }
      throw new Error(`Quotation ${existingQuot.quotationNumber} has already been converted.`);
    }

    if (existingQuot.status === 'REJECTED' || existingQuot.status === 'EXPIRED') {
      throw new Error(`Cannot convert quotation in status "${existingQuot.status}".`);
    }

    return ordersService.convertQuotationToOrder(orgId, quotationId, isMockAuth, idempotencyKey);
  },

  /**
   * 2. CONFIRM SALES ORDER
   * Validates available inventory and deducts stock atomically via SALES_DISPATCH movements.
   * Order status transitions from DRAFT -> CONFIRMED.
   */
  async confirmSalesOrder(
    orgId: string,
    orderId: string,
    userRole: Role = 'sales',
    isMockAuth: boolean = false
  ): Promise<{ success: boolean; status: string }> {
    const orders = await ordersService.getSalesOrders(orgId, isMockAuth);
    const order = orders.find((o) => o.id === orderId);

    if (!order) {
      throw new Error(`Sales order not found: ${orderId}`);
    }

    if (order.status === 'CONFIRMED') {
      return { success: true, status: 'CONFIRMED' }; // Idempotent
    }

    validateOrderTransition(order.status, 'CONFIRMED');
    return ordersService.confirmSalesOrder(orgId, orderId, userRole, isMockAuth);
  },

  /**
   * 3. CANCEL SALES ORDER
   * If the order was confirmed, reverses the stock deduction via RETURN_INWARD stock movement.
   * Prevents cancellation if an active invoice already references this order.
   */
  async cancelSalesOrder(
    orgId: string,
    orderId: string,
    reason: string = 'Customer cancelled order',
    userRole: Role = 'sales',
    isMockAuth: boolean = false
  ): Promise<SalesOrder> {
    if (isMockAuth) {
      return storage.cancelSalesOrder(orgId, orderId, reason, userRole);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // Pre-check order status and invoice dependency
    const { data: order, error: orderErr } = await supabase
      .from('sales_orders')
      .select('*, items:sales_order_items(*)')
      .eq('id', orderId)
      .eq('organization_id', orgId)
      .single();

    if (orderErr || !order) {
      throw new Error(`Sales order not found: ${orderErr?.message || orderId}`);
    }

    if (order.status === 'CANCELLED') {
      return order as any; // Idempotent
    }

    // Check for active linked invoices
    const { data: linkedInvoices, error: invoiceCheckErr } = await supabase
      .from('invoices')
      .select('id, invoice_number, status')
      .eq('sales_order_id', orderId)
      .eq('organization_id', orgId)
      .neq('status', 'CANCELLED');

    if (invoiceCheckErr) {
      throw new Error(`Failed to verify linked invoices before cancellation: ${invoiceCheckErr.message}`);
    }

    if (linkedInvoices && linkedInvoices.length > 0) {
      throw new Error(
        `Cannot cancel sales order ${order.order_number}: referenced by active invoice ${linkedInvoices[0].invoice_number}. Cancel invoice first.`
      );
    }

    // Cloud cancel RPC
    const { data: cancelResult, error: cancelErr } = await supabase.rpc('cancel_sales_order_atomic', {
      p_org_id: orgId,
      p_order_id: orderId,
      p_reason: reason,
    });

    if (cancelErr) {
      throw new Error(`Failed to cancel sales order: ${cancelErr.message}`);
    }

    return cancelResult;
  },

  /**
   * 4. SALES ORDER -> TAX INVOICE
   * Creates an official GST invoice from a confirmed sales order.
   * Sales order status transitions from CONFIRMED -> FULFILLED.
   */
  async createInvoiceFromSalesOrder(
    orgId: string,
    orderId: string,
    isMockAuth: boolean = false,
    idempotencyKey?: string
  ): Promise<Invoice> {
    return invoicesService.createInvoiceFromOrder(orgId, orderId, isMockAuth, idempotencyKey);
  },

  /**
   * 5. CANCEL INVOICE
   * Cancels an issued invoice if no payments have been allocated to it.
   * If linked to a sales order, reverts sales order status from FULFILLED back to CONFIRMED.
   */
  async cancelInvoice(
    orgId: string,
    invoiceId: string,
    reason: string = 'Cancelled by billing operator',
    isMockAuth: boolean = false
  ): Promise<Invoice> {
    if (isMockAuth) {
      return storage.cancelInvoice(orgId, invoiceId, reason);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('cancel_invoice_atomic', {
      p_org_id: orgId,
      p_invoice_id: invoiceId,
      p_reason: reason,
    });

    if (error) {
      throw new Error(`Failed to cancel invoice: ${error.message}`);
    }

    return data;
  },

  /**
   * 6. RECORD PAYMENT & ALLOCATE TO INVOICE
   * Atomically records a customer payment, creates the payment allocation,
   * increments invoice totalPaid, and updates invoice status (ISSUED -> PARTIALLY_PAID -> PAID).
   */
  async recordInvoicePayment(
    orgId: string,
    input: RecordWorkflowPaymentInput,
    userRole: Role = 'accounts',
    isMockAuth: boolean = false
  ): Promise<Payment> {
    const invoice = await invoicesService.getInvoiceById(orgId, input.invoiceId, isMockAuth);
    if (!invoice) {
      throw new Error(`Invoice not found: ${input.invoiceId}`);
    }

    validateInvoicePaymentAcceptance(invoice, input.amount);

    return paymentsService.recordPayment(
      orgId,
      {
        customerId: input.customerId,
        invoiceId: input.invoiceId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber,
        paymentDate: input.paymentDate,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      },
      isMockAuth,
      userRole
    );
  },

  /**
   * 7. RECEIVE GOODS & POST TO STOCK LEDGER
   * Saves a goods receiving worksheet and immediately posts it to the inventory ledger.
   * Increments product currentStock via verified GOODS_RECEIVED ledger movements.
   */
  async receiveAndPostGoods(
    orgId: string,
    command: {
      receiptId: string;
      supplierId: string;
      supplierInvoiceNumber: string;
      receivedOn: string;
      notes: string;
      lines: any[];
    },
    isMockAuth: boolean = false
  ): Promise<{ receipt_id: string; status: 'POSTED'; total_units?: number }> {
    await goodsReceivingService.saveDraft(
      {
        organizationId: orgId,
        receiptId: command.receiptId,
        supplierId: command.supplierId,
        supplierInvoiceNumber: command.supplierInvoiceNumber,
        receivedOn: command.receivedOn,
        notes: command.notes,
        lines: command.lines,
      },
      isMockAuth
    );

    const postResult = await goodsReceivingService.post(orgId, command.receiptId, isMockAuth);
    return postResult;
  },

  /**
   * 8. END-TO-END WORKFLOW LINEAGE TRACE
   * Traces the complete lifecycle history of a business transaction:
   * Quotation <-> Sales Order <-> Invoice <-> Payments + Ledger Movements + Audit Trail.
   */
  async getWorkflowLineage(
    orgId: string,
    entityType: 'SALES_ORDER' | 'INVOICE' | 'QUOTATION',
    entityId: string,
    isMockAuth: boolean = false
  ): Promise<WorkflowLineage> {
    let salesOrder: SalesOrder | null = null;
    let invoice: Invoice | null = null;
    let quotation: Quotation | null = null;

    if (entityType === 'SALES_ORDER') {
      const orders = await ordersService.getSalesOrders(orgId, isMockAuth);
      salesOrder = orders.find((o) => o.id === entityId) || null;
      if (salesOrder?.quotationId) {
        const quotes = await ordersService.getQuotations(orgId, isMockAuth);
        quotation = quotes.find((q) => q.id === salesOrder!.quotationId) || null;
      }
      const invoices = await invoicesService.getInvoices(orgId, isMockAuth);
      invoice = invoices.find((i) => i.salesOrderId === entityId && i.status !== 'CANCELLED') || null;
    } else if (entityType === 'INVOICE') {
      invoice = await invoicesService.getInvoiceById(orgId, entityId, isMockAuth);
      if (invoice?.salesOrderId) {
        const orders = await ordersService.getSalesOrders(orgId, isMockAuth);
        salesOrder = orders.find((o) => o.id === invoice!.salesOrderId) || null;
        if (salesOrder?.quotationId) {
          const quotes = await ordersService.getQuotations(orgId, isMockAuth);
          quotation = quotes.find((q) => q.id === salesOrder!.quotationId) || null;
        }
      }
    } else if (entityType === 'QUOTATION') {
      const quotes = await ordersService.getQuotations(orgId, isMockAuth);
      quotation = quotes.find((q) => q.id === entityId) || null;
      const orders = await ordersService.getSalesOrders(orgId, isMockAuth);
      salesOrder = orders.find((o) => o.quotationId === entityId) || null;
      if (salesOrder) {
        const invoices = await invoicesService.getInvoices(orgId, isMockAuth);
        invoice = invoices.find((i) => i.salesOrderId === salesOrder!.id && i.status !== 'CANCELLED') || null;
      }
    }

    // Retrieve linked payments if an invoice exists
    let payments: Payment[] = [];
    if (invoice) {
      const allPayments = await paymentsService.getPayments(orgId, isMockAuth);
      payments = allPayments.filter((p) =>
        (p.allocations || []).some((a) => a.invoiceId === invoice!.id)
      );
    }

    // Retrieve stock movements related to the sales order or goods
    let stockMovements: StockMovement[] = [];
    if (salesOrder) {
      if (isMockAuth) {
        stockMovements = storage
          .getStockMovements(orgId)
          .filter((m) => m.referenceId === salesOrder!.id);
      } else {
        if (!supabase) throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
        const { data, error } = await supabase
          .from('stock_movements')
          .select('*')
          .eq('organization_id', orgId)
          .eq('reference_id', salesOrder.id)
          .order('created_at', { ascending: true });
        if (error) throw new Error(`Failed to load sales order stock movements: ${error.message}`);
        stockMovements = (data || []).map(mapDbStockMovement);
      }
    }

    // Retrieve audit trail events
    const allAudits = await auditService.getAuditEvents(orgId, isMockAuth);
    const relatedIds = new Set([
      quotation?.id,
      salesOrder?.id,
      invoice?.id,
      ...payments.map((p) => p.id),
    ].filter(Boolean));

    const auditHistory = allAudits.filter(
      (a) => (a.entityId && relatedIds.has(a.entityId)) || (a.details && typeof a.details === 'object' && Object.values(a.details).some((v) => typeof v === 'string' && relatedIds.has(v)))
    );

    return {
      quotation,
      salesOrder,
      invoice,
      payments,
      stockMovements,
      auditHistory,
    };
  },
};
