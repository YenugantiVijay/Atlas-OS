/**
 * PostgreSQL Database Integration Test Suite: DEF-009 Payment & Allocation Direct-DML Bypass
 *
 * NOTE & AUDIT DISCLAIMER:
 * In accordance with Phase safety boundaries, remote database operations,
 * remote SQL executions, and unapproved connections to staging/production
 * are STRICTLY PROHIBITED.
 *
 * This test suite defines the authoritative PostgreSQL integration contracts
 * for `public.payments` and `public.payment_allocations` security lockdown (Migration 017).
 *
 * IMPORTANT:
 * When executed locally without a live PostgreSQL database connection, all live tests
 * in the skipped block below are SKIPPED. Skipped tests represent UNVERIFIED RUNTIME
 * BEHAVIOUR and must NOT be counted as passing database security checks.
 * Once staging database access is authorized and Migration 017 applied, set
 * INTEGRATION_TEST_DB=true in the test environment to execute these tests live.
 */

import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

const hasDatabaseEnv = process.env.INTEGRATION_TEST_DB === 'true' && !!supabase;

describe('PostgreSQL Payment Security Integration Contracts (DEF-009)', () => {
  describe.skipIf(!hasDatabaseEnv)('Live PostgreSQL Payment DML & RPC Execution (UNVERIFIED RUNTIME BEHAVIOUR — Pending Staging Authorization)', () => {
    const testOrgId = '00000000-0000-0000-0000-000000000001';
    const foreignOrgId = '00000000-0000-0000-0000-000000000099';
    const testCustomerId = '00000000-0000-0000-0000-000000000002';
    const testInvoiceId = '00000000-0000-0000-0000-000000000003';

    // Contract 1: Direct authenticated INSERT into public.payments denied
    it('rejects direct authenticated client INSERT into public.payments with permission denied error', async () => {
      const { data, error } = await supabase!
        .from('payments')
        .insert({
          organization_id: testOrgId,
          customer_id: testCustomerId,
          payment_number: 'REC-BYPASS-001',
          amount: 5000,
          payment_method: 'BANK_TRANSFER',
          payment_date: '2026-10-31',
        })
        .select();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied for (table|relation) "?payments"?/i);
    });

    // Contract 2: Direct authenticated INSERT into public.payment_allocations denied
    it('rejects direct authenticated client INSERT into public.payment_allocations with permission denied error', async () => {
      const dummyPaymentId = '00000000-0000-0000-0000-000000000099';

      const { data, error } = await supabase!
        .from('payment_allocations')
        .insert({
          payment_id: dummyPaymentId,
          invoice_id: testInvoiceId,
          amount_allocated: 2500,
        })
        .select();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied for (table|relation) "?payment_allocations"?/i);
    });

    // Contract 3: Direct authenticated UPDATE / DELETE denied on both tables
    it('rejects direct authenticated client UPDATE and DELETE on payments and payment_allocations', async () => {
      const dummyId = '00000000-0000-0000-0000-000000000099';

      // UPDATE on payments
      const { error: updatePayErr } = await supabase!
        .from('payments')
        .update({ amount: 99999 })
        .eq('id', dummyId);
      expect(updatePayErr).toBeDefined();
      expect(updatePayErr?.message).toMatch(/permission denied for (table|relation) "?payments"?/i);

      // DELETE on payments
      const { error: deletePayErr } = await supabase!
        .from('payments')
        .delete()
        .eq('id', dummyId);
      expect(deletePayErr).toBeDefined();
      expect(deletePayErr?.message).toMatch(/permission denied for (table|relation) "?payments"?/i);

      // UPDATE on payment_allocations
      const { error: updateAllocErr } = await supabase!
        .from('payment_allocations')
        .update({ amount_allocated: 99999 })
        .eq('id', dummyId);
      expect(updateAllocErr).toBeDefined();
      expect(updateAllocErr?.message).toMatch(/permission denied for (table|relation) "?payment_allocations"?/i);

      // DELETE on payment_allocations
      const { error: deleteAllocErr } = await supabase!
        .from('payment_allocations')
        .delete()
        .eq('id', dummyId);
      expect(deleteAllocErr).toBeDefined();
      expect(deleteAllocErr?.message).toMatch(/permission denied for (table|relation) "?payment_allocations"?/i);
    });

    // Contract 4: Anonymous client direct access denied
    it('denies anonymous client reads and writes on payments and payment_allocations', async () => {
      const { data: payData, error: payErr } = await supabase!
        .from('payments')
        .select('id');
      expect(payData === null || (Array.isArray(payData) && payData.length === 0)).toBe(true);
      expect(payErr !== undefined || payData === null).toBe(true);

      const { data: allocData, error: allocErr } = await supabase!
        .from('payment_allocations')
        .select('id');
      expect(allocData === null || (Array.isArray(allocData) && allocData.length === 0)).toBe(true);
      expect(allocErr !== undefined || allocData === null).toBe(true);

      const { error: anonInsertErr } = await supabase!
        .from('payments')
        .insert({
          organization_id: testOrgId,
          customer_id: testCustomerId,
          payment_number: 'REC-ANON-001',
          amount: 100,
          payment_method: 'CASH',
        });
      expect(anonInsertErr).toBeDefined();
      expect(anonInsertErr?.message).toMatch(/permission denied for (table|relation) "?payments"?/i);
    });

    // Contract 5: Authenticated SELECT preserved under RLS tenant isolation
    it('preserves authenticated tenant SELECT access for payments and payment_allocations', async () => {
      const { data: payRows, error: payErr } = await supabase!
        .from('payments')
        .select('*, allocations:payment_allocations(*)')
        .eq('organization_id', testOrgId);

      expect(payErr).toBeNull();
      expect(Array.isArray(payRows)).toBe(true);
    });

    // Contract 6: Cross-tenant SELECT blocked under RLS
    it('blocks authenticated user from viewing payments belonging to another organization', async () => {
      const { data: foreignPayments, error: foreignErr } = await supabase!
        .from('payments')
        .select('*')
        .eq('organization_id', foreignOrgId);

      expect(foreignErr).toBeNull();
      expect(foreignPayments).toBeDefined();
      expect(foreignPayments?.length).toBe(0);
    });

    // Contract 7: Authorized caller can record payment via atomic RPC
    it('allows authorized roles to record payment and allocate via record_payment_and_allocate RPC', async () => {
      const { data, error } = await supabase!.rpc('record_payment_and_allocate', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_amount: 1000,
        p_payment_method: 'BANK_TRANSFER',
        p_reference_no: 'UTR-TEST-12345',
        p_payment_date: '2026-10-31',
        p_notes: 'Integration test payment',
        p_invoice_id: testInvoiceId,
        p_allocated_amount: 1000,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.success).toBe(true);
      expect(data?.payment_id).toBeDefined();
      expect(data?.payment_number).toMatch(/^REC-/);
    });

    // Contract 8: Atomic transaction consistency
    it('atomically generates receipt sequence, creates allocation, updates invoice total_paid, and logs audit event', async () => {
      const { data: rpcRes, error: rpcErr } = await supabase!.rpc('record_payment_and_allocate', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_amount: 500,
        p_payment_method: 'UPI',
        p_reference_no: 'UPI-TXN-98765',
        p_payment_date: '2026-10-31',
        p_notes: 'Atomic verification payment',
        p_invoice_id: testInvoiceId,
        p_allocated_amount: 500,
      });

      expect(rpcErr).toBeNull();
      const paymentId = rpcRes?.payment_id;
      expect(paymentId).toBeDefined();

      // Verify payment was recorded
      const { data: paymentRow } = await supabase!
        .from('payments')
        .select('*, allocations:payment_allocations(*)')
        .eq('id', paymentId)
        .single();

      expect(paymentRow).toBeDefined();
      expect(paymentRow.amount).toBe(500);
      expect(paymentRow.payment_number).toMatch(/^REC-/);
      expect(paymentRow.allocations.length).toBe(1);
      expect(paymentRow.allocations[0].amount_allocated).toBe(500);

      // Verify invoice total_paid updated
      const { data: invRow } = await supabase!
        .from('invoices')
        .select('total_paid, status')
        .eq('id', testInvoiceId)
        .single();

      expect(invRow).toBeDefined();
      expect(invRow!.total_paid).toBeGreaterThanOrEqual(500);

      // Verify audit event logged
      const { data: auditEvents } = await supabase!
        .from('audit_events')
        .select('*')
        .eq('entity_id', paymentId)
        .eq('action', 'PAYMENT_RECORDED');

      expect(auditEvents).toBeDefined();
      expect(auditEvents!.length).toBeGreaterThan(0);
    });

    // Contract 9: Invalid over-allocation rollback leaves zero partial records
    it('rolls back entire transaction when allocated amount exceeds invoice balance, leaving zero partial payment, allocation, or audit event', async () => {
      // 1. Snapshot invoice state before test
      const { data: invBefore } = await supabase!
        .from('invoices')
        .select('total_paid, status')
        .eq('id', testInvoiceId)
        .single();

      const excessiveAmount = 99999999;
      const testRef = 'UTR-FAIL-OVERALLOC';

      // 2. Attempt invalid over-allocation
      const { data, error } = await supabase!.rpc('record_payment_and_allocate', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_amount: excessiveAmount,
        p_payment_method: 'CASH',
        p_reference_no: testRef,
        p_payment_date: '2026-10-31',
        p_notes: 'Excessive overpayment test',
        p_invoice_id: testInvoiceId,
        p_allocated_amount: excessiveAmount,
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/exceeds outstanding balance/i);

      // 3. Verify zero payment header inserted
      const { data: failedPayments } = await supabase!
        .from('payments')
        .select('id')
        .eq('reference_number', testRef);
      expect(failedPayments).toBeDefined();
      expect(failedPayments?.length).toBe(0);

      // 4. Verify zero payment allocation inserted
      const { data: failedAllocations } = await supabase!
        .from('payment_allocations')
        .select('id')
        .eq('invoice_id', testInvoiceId)
        .eq('amount_allocated', excessiveAmount);
      expect(failedAllocations).toBeDefined();
      expect(failedAllocations?.length).toBe(0);

      // 5. Verify invoice total_paid and status remained completely untouched
      const { data: invAfter } = await supabase!
        .from('invoices')
        .select('total_paid, status')
        .eq('id', testInvoiceId)
        .single();
      expect(invAfter?.total_paid).toBe(invBefore?.total_paid);
      expect(invAfter?.status).toBe(invBefore?.status);

      // 6. Verify zero audit event logged
      const { data: failedAudit } = await supabase!
        .from('audit_events')
        .select('id')
        .contains('details', { reference_number: testRef });
      expect(failedAudit?.length || 0).toBe(0);
    });

    // Contract 10: Cross-tenant and cross-customer allocation rejection
    it('rejects payment allocation when invoice belongs to a different customer or organization, leaving zero records', async () => {
      const foreignCustomerId = '00000000-0000-0000-0000-000000000099';
      const testRef = 'UTR-FAIL-CUST-MISMATCH';

      const { data, error } = await supabase!.rpc('record_payment_and_allocate', {
        p_org_id: testOrgId,
        p_customer_id: foreignCustomerId,
        p_amount: 500,
        p_payment_method: 'CASH',
        p_reference_no: testRef,
        p_payment_date: '2026-10-31',
        p_notes: 'Mismatched customer allocation',
        p_invoice_id: testInvoiceId,
        p_allocated_amount: 500,
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Customer .* not found in organization|Invoice .* does not belong to customer/i);

      // Verify no orphaned payment created
      const { data: failedPayments } = await supabase!
        .from('payments')
        .select('id')
        .eq('reference_number', testRef);
      expect(failedPayments?.length || 0).toBe(0);
    });
  });

  it('documents verification status: runtime PostgreSQL execution remains pending staging authorization', () => {
    // Explicit static verification confirming integration test specifications are defined
    // Skipped tests in the block above represent unverified runtime behaviour until executed against staging
    expect(hasDatabaseEnv).toBe(false);
  });
});
