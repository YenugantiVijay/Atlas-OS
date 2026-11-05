import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Payment, PaymentAllocation, PaymentMethod, Role, PaginationParams, PaginatedResult, PaymentsSummary } from '@/types';
import { roundMoney } from '@/lib/money';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';
import { mapDbCustomer } from './customers.service';

export function mapDbPaymentAllocation(row: any): PaymentAllocation {
  return {
    id: row.id,
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    amountAllocated: Number(row.amount_allocated),
    createdAt: row.created_at,
  };
}

export function mapDbPayment(row: any, allocations: PaymentAllocation[] = []): Payment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    paymentNumber: row.payment_number,
    customerId: row.customer_id,
    customer: row.customer ? mapDbCustomer(row.customer) : undefined,
    amount: Number(row.amount),
    paymentMethod: row.payment_method as PaymentMethod,
    referenceNumber: row.reference_number || undefined,
    paymentDate: row.payment_date,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    createdAt: row.created_at,
    allocations,
  };
}

export const paymentsService = {
  async getPaymentsPaginated(
    orgId: string,
    params: PaginationParams = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<Payment>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const allPayments = await storage.getPayments(orgId);
      return paginateArray(
        allPayments,
        params,
        (p, s) =>
          p.paymentNumber.toLowerCase().includes(s) ||
          Boolean(p.customer?.name && p.customer.name.toLowerCase().includes(s)) ||
          Boolean(p.referenceNumber && p.referenceNumber.toLowerCase().includes(s)) ||
          p.paymentMethod.toLowerCase().includes(s),
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('payments')
      .select('*, allocations:payment_allocations(*), customer:customers!fk_payments_customer_org(*)', { count: 'exact' })
      .eq('organization_id', orgId);

    if (params.search && params.search.trim()) {
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').trim();
      if (s) {
        query = query.or(`payment_number.ilike.%${s}%,reference_number.ilike.%${s}%`);
      }
    }

    if (params.paymentMethod) {
      query = query.eq('payment_method', params.paymentMethod);
    }

    const ALLOWED_PAY_SORT_FIELDS: Record<string, string> = {
      paymentNumber: 'payment_number',
      paymentDate: 'payment_date',
      amount: 'amount',
      paymentMethod: 'payment_method',
      createdAt: 'created_at',
    };
    const sortBy = ALLOWED_PAY_SORT_FIELDS[params.sortBy || 'createdAt'] || 'created_at';
    const ascending = params.sortOrder === 'asc' ? true : false;
    query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

    const { data: dbPayments, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch payments: ${error.message}`);
    }

    const totalCount = count || 0;
    const mapped = (dbPayments || []).map((row) => {
      const allocations = (row.allocations || []).map(mapDbPaymentAllocation);
      return mapDbPayment(row, allocations);
    });

    return buildPaginatedResult(mapped, totalCount, page, pageSize);
  },

  async getPayments(orgId: string, isMockAuth: boolean = false): Promise<Payment[]> {
    if (isMockAuth) {
      return storage.getPayments(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data: dbPayments, error } = await supabase
      .from('payments')
      .select('*, allocations:payment_allocations(*), customer:customers!fk_payments_customer_org(*)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch payments: ${error.message}`);
    }

    return (dbPayments || []).map((row) => {
      const allocations = (row.allocations || []).map(mapDbPaymentAllocation);
      return mapDbPayment(row, allocations);
    });
  },

  async getPaymentsSummary(orgId: string, isMockAuth: boolean = false): Promise<PaymentsSummary> {
    if (isMockAuth) {
      return storage.getPaymentsSummary(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('get_payments_summary', { p_org_id: orgId });

    if (error) {
      // Resilient fallback if RPC not yet deployed
      const [payRes, invRes] = await Promise.all([
        supabase.from('payments').select('amount', { count: 'exact' }).eq('organization_id', orgId),
        supabase
          .from('invoices')
          .select('total_amount, total_paid')
          .eq('organization_id', orgId)
          .in('status', ['ISSUED', 'PARTIALLY_PAID']),
      ]);

      const totalCollected = (payRes.data || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const paymentCount = payRes.count || (payRes.data || []).length;
      const openInvoices = (invRes.data || []).filter(
        (i) => (Number(i.total_amount) || 0) - (Number(i.total_paid) || 0) > 0
      );
      const totalReceivables = openInvoices.reduce(
        (s, i) => s + ((Number(i.total_amount) || 0) - (Number(i.total_paid) || 0)),
        0
      );

      return {
        totalCollected: roundMoney(totalCollected),
        paymentCount,
        totalReceivables: roundMoney(totalReceivables),
        openInvoicesCount: openInvoices.length,
      };
    }

    return {
      totalCollected: Number(data?.total_collected) || 0,
      paymentCount: Number(data?.payment_count) || 0,
      totalReceivables: Number(data?.total_receivables) || 0,
      openInvoicesCount: Number(data?.open_invoices_count) || 0,
    };
  },

  /**
   * ATOMIC PAYMENT RECORDING & ALLOCATION
   * Calls remote SECURITY DEFINER function record_payment_and_allocate(...)
   * Handles payment insertion, ledger allocation, invoice balance deduction, and status transition.
   */
  async recordPayment(
    orgId: string,
    input: {
      customerId: string;
      invoiceId?: string;
      amount: number;
      paymentMethod: PaymentMethod;
      referenceNumber?: string;
      paymentDate: string;
      notes?: string;
      idempotencyKey?: string;
    },
    isMockAuth: boolean = false,
    userRole?: Role | null
  ): Promise<Payment> {
    if (isMockAuth) {
      return storage.recordPayment(orgId, input, userRole);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const idempotencyKey = input.idempotencyKey || crypto.randomUUID();

    // Call remote transactional RPC with stable request-level idempotency key
    const { data: rpcRes, error: rpcErr } = await supabase.rpc(
      'record_payment_and_allocate',
      {
        p_org_id: orgId,
        p_customer_id: input.customerId,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_reference_no: input.referenceNumber?.trim() || null,
        p_payment_date: input.paymentDate,
        p_notes: input.notes?.trim() || null,
        p_invoice_id: input.invoiceId || null,
        p_allocated_amount: input.invoiceId ? input.amount : null,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcErr) {
      throw new Error(`Payment failed: ${rpcErr.message}`);
    }

    const paymentId = rpcRes?.payment_id;
    if (!paymentId) {
      throw new Error('Payment was recorded but no payment ID returned from database.');
    }

    // Fetch full recorded payment
    const { data: payRow, error: fetchErr } = await supabase
      .from('payments')
      .select('*, allocations:payment_allocations(*)')
      .eq('id', paymentId)
      .single();

    if (fetchErr || !payRow) {
      const receiptRef = rpcRes?.payment_number ? `Receipt ${rpcRes.payment_number}` : `ID ${paymentId}`;
      throw new Error(
        `Payment was committed to the ledger (${receiptRef}), but loading confirmation details failed: ${fetchErr?.message || 'Record not returned'}. Do NOT resubmit this payment; please refresh the payments ledger to verify.`
      );
    }

    const allocations = (payRow.allocations || []).map(mapDbPaymentAllocation);
    return mapDbPayment(payRow, allocations);
  },
};
