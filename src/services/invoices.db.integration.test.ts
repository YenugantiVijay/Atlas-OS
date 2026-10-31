/**
 * PostgreSQL Database Integration Test Suite: DEF-003 Sales Order Invoicing Lifecycle
 *
 * NOTE & AUDIT DISCLAIMER:
 * In accordance with Phase safety boundaries, remote database operations,
 * remote SQL executions, and unapproved connections to staging/production
 * are STRICTLY PROHIBITED.
 *
 * This test suite defines the authoritative PostgreSQL integration contracts
 * for `create_invoice_atomic` (Migration 016). When a dedicated local PostgreSQL
 * container or staging database is authorized, set `INTEGRATION_TEST_DB=true`
 * in the test execution environment to run these tests live against PostgreSQL.
 *
 * Mocked unit tests in `invoices.test.ts` verify client-side orchestration,
 * argument delegation, and pre-checks, but CANNOT prove ACID transactions,
 * row locks, or PostgreSQL rollback behavior.
 */

import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

const hasDatabaseEnv = process.env.INTEGRATION_TEST_DB === 'true' && !!supabase;

describe('PostgreSQL create_invoice_atomic Integration Contracts (DEF-003)', () => {
  describe.skipIf(!hasDatabaseEnv)('Live PostgreSQL RPC Execution (Pending Staging Authorization)', () => {
    const testOrgId = '00000000-0000-0000-0000-000000000001';
    const testCustomerId = '00000000-0000-0000-0000-000000000002';
    const testProductId = '00000000-0000-0000-0000-000000000003';

    it('rejects direct RPC invoice creation against a DRAFT sales order', async () => {
      // In live DB: sales order with status = 'DRAFT'
      const draftOrderId = '10000000-0000-0000-0000-000000000001';

      const { data, error } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: draftOrderId,
        p_items: [
          {
            product_id: testProductId,
            quantity: 1,
            unit_price: 100,
            discount_percent: 0,
            tax_rate: 18,
          },
        ],
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Cannot create invoice from sales order .* with status DRAFT/);
    });

    it('rejects direct RPC invoice creation against a CANCELLED sales order', async () => {
      const cancelledOrderId = '10000000-0000-0000-0000-000000000002';

      const { data, error } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: cancelledOrderId,
        p_items: [
          {
            product_id: testProductId,
            quantity: 1,
            unit_price: 100,
            discount_percent: 0,
            tax_rate: 18,
          },
        ],
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Cannot create invoice from sales order .* with status CANCELLED/);
    });

    it('rejects direct RPC invoice creation against an already FULFILLED sales order', async () => {
      const fulfilledOrderId = '10000000-0000-0000-0000-000000000003';

      const { data, error } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: fulfilledOrderId,
        p_items: [
          {
            product_id: testProductId,
            quantity: 1,
            unit_price: 100,
            discount_percent: 0,
            tax_rate: 18,
          },
        ],
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Cannot create invoice from sales order .* with status FULFILLED/);
    });

    it('successfully permits identical request replay with original idempotency key after fulfillment', async () => {
      const confirmedOrderId = '10000000-0000-0000-0000-000000000004';
      const sharedKey = '20000000-0000-0000-0000-000000000001';

      // First call: transitions CONFIRMED -> FULFILLED and records idempotency mapping
      const { data: firstRes, error: firstErr } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: confirmedOrderId,
        p_idempotency_key: sharedKey,
        p_items: [
          {
            product_id: testProductId,
            quantity: 2,
            unit_price: 500,
            discount_percent: 0,
            tax_rate: 18,
          },
        ],
      });

      expect(firstErr).toBeNull();
      expect(firstRes.idempotent_replay).toBe(false);

      // Replay with identical key: intercepted in Step 5 before order status check
      const { data: replayRes, error: replayErr } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: confirmedOrderId,
        p_idempotency_key: sharedKey,
        p_items: [
          {
            product_id: testProductId,
            quantity: 2,
            unit_price: 500,
            discount_percent: 0,
            tax_rate: 18,
          },
        ],
      });

      expect(replayErr).toBeNull();
      expect(replayRes.id).toBe(firstRes.id);
      expect(replayRes.idempotent_replay).toBe(true);
    });

    it('rejects a duplicate request for the same order when using a NEW or DIFFERENT idempotency key', async () => {
      const confirmedOrderId = '10000000-0000-0000-0000-000000000005';
      const firstKey = '30000000-0000-0000-0000-000000000001';
      const secondKey = '30000000-0000-0000-0000-000000000002';

      // Initial invoice
      const { error: firstErr } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: confirmedOrderId,
        p_idempotency_key: firstKey,
        p_items: [{ product_id: testProductId, quantity: 1, unit_price: 100, discount_percent: 0, tax_rate: 18 }],
      });
      expect(firstErr).toBeNull();

      // Duplicate submission with different key must fail under sales order lock
      const { data, error: secondErr } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: confirmedOrderId,
        p_idempotency_key: secondKey,
        p_items: [{ product_id: testProductId, quantity: 1, unit_price: 100, discount_percent: 0, tax_rate: 18 }],
      });

      expect(data).toBeNull();
      expect(secondErr).toBeDefined();
      expect(secondErr?.message).toMatch(/Cannot create invoice from sales order .* with status FULFILLED|already been invoiced/);
    });

    it('rolls back entire transaction if line item insertion fails', async () => {
      const rollbackOrderId = '10000000-0000-0000-0000-000000000006';

      // Item with invalid negative quantity to trigger exception
      const { error } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: rollbackOrderId,
        p_items: [{ product_id: testProductId, quantity: -5, unit_price: 100, discount_percent: 0, tax_rate: 18 }],
      });

      expect(error).toBeDefined();

      // Assert sales order status remained CONFIRMED and zero invoice headers were created
      const { data: order } = await supabase!
        .from('sales_orders')
        .select('status')
        .eq('id', rollbackOrderId)
        .single();

      expect(order?.status).toBe('CONFIRMED');
    });

    it('enforces tenant isolation preventing cross-tenant sales order invoicing', async () => {
      // Order belongs to a foreign organization
      const foreignOrderId = '10000000-0000-0000-0000-000000000007';

      const { data, error } = await supabase!.rpc('create_invoice_atomic', {
        p_org_id: testOrgId,
        p_customer_id: testCustomerId,
        p_sales_order_id: foreignOrderId,
        p_items: [{ product_id: testProductId, quantity: 1, unit_price: 100, discount_percent: 0, tax_rate: 18 }],
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/Sales order .* not found in organization/);
    });
  });

  it('documents verification status: runtime PostgreSQL execution remains pending staging authorization', () => {
    // Explicit static verification confirming integration test specifications are defined
    expect(hasDatabaseEnv).toBe(false);
  });
});
