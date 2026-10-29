import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Payment, PaymentAllocation, PaymentMethod, Role } from '@/types';

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
  async getPayments(orgId: string, isMockAuth: boolean = false): Promise<Payment[]> {
    if (isMockAuth) {
      return storage.getPayments(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data: dbPayments, error } = await supabase
      .from('payments')
      .select('*, allocations:payment_allocations(*)')
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

    // Call remote transactional RPC
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
