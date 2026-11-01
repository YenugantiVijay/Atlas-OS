/**
 * PostgreSQL Database Integration Test Suite: Sprint 1 Inventory Integrity & Opening Stock Hardening
 *
 * NOTE & AUDIT DISCLAIMER:
 * In accordance with Phase safety boundaries, remote database operations,
 * remote SQL executions, and unapproved connections to staging/production
 * are STRICTLY PROHIBITED.
 *
 * This test suite defines the authoritative PostgreSQL integration contracts
 * for `public.stock_movements`, `public.record_stock_adjustment`, `public.confirm_sales_order`,
 * `public.create_product_atomic`, and `public.initialize_opening_stock` (Migrations 021 and 022).
 *
 * IMPORTANT:
 * When executed locally without a live PostgreSQL database connection, all live tests
 * in the skipped block below are SKIPPED. Skipped tests represent UNVERIFIED RUNTIME
 * BEHAVIOUR and must NOT be counted as passing database security checks.
 * Once staging database access is authorized and Migrations 021 & 022 applied, set
 * INTEGRATION_TEST_DB=true in the test environment to execute these tests live.
 */

import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

const hasDatabaseEnv = process.env.INTEGRATION_TEST_DB === 'true' && !!supabase;

describe('PostgreSQL Inventory Security & Negative Stock Integration Contracts (Migrations 021 & 022)', () => {
  describe.skipIf(!hasDatabaseEnv)(
    'Live PostgreSQL Inventory DML & Invariant Execution (UNVERIFIED RUNTIME BEHAVIOUR — Pending Staging Authorization)',
    () => {
      const testOrgId = '00000000-0000-0000-0000-000000000001';
      const foreignOrgId = '00000000-0000-0000-0000-000000000099';
      const testProductId = '00000000-0000-0000-0000-000000000002';
      const testProductZeroStockId = '00000000-0000-0000-0000-000000000003';

      // ========================================================================
      // Contract 1: Valid opening-stock creation
      // ========================================================================
      it('Contract 1: Creates valid opening stock via create_product_atomic and initialize_opening_stock', async () => {
        // 1A. Via create_product_atomic
        const { data: prodData, error: prodErr } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: 'CBL-LIVE-1',
          p_name: 'Live Integration Cable 1.5mm',
          p_category: 'Wires & Cables',
          p_uom: 'Coils',
          p_purchase_cost: 800,
          p_selling_price: 1100,
          p_tax_rate: 18,
          p_opening_stock: 50,
          p_notes: 'Initial opening stock contract test',
        });

        expect(prodErr).toBeNull();
        expect(prodData.id).toBeDefined();
        expect(prodData.current_stock).toBe(50);

        // Verify single OPENING_STOCK movement in stock_movements ledger
        const { data: movements, error: movErr } = await supabase!
          .from('stock_movements')
          .select('*')
          .eq('product_id', prodData.id)
          .eq('organization_id', testOrgId);

        expect(movErr).toBeNull();
        expect(movements).toHaveLength(1);
        expect(movements![0].movement_type).toBe('OPENING_STOCK');
        expect(Number(movements![0].quantity_change)).toBe(50);

        // 1B. Via initialize_opening_stock on existing zero-movement product
        const { data: initData, error: initErr } = await supabase!.rpc('initialize_opening_stock', {
          p_org_id: testOrgId,
          p_product_id: testProductZeroStockId,
          p_opening_stock: 30,
          p_notes: 'Initial opening stock on existing product',
        });

        expect(initErr).toBeNull();
        expect(initData.success).toBe(true);
        expect(initData.opening_stock).toBe(30);
      });

      // ========================================================================
      // Contract 2: Duplicate opening-stock initialization rejected
      // ========================================================================
      it('Contract 2: Rejects duplicate opening-stock initialization at engine and RPC level', async () => {
        // Attempt to call initialize_opening_stock on a product that already has stock movements
        const { data, error } = await supabase!.rpc('initialize_opening_stock', {
          p_org_id: testOrgId,
          p_product_id: testProductId, // Already initialized with opening stock
          p_opening_stock: 25,
          p_notes: 'Duplicate opening stock attempt',
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        // Rejected by check in initialize_opening_stock or trigger / partial unique index
        expect(error?.message).toMatch(/already has stock movement history|idx_stock_movements_unique_opening_stock/i);
      });

      // ========================================================================
      // Contract 3: Direct authenticated OPENING_STOCK inserts rejected
      // ========================================================================
      it('Contract 3: Rejects direct authenticated client INSERT of OPENING_STOCK via RLS / table privileges', async () => {
        const { data, error } = await supabase!
          .from('stock_movements')
          .insert({
            organization_id: testOrgId,
            product_id: testProductId,
            quantity_change: 25,
            movement_type: 'OPENING_STOCK',
            reference_type: 'INITIAL_STOCK',
            notes: 'Malicious direct opening stock injection',
          })
          .select();

        expect(data).toBeNull();
        expect(error).toBeDefined();
        // Denied by total RLS revocation (no INSERT policy) or privilege revocation
        expect(error?.message).toMatch(/violates row-level security policy|permission denied/i);
      });

      // ========================================================================
      // Contract 4: Unauthorized opening-stock RPC call rejected
      // ========================================================================
      it('Contract 4: Rejects opening-stock RPC invocation by unauthorized user or without operational entitlement', async () => {
        // Attempting to invoke create_product_atomic without required role or entitlement
        const { data, error } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: 'UNAUTH-SKU-01',
          p_name: 'Unauthorized Product',
          p_opening_stock: 10,
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/unauthorized|insufficient_privilege|operational write denied/i);
      });

      // ========================================================================
      // Contract 5: Cross-organization opening-stock creation rejected
      // ========================================================================
      it('Contract 5: Rejects opening-stock initialization for product belonging to another organization', async () => {
        // Caller tries to initialize opening stock for testProductId using foreignOrgId
        const { data, error } = await supabase!.rpc('initialize_opening_stock', {
          p_org_id: foreignOrgId,
          p_product_id: testProductId,
          p_opening_stock: 15,
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/Product .* not found in organization|insufficient_privilege|unauthorized/i);
      });

      // ========================================================================
      // Contract 6: Product creation with opening stock is atomic
      // ========================================================================
      it('Contract 6: Verifies product and opening stock are created in a single atomic transaction', async () => {
        const uniqueSku = `ATOMIC-${Date.now()}`;
        const { data: rpcRes, error: rpcErr } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: uniqueSku,
          p_name: 'Atomic Verified Switch',
          p_category: 'Switchgear',
          p_purchase_cost: 50,
          p_selling_price: 80,
          p_opening_stock: 100,
        });

        expect(rpcErr).toBeNull();
        const createdProdId = rpcRes.id;

        // Verify both product row and stock movement exist atomically
        const { data: prodRow } = await supabase!
          .from('products')
          .select('id, sku')
          .eq('id', createdProdId)
          .single();

        const { data: movRows } = await supabase!
          .from('stock_movements')
          .select('*')
          .eq('product_id', createdProdId);

        expect(prodRow?.sku).toBe(uniqueSku);
        expect(movRows).toHaveLength(1);
        expect(movRows![0].movement_type).toBe('OPENING_STOCK');
        expect(Number(movRows![0].quantity_change)).toBe(100);
      });

      // ========================================================================
      // Contract 7: Failure does not leave a partially created product
      // ========================================================================
      it('Contract 7: Ensures rollback on failure leaves zero orphaned product rows or movements', async () => {
        const failSku = `FAIL-SKU-${Date.now()}`;

        // Pass invalid negative opening stock to cause transaction abort in create_product_atomic
        const { data, error } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: failSku,
          p_name: 'Failing Product Rollback Test',
          p_purchase_cost: 10,
          p_selling_price: 20,
          p_opening_stock: -50, // Triggers exception
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/Opening stock cannot be negative/i);

        // Verify product was NOT persisted
        const { data: prodRow } = await supabase!
          .from('products')
          .select('id')
          .eq('organization_id', testOrgId)
          .eq('sku', failSku);

        expect(prodRow).toHaveLength(0);
      });

      // ========================================================================
      // Contract 8: Retry does not duplicate opening stock
      // ========================================================================
      it('Contract 8: Rejects retry of identical SKU, preventing duplicate opening stock', async () => {
        const testSku = `RETRY-SKU-${Date.now()}`;

        // First attempt succeeds
        const { data: firstRes, error: firstErr } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: testSku,
          p_name: 'Retry Safe Product',
          p_opening_stock: 40,
        });

        expect(firstErr).toBeNull();
        expect(firstRes.id).toBeDefined();

        // Second attempt with same SKU is rejected
        const { data: secondRes, error: secondErr } = await supabase!.rpc('create_product_atomic', {
          p_org_id: testOrgId,
          p_sku: testSku,
          p_name: 'Retry Safe Product',
          p_opening_stock: 40,
        });

        expect(secondRes).toBeNull();
        expect(secondErr).toBeDefined();
        expect(secondErr?.message).toMatch(/already exists/i);

        // Movements count remains exactly 1
        const { data: movements } = await supabase!
          .from('stock_movements')
          .select('*')
          .eq('product_id', firstRes.id);

        expect(movements).toHaveLength(1);
      });

      // ========================================================================
      // Contract 9: Concurrent opening-stock and adjustment preserve invariant
      // ========================================================================
      it('Contract 9: Serializes concurrent opening stock and adjustment via product row lock', async () => {
        // Run concurrent initialization and adjustment
        await Promise.allSettled([
          supabase!.rpc('initialize_opening_stock', {
            p_org_id: testOrgId,
            p_product_id: testProductZeroStockId,
            p_opening_stock: 20,
          }),
          supabase!.rpc('record_stock_adjustment', {
            p_org_id: testOrgId,
            p_product_id: testProductZeroStockId,
            p_quantity_change: -10,
            p_notes: 'Concurrent race adjustment',
          }),
        ]);

        // Row lock guarantees sequential processing:
        // Case A: init runs first -> adj succeeds (stock = 10)
        // Case B: adj runs first -> adj fails due to negative stock check (0 - 10 < 0), init succeeds (stock = 20)
        // In all cases, resulting stock can NEVER be negative!
        const { data: finalMovements } = await supabase!
          .from('stock_movements')
          .select('quantity_change')
          .eq('product_id', testProductZeroStockId);

        const totalStock = (finalMovements || []).reduce(
          (sum, m) => sum + Number(m.quantity_change),
          0
        );

        expect(totalStock).toBeGreaterThanOrEqual(0);
      });

      // ========================================================================
      // Contract 10: Concurrent sales deduction and adjustment preserve invariant
      // ========================================================================
      it('Contract 10: Prevents negative stock under concurrent sales confirmation and adjustment', async () => {
        // Product has known balance (e.g., 20 units).
        // Attempt concurrent sales confirmation for 15 units AND adjustment for -10 units (total demand = 25 > 20).
        await Promise.allSettled([
          supabase!.rpc('confirm_sales_order', {
            p_org_id: testOrgId,
            p_order_id: '00000000-0000-0000-0000-000000000010',
          }),
          supabase!.rpc('record_stock_adjustment', {
            p_org_id: testOrgId,
            p_product_id: testProductId,
            p_quantity_change: -10,
            p_notes: 'Concurrent race deduction',
          }),
        ]);

        // Exactly one or neither must succeed, but they must NOT both succeed if stock is insufficient
        const { data: movements } = await supabase!
          .from('stock_movements')
          .select('quantity_change')
          .eq('product_id', testProductId);

        const netStock = (movements || []).reduce(
          (sum, m) => sum + Number(m.quantity_change),
          0
        );

        expect(netStock).toBeGreaterThanOrEqual(0);
      });

      // ========================================================================
      // Contract 11: Rejects stock adjustment when mandatory idempotency key is missing
      // ========================================================================
      it('Contract 11: Rejects record_stock_adjustment when p_idempotency_key is NULL or missing', async () => {
        const { data, error } = await supabase!.rpc('record_stock_adjustment', {
          p_org_id: testOrgId,
          p_product_id: testProductId,
          p_quantity_change: 5,
          p_notes: 'Missing idempotency key test',
          p_idempotency_key: null,
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/Idempotency key is required for inventory adjustments/i);
      });
    }
  );
});
