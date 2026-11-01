/**
 * PostgreSQL Database Integration Test Suite: Reliability & Security Hardening (Migration 020)
 *
 * NOTE & AUDIT DISCLAIMER:
 * In accordance with Phase safety boundaries, remote database operations,
 * remote SQL executions, and unapproved connections to staging/production
 * are STRICTLY PROHIBITED.
 *
 * This test suite defines the authoritative PostgreSQL integration contracts
 * for:
 * 1. `public.self_declare_organization_eligibility` server-side validation hardening (Migration 020)
 * 2. `public.create_organization` deterministic JSON serialization and idempotency hashing (Migration 020)
 *
 * IMPORTANT:
 * When executed locally without a live PostgreSQL database connection, all live tests
 * in the skipped block below are SKIPPED. Skipped tests represent UNVERIFIED RUNTIME
 * BEHAVIOUR and must NOT be counted as passing database security checks.
 * Once staging database access is authorized and Migration 020 applied, set
 * INTEGRATION_TEST_DB=true in the test environment to execute these tests live.
 */

import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

const hasDatabaseEnv = process.env.INTEGRATION_TEST_DB === 'true' && !!supabase;

describe('PostgreSQL Migration 020 Integration Contracts', () => {
  describe.skipIf(!hasDatabaseEnv)('Live PostgreSQL RPC Execution (UNVERIFIED RUNTIME BEHAVIOUR — Pending Staging Authorization)', () => {
    const testOrgId = '00000000-0000-0000-0000-000000000001';

    // =========================================================================
    // 1. self_declare_organization_eligibility Validation Hardening
    // =========================================================================
    describe('public.self_declare_organization_eligibility Validation Contracts', () => {
      it('rejects invocation with NULL business category with ERR_VALIDATION', async () => {
        const { data, error } = await supabase!.rpc('self_declare_organization_eligibility', {
          p_organization_id: testOrgId,
          p_category: null,
          p_sells_electrical: true,
          p_product_lines: ['Wires & Cables'],
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/ERR_VALIDATION.*business category is required/i);
      });

      it('rejects invocation with NULL electrical product declaration with ERR_VALIDATION', async () => {
        const { data, error } = await supabase!.rpc('self_declare_organization_eligibility', {
          p_organization_id: testOrgId,
          p_category: 'electrical_distributor',
          p_sells_electrical: null,
          p_product_lines: ['Wires & Cables'],
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/ERR_VALIDATION.*electrical products declaration is required/i);
      });

      it('rejects invocation with invalid/unknown business category', async () => {
        const { data, error } = await supabase!.rpc('self_declare_organization_eligibility', {
          p_organization_id: testOrgId,
          p_category: 'invalid_category_xyz',
          p_sells_electrical: true,
          p_product_lines: ['Wires & Cables'],
        });

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/ERR_VALIDATION.*invalid business category/i);
      });

      it('successfully processes valid declaration, sets status, and initializes trial subscription', async () => {
        const { data, error } = await supabase!.rpc('self_declare_organization_eligibility', {
          p_organization_id: testOrgId,
          p_category: 'electrical_distributor',
          p_sells_electrical: true,
          p_product_lines: ['Wires & Cables', 'Switchgear'],
        });

        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.status).toBe('approved');
        expect(data.organization_id).toBe(testOrgId);

        // Verify trial subscription row created
        const { data: subData, error: subError } = await supabase!
          .from('organization_subscriptions')
          .select('*')
          .eq('organization_id', testOrgId)
          .single();

        expect(subError).toBeNull();
        expect(subData.status).toBe('trialing');
      });
    });

    // =========================================================================
    // 2. create_organization Deterministic JSON Idempotency Fingerprinting
    // =========================================================================
    describe('public.create_organization Deterministic Serialization & Idempotency Contracts', () => {
      const idempotencyKey = 'idemp-test-contract-001';

      it('computes distinct fingerprints when product lines contain commas vs separate items', async () => {
        // Attempt A with single item containing comma
        const attemptA = {
          p_name: 'Alpha Electricals',
          p_idempotency_key: 'idemp-comma-test-a',
          p_business_category: 'electrical_distributor',
          p_sells_electrical: true,
          p_product_lines: ['Wires, Cables', 'Lighting'],
        };

        // Attempt B with separate items
        const attemptB = {
          p_name: 'Alpha Electricals',
          p_idempotency_key: 'idemp-comma-test-b',
          p_business_category: 'electrical_distributor',
          p_sells_electrical: true,
          p_product_lines: ['Wires', 'Cables', 'Lighting'],
        };

        const [resA, resB] = await Promise.all([
          supabase!.rpc('create_organization', attemptA),
          supabase!.rpc('create_organization', attemptB),
        ]);

        expect(resA.error).toBeNull();
        expect(resB.error).toBeNull();
        // Since structured JSON serialization is used, their fingerprints differ,
        // and they are treated as two distinct organizations rather than colliding
        expect(resA.data.id).not.toBe(resB.data.id);
      });

      it('replays existing organization on same idempotency key and identical payload', async () => {
        const payload = {
          p_name: 'Replay Test Electricals',
          p_idempotency_key: idempotencyKey,
          p_business_category: 'electrical_distributor',
          p_sells_electrical: true,
          p_product_lines: ['Industrial Switchgear'],
        };

        const res1 = await supabase!.rpc('create_organization', payload);
        expect(res1.error).toBeNull();
        expect(res1.data.idempotent_replay).toBe(false);

        const res2 = await supabase!.rpc('create_organization', payload);
        expect(res2.error).toBeNull();
        expect(res2.data.idempotent_replay).toBe(true);
        expect(res2.data.id).toBe(res1.data.id);
      });

      it('rejects conflicting payload with same idempotency key', async () => {
        const conflictingPayload = {
          p_name: 'Conflicting Name Electricals',
          p_idempotency_key: idempotencyKey,
          p_business_category: 'electrical_retailer',
          p_sells_electrical: true,
          p_product_lines: ['Conduits'],
        };

        const { data, error } = await supabase!.rpc('create_organization', conflictingPayload);

        expect(data).toBeNull();
        expect(error).toBeDefined();
        expect(error?.message).toMatch(/ERR_CONFLICT.*Idempotency key collision/i);
      });
    });
  });
});
