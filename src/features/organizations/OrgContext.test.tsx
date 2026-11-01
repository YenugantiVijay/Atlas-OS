import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  OrgProvider,
  useOrg,
  mapDbOrg,
  isCreateOrgRpcResponse,
  CreateOrganizationRpcResponse,
  evaluateOperationalWriteAccess,
  mapDbEligibility,
  mapDbSubscription,
} from './OrgContext';
import { storage } from '@/lib/storage';

interface QueryMockInstance {
  then: (resolve: (val: unknown) => unknown, reject: (err: unknown) => unknown) => Promise<unknown>;
  select: (columns?: string) => QueryMockInstance;
  update: (payload: unknown) => QueryMockInstance;
  eq: (column: string, value: unknown) => QueryMockInstance;
  order: (column: string, options?: unknown) => QueryMockInstance;
  single: () => Promise<{ data: unknown; error: unknown }>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}

function createQueryMock(data: unknown = [], error: unknown = null): QueryMockInstance {
  const query: QueryMockInstance = {
    then(resolve, reject) {
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
    select: vi.fn().mockImplementation(() => query),
    update: vi.fn().mockImplementation(() => query),
    eq: vi.fn().mockImplementation(() => query),
    order: vi.fn().mockImplementation(() => query),
    single: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error })
    ),
    maybeSingle: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error })
    ),
  };
  return query;
}

// Controlled Supabase mock
let mockRpcFn = vi.fn();
let mockFromFn = vi.fn();
let authStateCallback: ((event: string, session: any) => Promise<void> | void) | null = null;
let mockSignOutFn = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return {
      rpc: mockRpcFn,
      from: mockFromFn,
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              user: {
                id: 'user-test-uuid',
                email: 'owner@atlas.in',
                user_metadata: { full_name: 'Test Owner' },
              },
            },
          },
          error: null,
        }),
        onAuthStateChange: vi.fn().mockImplementation((cb) => {
          authStateCallback = cb;
          return {
            data: { subscription: { unsubscribe: vi.fn() } },
          };
        }),
        signOut: mockSignOutFn,
      },
    };
  },
  isSupabaseConfigured: () => true,
  validateSupabaseConfig: () => ({ valid: true }),
}));

describe('Phase 2.5: Hardened Organization Creation Contract & Auxiliary Row Confirmation', () => {
  const mockOrgRpc: CreateOrganizationRpcResponse = {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Sri Krishna Electrical Stores',
    legal_name: 'Sri Krishna Stores Pvt Ltd',
    gstin: '36ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    currency: 'INR',
    created_at: '2026-10-30T12:00:00Z',
    updated_at: '2026-10-30T12:00:00Z',
    idempotent_replay: false,
  };

  const mockDbMembership = {
    id: 'mem-verified-uuid-1',
    organization_id: '22222222-2222-2222-2222-222222222222',
    user_id: 'user-test-uuid',
    role: 'owner',
    is_active: true,
    created_at: '2026-10-30T12:00:00Z',
  };

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    vi.clearAllMocks();

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'memberships') {
        return createQueryMock([mockDbMembership]);
      }
      if (table === 'organizations') {
        return createQueryMock([{ id: mockOrgRpc.id }]);
      }
      return createQueryMock([]);
    });
  });

  describe('Contract & Validation Utilities', () => {
    it('1. isCreateOrgRpcResponse validates conformant Migration 012 JSONB payloads', () => {
      const validPayload: CreateOrganizationRpcResponse = {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Venkata Electricals',
        legal_name: 'Venkata Electricals LLP',
        gstin: '37ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        currency: 'INR',
        created_at: '2026-10-30T10:00:00Z',
        updated_at: '2026-10-30T10:00:00Z',
        idempotent_replay: false,
      };

      expect(isCreateOrgRpcResponse(validPayload)).toBe(true);
    });

    it('2. isCreateOrgRpcResponse rejects scalar UUID strings (old defect) and malformed payloads', () => {
      expect(isCreateOrgRpcResponse('11111111-1111-1111-1111-111111111111')).toBe(false);
      expect(isCreateOrgRpcResponse(null)).toBe(false);
      expect(isCreateOrgRpcResponse(undefined)).toBe(false);
      expect(isCreateOrgRpcResponse({})).toBe(false);
      expect(isCreateOrgRpcResponse({ id: '111' })).toBe(false);
      expect(isCreateOrgRpcResponse({ id: '111', name: '' })).toBe(false);
    });

    it('3. mapDbOrg maps RPC JSONB response properties into typed Organization model', () => {
      const rpcPayload: CreateOrganizationRpcResponse = {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Balaji Electrical Agencies',
        legal_name: 'Balaji Agencies Pvt Ltd',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        currency: 'INR',
        phone: '+91 91234 56789',
        email: 'billing@balaji.in',
        address_line1: 'Industrial Area Phase 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        created_at: '2026-10-30T10:00:00Z',
        updated_at: '2026-10-30T10:00:00Z',
      };

      const mapped = mapDbOrg(rpcPayload);

      expect(mapped.id).toBe(rpcPayload.id);
      expect(mapped.name).toBe(rpcPayload.name);
      expect(mapped.legalName).toBe(rpcPayload.legal_name);
      expect(mapped.gstin).toBe(rpcPayload.gstin);
      expect(mapped.pan).toBe(rpcPayload.pan);
      expect(mapped.currency).toBe('INR');
      expect(mapped.phone).toBe('+91 91234 56789');
      expect(mapped.email).toBe('billing@balaji.in');
      expect(mapped.addressLine1).toBe('Industrial Area Phase 2');
      expect(mapped.city).toBe('Bengaluru');
      expect(mapped.state).toBe('Karnataka');
      expect(mapped.pincode).toBe('560001');
      expect(mapped.createdAt).toBe(rpcPayload.created_at);
      expect(mapped.updatedAt).toBe(rpcPayload.updated_at);
    });

    it('3b. mapDbEligibility maps database row to OrganizationEligibility model', () => {
      const dbRow = {
        organization_id: 'org-test-uuid',
        business_category: 'electrical_retail',
        sells_electrical_products: true,
        product_lines: ['Wires & Cables'],
        status: 'approved',
        rejection_reason: null,
        reviewer_notes: null,
        declared_at: '2026-10-31T10:00:00Z',
        declared_by: 'user-test-uuid',
        created_at: '2026-10-31T10:00:00Z',
        updated_at: '2026-10-31T10:00:00Z',
      };

      const mapped = mapDbEligibility(dbRow);
      expect(mapped.organizationId).toBe('org-test-uuid');
      expect(mapped.businessCategory).toBe('electrical_retail');
      expect(mapped.sellsElectricalProducts).toBe(true);
      expect(mapped.productLines).toEqual(['Wires & Cables']);
      expect(mapped.status).toBe('approved');
    });

    it('3c. mapDbSubscription maps database row to OrganizationSubscription model', () => {
      const dbRow = {
        organization_id: 'org-test-uuid',
        status: 'trialing',
        plan_tier: 'trial',
        trial_started_at: '2026-10-31T10:00:00Z',
        trial_ends_at: '2026-11-07T10:00:00Z',
        payment_method_entered: false,
        created_at: '2026-10-31T10:00:00Z',
        updated_at: '2026-10-31T10:00:00Z',
      };

      const mapped = mapDbSubscription(dbRow);
      expect(mapped.organizationId).toBe('org-test-uuid');
      expect(mapped.status).toBe('trialing');
      expect(mapped.planTier).toBe('trial');
      expect(mapped.trialStartedAt).toBe('2026-10-31T10:00:00Z');
      expect(mapped.trialEndsAt).toBe('2026-11-07T10:00:00Z');
      expect(mapped.paymentMethodEntered).toBe(false);
    });
  });

  describe('createOrganization Remote Flow & Verification', () => {
    it('4. Successful RPC creation retrieves and verifies database membership, sets role to owner and persists state', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: mockOrgRpc,
        error: null,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      let createdResult: any;
      await act(async () => {
        createdResult = await result.current.createOrganization({
          name: '  Sri Krishna Electrical Stores  ',
          legalName: 'Sri Krishna Stores Pvt Ltd',
          gstin: '36ABCDE1234F1Z5',
          pan: 'ABCDE1234F',
          currency: 'INR',
        });
      });

      expect(createdResult).toBeDefined();
      expect(createdResult.id).toBe(mockOrgRpc.id);
      expect(createdResult.name).toBe(mockOrgRpc.name);

      expect(mockFromFn).toHaveBeenCalledWith('memberships');
      expect(result.current.currentOrg?.id).toBe(createdResult.id);
      expect(result.current.currentRole).toBe('owner');

      const userMem = result.current.memberships.find(
        (m) => m.organizationId === createdResult.id
      );
      expect(userMem).toBeDefined();
      expect(userMem?.role).toBe('owner');
      expect(userMem?.id).toBe('mem-verified-uuid-1');

      expect(localStorage.getItem('atlas_active_org_id_v2')).toBe(createdResult.id);
    });

    it('5. Throws meaningful error on malformed RPC response (rejects scalar UUID)', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: 'scalar-uuid-string-not-jsonb',
        error: null,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      await expect(
        act(async () => {
          await result.current.createOrganization({
            name: 'Faulty Response Org',
            currency: 'INR',
          });
        })
      ).rejects.toThrow('Failed to create organization: Server returned an invalid or malformed response.');
    });

    it('6. Throws explicit error on RPC failure', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: null,
        error: { message: 'ERR_VALIDATION: Invalid GSTIN format' },
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      await expect(
        act(async () => {
          await result.current.createOrganization({
            name: 'Bad GSTIN Org',
            gstin: 'INVALID_GSTIN',
            currency: 'INR',
          });
        })
      ).rejects.toThrow('Failed to create organization remotely: ERR_VALIDATION: Invalid GSTIN format');
    });

    it('7. Membership Verification Failure: Throws error and refuses role/active selection if membership is missing from server', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: mockOrgRpc,
        error: null,
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') {
          return createQueryMock([]); // No membership row
        }
        return createQueryMock([]);
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      await expect(
        act(async () => {
          await result.current.createOrganization({
            name: 'Unverified Membership Org',
            currency: 'INR',
          });
        })
      ).rejects.toThrow(
        /server membership could not be confirmed\. Access denied\./
      );

      expect(result.current.currentRole).toBeNull();
      expect(result.current.currentOrg).toBeNull();
    });

    it('8. Membership Lookup Failure: Throws error naming the organization ID if membership query fails', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: mockOrgRpc,
        error: null,
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') {
          return createQueryMock([], { message: 'connection timeout' });
        }
        return createQueryMock([]);
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      await expect(
        act(async () => {
          await result.current.createOrganization({
            name: 'Failed Query Org',
            currency: 'INR',
          });
        })
      ).rejects.toThrow(/failed to verify server membership: connection timeout/);

      expect(result.current.currentRole).toBeNull();
    });

    it('9. Idempotency Key: Passes all 15 parameters to create_organization RPC and reuses attempt-scoped key', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: mockOrgRpc,
        error: null,
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      const attemptKey = 'fixed-client-uuid-1234';

      await act(async () => {
        await result.current.createOrganization({
          name: 'Power Grid Electricals',
          gstin: '33ABCDE1234F1Z5',
          pan: 'abcde1234f',
          currency: 'inr',
          idempotencyKey: attemptKey,
        });
      });

      expect(mockRpcFn).toHaveBeenCalledTimes(1);
      const [rpcName, rpcPayload] = mockRpcFn.mock.calls[0];

      expect(rpcName).toBe('create_organization');
      expect(rpcPayload).toEqual({
        p_name: 'Power Grid Electricals',
        p_legal_name: null,
        p_gstin: '33ABCDE1234F1Z5',
        p_pan: 'ABCDE1234F',
        p_currency: 'INR',
        p_phone: null,
        p_email: null,
        p_address_line1: null,
        p_city: null,
        p_state: null,
        p_pincode: null,
        p_business_category: 'electrical_retail',
        p_sells_electrical_products: true,
        p_product_lines: [],
        p_idempotency_key: attemptKey,
      });
    });

    it('10. Atomic Execution: Makes exactly one RPC call and executes zero client-side organizations UPDATE queries', async () => {
      const mockOrgWithAux: CreateOrganizationRpcResponse = {
        ...mockOrgRpc,
        phone: '+91 98765 43210',
        email: 'contact@krishna.in',
        address_line1: 'Market Road 14',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001',
      };

      mockRpcFn.mockResolvedValueOnce({
        data: mockOrgWithAux,
        error: null,
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') {
          return createQueryMock([mockDbMembership]);
        }
        return createQueryMock([]);
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Clear calls made during initial mount/loadRemoteData to isolate createOrganization verification
      mockFromFn.mockClear();
      mockRpcFn.mockClear();

      let created: any;
      await act(async () => {
        created = await result.current.createOrganization({
          name: 'Sri Krishna Electrical Stores',
          legalName: 'Sri Krishna Stores Pvt Ltd',
          gstin: '36ABCDE1234F1Z5',
          pan: 'ABCDE1234F',
          phone: '+91 98765 43210',
          email: 'contact@krishna.in',
          addressLine1: 'Market Road 14',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001',
          currency: 'INR',
        });
      });

      // Exactly ONE RPC call made with all 12 parameters
      expect(mockRpcFn).toHaveBeenCalledTimes(1);
      const [rpcName, rpcPayload] = mockRpcFn.mock.calls[0];
      expect(rpcName).toBe('create_organization');
      expect(rpcPayload.p_phone).toBe('+91 98765 43210');
      expect(rpcPayload.p_email).toBe('contact@krishna.in');
      expect(rpcPayload.p_address_line1).toBe('Market Road 14');
      expect(rpcPayload.p_city).toBe('Hyderabad');
      expect(rpcPayload.p_state).toBe('Telangana');
      expect(rpcPayload.p_pincode).toBe('500001');

      // CRITICAL: Zero client-side organizations UPDATE queries executed
      expect(mockFromFn).not.toHaveBeenCalledWith('organizations');
      // Membership verification query executed
      expect(mockFromFn).toHaveBeenCalledWith('memberships');

      // All attributes directly mapped from single authoritative RPC response
      expect(created.phone).toBe('+91 98765 43210');
      expect(created.email).toBe('contact@krishna.in');
      expect(created.addressLine1).toBe('Market Road 14');
      expect(created.city).toBe('Hyderabad');
      expect(created.state).toBe('Telangana');
      expect(created.pincode).toBe('500001');
      expect(result.current.currentRole).toBe('owner');
    });

    it('11. Idempotent Replay: Identical retry returns existing organization without duplicate memberships or extra queries', async () => {
      const replayOrgRpc: CreateOrganizationRpcResponse = {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Apex Electrical Wholesale',
        legal_name: null,
        gstin: null,
        pan: null,
        currency: 'INR',
        phone: '+91 99999 00000',
        email: null,
        address_line1: null,
        city: null,
        state: null,
        pincode: null,
        created_at: '2026-10-30T14:00:00Z',
        updated_at: '2026-10-30T14:00:00Z',
        idempotent_replay: true,
      };

      const replayMembership = {
        id: 'mem-replay-uuid',
        organization_id: '44444444-4444-4444-4444-444444444444',
        user_id: 'user-test-uuid',
        role: 'owner',
        is_active: true,
        created_at: '2026-10-30T14:00:00Z',
      };

      mockRpcFn.mockResolvedValueOnce({ data: replayOrgRpc, error: null });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') {
          return createQueryMock([replayMembership]);
        }
        return createQueryMock([]);
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Clear calls made during initial mount/loadRemoteData to isolate createOrganization verification
      mockFromFn.mockClear();
      mockRpcFn.mockClear();

      const retryKey = 'retry-attempt-key-999';

      let retryCreated: any;
      await act(async () => {
        retryCreated = await result.current.createOrganization({
          name: 'Apex Electrical Wholesale',
          phone: '+91 99999 00000',
          currency: 'INR',
          idempotencyKey: retryKey,
        });
      });

      expect(mockRpcFn).toHaveBeenCalledTimes(1);
      expect(mockFromFn).not.toHaveBeenCalledWith('organizations');
      expect(retryCreated.id).toBe(replayOrgRpc.id);
      expect(result.current.currentOrg?.id).toBe(replayOrgRpc.id);
      expect(result.current.currentRole).toBe('owner');
      expect(result.current.organizations.filter((o) => o.id === replayOrgRpc.id).length).toBe(1);
    });

    it('12. Idempotency Conflict: Changed persisted details with same idempotency key are rejected with error', async () => {
      mockRpcFn.mockResolvedValueOnce({
        data: null,
        error: {
          message: 'ERR_IDEMPOTENCY_CONFLICT: Idempotency key "conflicting-key" reused with different request payload',
        },
      });

      mockFromFn.mockImplementation(() => createQueryMock([]));

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Clear calls made during initial mount/loadRemoteData to isolate createOrganization verification
      mockFromFn.mockClear();
      mockRpcFn.mockClear();

      await expect(
        act(async () => {
          await result.current.createOrganization({
            name: 'Altered Payload Org',
            currency: 'INR',
            idempotencyKey: 'conflicting-key',
          });
        })
      ).rejects.toThrow(/ERR_IDEMPOTENCY_CONFLICT/);

      expect(result.current.currentRole).toBeNull();
      expect(mockFromFn).not.toHaveBeenCalledWith('organizations');
    });
  });

  describe('Part D: Operational Write Access & Eligibility Evaluation', () => {
    it('13. evaluateOperationalWriteAccess allows writes in demo mode regardless of role or eligibility', () => {
      expect(evaluateOperationalWriteAccess(null, null, null, true)).toBe(true);
      expect(
        evaluateOperationalWriteAccess(
          'viewer',
          {
            organizationId: 'org-1',
            businessCategory: 'other_unsupported',
            sellsElectricalProducts: false,
            productLines: [],
            status: 'rejected',
            declaredAt: '',
            declaredBy: '',
          },
          null,
          true
        )
      ).toBe(true);
    });

    it('14. Denies write access if user has no active role in the organization', () => {
      expect(
        evaluateOperationalWriteAccess(
          null,
          {
            organizationId: 'org-1',
            businessCategory: 'electrical_retail',
            sellsElectricalProducts: true,
            productLines: ['Wires & Cables'],
            status: 'approved',
            declaredAt: '',
            declaredBy: '',
          },
          {
            organizationId: 'org-1',
            status: 'trialing',
            planTier: 'trial',
            trialStartedAt: '',
            trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
            paymentMethodEntered: false,
          },
          false
        )
      ).toBe(false);
    });

    it('15. Denies write access if eligibility status is review_required or rejected', () => {
      const activeSubscription = {
        organizationId: 'org-1',
        status: 'trialing' as const,
        planTier: 'trial',
        trialStartedAt: '',
        trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
        paymentMethodEntered: false,
      };

      // review_required
      expect(
        evaluateOperationalWriteAccess(
          'owner',
          {
            organizationId: 'org-1',
            businessCategory: 'electrical_wholesale_distributor',
            sellsElectricalProducts: true,
            productLines: [],
            status: 'review_required',
            declaredAt: '',
            declaredBy: '',
          },
          activeSubscription,
          false
        )
      ).toBe(false);

      // rejected
      expect(
        evaluateOperationalWriteAccess(
          'owner',
          {
            organizationId: 'org-1',
            businessCategory: 'other_unsupported',
            sellsElectricalProducts: false,
            productLines: [],
            status: 'rejected',
            rejectionReason: 'Unsupported category',
            declaredAt: '',
            declaredBy: '',
          },
          activeSubscription,
          false
        )
      ).toBe(false);
    });

    it('16. Denies write access if 7-day trial has expired and no paid subscription exists', () => {
      const approvedEligibility = {
        organizationId: 'org-1',
        businessCategory: 'electrical_retail' as const,
        sellsElectricalProducts: true,
        productLines: ['Wires & Cables'],
        status: 'approved' as const,
        declaredAt: '',
        declaredBy: '',
      };

      const expiredTrial = {
        organizationId: 'org-1',
        status: 'trialing' as const,
        planTier: 'trial',
        trialStartedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        trialEndsAt: new Date(Date.now() - 3 * 86400000).toISOString(), // expired 3 days ago
        paymentMethodEntered: false,
      };

      expect(
        evaluateOperationalWriteAccess('owner', approvedEligibility, expiredTrial, false)
      ).toBe(false);
    });

    it('17. Grants write access for active approved trial within 7-day window', () => {
      const approvedEligibility = {
        organizationId: 'org-1',
        businessCategory: 'electrical_wholesale_distributor' as const,
        sellsElectricalProducts: true,
        productLines: ['Wires & Cables', 'Switches & Sockets'],
        status: 'approved' as const,
        declaredAt: '',
        declaredBy: '',
      };

      const validTrial = {
        organizationId: 'org-1',
        status: 'trialing' as const,
        planTier: 'trial',
        trialStartedAt: new Date(Date.now() - 86400000).toISOString(),
        trialEndsAt: new Date(Date.now() + 6 * 86400000).toISOString(), // 6 days remaining
        paymentMethodEntered: false,
      };

      expect(
        evaluateOperationalWriteAccess('owner', approvedEligibility, validTrial, false)
      ).toBe(true);
      expect(
        evaluateOperationalWriteAccess('admin', approvedEligibility, validTrial, false)
      ).toBe(true);
      expect(
        evaluateOperationalWriteAccess('sales', approvedEligibility, validTrial, false)
      ).toBe(true);
    });

    it('18. Grants write access for active paid subscription with period dates', () => {
      const approvedEligibility = {
        organizationId: 'org-1',
        businessCategory: 'electrical_retail' as const,
        sellsElectricalProducts: true,
        productLines: ['LED Lighting'],
        status: 'approved' as const,
        declaredAt: '',
        declaredBy: '',
      };

      const activePaid = {
        organizationId: 'org-1',
        status: 'active' as const,
        planTier: 'pro',
        trialStartedAt: '',
        trialEndsAt: '',
        currentPeriodStartsAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        currentPeriodEndsAt: new Date(Date.now() + 20 * 86400000).toISOString(),
        paymentMethodEntered: true,
      };

      expect(
        evaluateOperationalWriteAccess('owner', approvedEligibility, activePaid, false)
      ).toBe(true);
    });
  });

  describe('Part A & B: Auth Race Conditions, Concurrency Guards & Data Bleed Prevention', () => {
    it('19. Immediately resets organization state when switching user accounts to prevent data bleed', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Simulate sign in with User 2
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') {
          return createQueryMock([]);
        }
        if (table === 'organizations') {
          return createQueryMock([]);
        }
        return createQueryMock([]);
      });

      await act(async () => {
        await result.current.refreshOrgData();
      });

      expect(result.current.organizations).toEqual([]);
      expect(result.current.currentOrg).toBeNull();
      expect(result.current.currentRole).toBeNull();
    });

    it('20. Deduplication: Second load event for same user reuses active in-flight promise without extra queries', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      let resolveOrgsQuery!: (val: unknown) => void;
      const orgsPromise = new Promise((res) => {
        resolveOrgsQuery = res;
      });

      let queryCallCount = 0;
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          queryCallCount++;
          const query = createQueryMock([]);
          query.then = (res, rej) => orgsPromise.then(res, rej);
          return query;
        }
        if (table === 'memberships') {
          return createQueryMock([mockDbMembership]);
        }
        return createQueryMock([]);
      });

      // Launch first refresh
      let firstRefresh!: Promise<void>;
      let secondRefresh!: Promise<void>;
      act(() => {
        firstRefresh = result.current.refreshOrgData();
        secondRefresh = result.current.refreshOrgData();
      });

      // Resolve the delayed query
      resolveOrgsQuery({
        data: [{ id: mockOrgRpc.id, name: 'Sri Krishna Electrical Stores', created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' }],
        error: null,
      });

      await act(async () => {
        await Promise.all([firstRefresh, secondRefresh]);
      });

      // Confirm organizations table was only queried once despite 2 concurrent refresh requests
      expect(queryCallCount).toBe(1);
      expect(result.current.organizations.length).toBe(1);
    });

    it('21. User switch: Immediately purges prior account data and discards late responses from previous user', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // User 1 has loaded orgs
      expect(result.current.organizations.length).toBeGreaterThan(0);

      let resolveSlowUser1Query!: (val: unknown) => void;
      const slowUser1Promise = new Promise((res) => {
        resolveSlowUser1Query = res;
      });

      // Trigger refresh for User 1 with the slow promise
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          const query = createQueryMock([]);
          query.then = (res, rej) => slowUser1Promise.then(res, rej);
          return query;
        }
        return createQueryMock([]);
      });

      // Start slow refresh for User 1
      let user1RefreshPromise!: Promise<void>;
      act(() => {
        user1RefreshPromise = result.current.refreshOrgData();
      });

      // User 2 signs in via auth state transition while User 1 is still in flight
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          return createQueryMock([
            {
              id: 'org-user-2-uuid',
              name: 'User 2 New Org',
              created_at: '2026-10-31T00:00:00Z',
              updated_at: '2026-10-31T00:00:00Z',
            },
          ]);
        }
        if (table === 'memberships') {
          return createQueryMock([
            {
              id: 'mem-user-2-uuid',
              organization_id: 'org-user-2-uuid',
              user_id: 'user-2-uuid',
              role: 'owner',
              is_active: true,
              created_at: '2026-10-31T00:00:00Z',
            },
          ]);
        }
        return createQueryMock([]);
      });

      await act(async () => {
        if (authStateCallback) {
          await authStateCallback('SIGNED_IN', {
            user: { id: 'user-2-uuid', email: 'user2@atlas.in' },
          });
        }
      });

      // User 2 state is now active
      expect(result.current.currentOrg?.id).toBe('org-user-2-uuid');

      // Now User 1's delayed response finally resolves with User 1's stale data
      resolveSlowUser1Query({
        data: [
          {
            id: 'stale-user-1-org',
            name: 'Stale User 1 Org',
            created_at: '2026-10-30T00:00:00Z',
            updated_at: '2026-10-30T00:00:00Z',
          },
        ],
        error: null,
      });

      await act(async () => {
        await user1RefreshPromise;
      });

      // Ensure User 1's stale response was discarded and User 2's data was NOT overwritten
      expect(result.current.currentOrg?.id).toBe('org-user-2-uuid');
      expect(result.current.organizations.map((o) => o.id)).toContain('org-user-2-uuid');
      expect(result.current.organizations.map((o) => o.id)).not.toContain('stale-user-1-org');
    });

    it('22. Logout: Immediately invalidates in-flight loads and prevents stale responses from setting state', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      let resolveSlowQuery!: (val: unknown) => void;
      const slowPromise = new Promise((res) => {
        resolveSlowQuery = res;
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          const query = createQueryMock([]);
          query.then = (res, rej) => slowPromise.then(res, rej);
          return query;
        }
        return createQueryMock([]);
      });

      // Start refresh while user is still logged in
      let inFlightRefresh!: Promise<void>;
      act(() => {
        inFlightRefresh = result.current.refreshOrgData();
      });
      expect(result.current.isLoadingOrgData).toBe(true);

      // User signs out while refresh is in flight
      await act(async () => {
        await result.current.signOut();
      });

      // State is immediately purged and loading indicator is cleared
      expect(result.current.organizations).toEqual([]);
      expect(result.current.currentOrg).toBeNull();
      expect(result.current.currentUser).toBeNull();
      expect(result.current.isLoadingOrgData).toBe(false);

      // Now delayed query finishes
      resolveSlowQuery({
        data: [
          {
            id: 'stale-org-post-logout',
            name: 'Stale Org Post Logout',
            created_at: '2026-10-30T00:00:00Z',
            updated_at: '2026-10-30T00:00:00Z',
          },
        ],
        error: null,
      });

      await act(async () => {
        await inFlightRefresh;
      });

      // Stale data was NOT written to state
      expect(result.current.organizations).toEqual([]);
      expect(result.current.currentOrg).toBeNull();
      expect(result.current.isLoadingOrgData).toBe(false);
    });

    it('23. Failure & Retry: Failed request clears in-flight ref and allows fresh retry to succeed', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Make query fail with database error
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          return createQueryMock(null, { message: 'connection timeout to db' });
        }
        return createQueryMock([]);
      });

      await act(async () => {
        await result.current.refreshOrgData();
      });

      // Error captured, loading finished
      expect(result.current.authError).toContain('connection timeout to db');
      expect(result.current.isLoadingOrgData).toBe(false);

      // Now backend recovers
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organizations') {
          return createQueryMock([
            {
              id: 'recovered-org-1',
              name: 'Recovered Electricals',
              created_at: '2026-10-31T00:00:00Z',
              updated_at: '2026-10-31T00:00:00Z',
            },
          ]);
        }
        if (table === 'memberships') {
          return createQueryMock([
            {
              id: 'mem-recovered-1',
              organization_id: 'recovered-org-1',
              user_id: 'user-test-uuid',
              role: 'owner',
              is_active: true,
              created_at: '2026-10-31T00:00:00Z',
            },
          ]);
        }
        return createQueryMock([]);
      });

      // Retry starts genuinely new request
      await act(async () => {
        await result.current.refreshOrgData();
      });

      // Verify retry succeeded
      expect(result.current.authError).toBeNull();
      expect(result.current.organizations.length).toBe(1);
      expect(result.current.organizations[0].name).toBe('Recovered Electricals');
      expect(result.current.currentOrg?.id).toBe('recovered-org-1');
    });
  });

  describe('Phase 4.9: Organization Switching Hardening & Hydration Error Recovery Suite', () => {
    const orgA = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Org A Bangalore Electricals',
      currency: 'INR',
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };
    const orgB = {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Org B Hyderabad Switchgear',
      currency: 'INR',
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };
    const orgC = {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Org C Chennai Cables',
      currency: 'INR',
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };

    const memA = {
      id: 'mem-a',
      organization_id: orgA.id,
      user_id: 'user-test-uuid',
      role: 'owner',
      is_active: true,
      created_at: '2026-10-30T10:00:00Z',
    };
    const memB = {
      id: 'mem-b',
      organization_id: orgB.id,
      user_id: 'user-test-uuid',
      role: 'admin',
      is_active: true,
      created_at: '2026-10-30T10:00:00Z',
    };
    const memC = {
      id: 'mem-c',
      organization_id: orgC.id,
      user_id: 'user-test-uuid',
      role: 'member',
      is_active: true,
      created_at: '2026-10-30T10:00:00Z',
    };

    const eligA = {
      organization_id: orgA.id,
      status: 'approved',
      category: 'electrical_distributor',
      sells_electrical: true,
      product_lines: ['Wires', 'Cables'],
      declared_at: '2026-10-30T10:00:00Z',
      reviewed_at: null,
      rejection_reason: null,
    };
    const eligB = {
      organization_id: orgB.id,
      status: 'approved',
      category: 'electrical_retailer',
      sells_electrical: true,
      product_lines: ['Switchgear'],
      declared_at: '2026-10-30T10:00:00Z',
      reviewed_at: null,
      rejection_reason: null,
    };
    const eligC = {
      organization_id: orgC.id,
      status: 'approved',
      category: 'electrical_panel_builder',
      sells_electrical: true,
      product_lines: ['Panels'],
      declared_at: '2026-10-30T10:00:00Z',
      reviewed_at: null,
      rejection_reason: null,
    };

    const subA = {
      organization_id: orgA.id,
      plan_tier: 'pro',
      status: 'active',
      trial_started_at: '2026-10-30T10:00:00Z',
      trial_ends_at: '2026-11-06T10:00:00Z',
      current_period_starts_at: '2026-10-30T10:00:00Z',
      current_period_ends_at: '2027-01-01T00:00:00Z',
      payment_method_entered: true,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };
    const subB = {
      organization_id: orgB.id,
      plan_tier: 'pro',
      status: 'active',
      trial_started_at: '2026-10-30T10:00:00Z',
      trial_ends_at: '2026-11-06T10:00:00Z',
      current_period_starts_at: '2026-10-30T10:00:00Z',
      current_period_ends_at: '2027-01-01T00:00:00Z',
      payment_method_entered: true,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };
    const subC = {
      organization_id: orgC.id,
      plan_tier: 'pro',
      status: 'active',
      trial_started_at: '2026-10-30T10:00:00Z',
      trial_ends_at: '2026-11-06T10:00:00Z',
      current_period_starts_at: '2026-10-30T10:00:00Z',
      current_period_ends_at: '2027-01-01T00:00:00Z',
      payment_method_entered: true,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
    };

    const makeFilterableMock = (rows: any[], error: any = null) => {
      let filtered = [...rows];
      const query: any = {
        select: vi.fn().mockImplementation(() => query),
        order: vi.fn().mockImplementation(() => query),
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          filtered = filtered.filter((r) => r[col] === val);
          return query;
        }),
        maybeSingle: vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: filtered[0] || null, error });
        }),
        single: vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: filtered[0] || null, error });
        }),
        then(resolve: any, reject: any) {
          return Promise.resolve({ data: filtered, error }).then(resolve, reject);
        },
      };
      return query;
    };

    it('24. Rapid A -> B -> C switching: Out-of-order responses from earlier switch (B) are discarded, newest selection (C) wins', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB, memC]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB, orgC]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligA, eligB, eligC]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subA, subB, subC]);
        return createQueryMock([]);
      });

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Initial state is Org A
      expect(result.current.currentOrg?.id).toBe(orgA.id);
      expect(result.current.eligibility?.organizationId).toBe(orgA.id);

      // Setup deferred slow promise for Org B queries
      let resolveSlowBQuery!: (val: unknown) => void;
      const slowBPromise = new Promise((res) => {
        resolveSlowBQuery = res;
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB, memC]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB, orgC]);
        if (table === 'organization_eligibility') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation((_col: string, val: any) => {
              if (val === orgB.id) {
                return {
                  maybeSingle: () => slowBPromise.then(() => ({ data: eligB, error: null })),
                };
              }
              if (val === orgC.id) {
                return {
                  maybeSingle: () => Promise.resolve({ data: eligC, error: null }),
                };
              }
              return { maybeSingle: () => Promise.resolve({ data: eligA, error: null }) };
            }),
          };
          return query;
        }
        if (table === 'organization_subscriptions') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation((_col: string, val: any) => {
              if (val === orgB.id) {
                return {
                  maybeSingle: () => slowBPromise.then(() => ({ data: subB, error: null })),
                };
              }
              if (val === orgC.id) {
                return {
                  maybeSingle: () => Promise.resolve({ data: subC, error: null }),
                };
              }
              return { maybeSingle: () => Promise.resolve({ data: subA, error: null }) };
            }),
          };
          return query;
        }
        return createQueryMock([]);
      });

      // 1. Initiate switch to B (slow)
      let switchBPromise!: Promise<void>;
      act(() => {
        switchBPromise = result.current.switchOrganization(orgB.id);
      });
      expect(result.current.isSwitchingOrg).toBe(true);

      // 2. Immediately initiate switch to C (fast) before B resolves
      let switchCPromise!: Promise<void>;
      act(() => {
        switchCPromise = result.current.switchOrganization(orgC.id);
      });

      // C resolves immediately
      await act(async () => {
        await switchCPromise;
      });

      expect(result.current.currentOrg?.id).toBe(orgC.id);
      expect(result.current.eligibility?.organizationId).toBe(orgC.id);
      expect(result.current.subscription?.organizationId).toBe(orgC.id);
      expect(result.current.isSwitchingOrg).toBe(false);

      // 3. Now slow query for B resolves late
      resolveSlowBQuery(true);
      await act(async () => {
        await switchBPromise;
      });

      // Verify B's stale data was DISCARDED and C remains active!
      expect(result.current.currentOrg?.id).toBe(orgC.id);
      expect(result.current.eligibility?.organizationId).toBe(orgC.id);
      expect(result.current.subscription?.organizationId).toBe(orgC.id);
      expect(result.current.isSwitchingOrg).toBe(false);
    });

    it('25. Immediate clearing: Eligibility and subscription are purged synchronously upon switch initiation to prevent privilege bleed', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligA, eligB]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subA, subB]);
        return createQueryMock([]);
      });

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Org A is active with write operations allowed
      expect(result.current.currentOrg?.id).toBe(orgA.id);
      expect(result.current.eligibility?.organizationId).toBe(orgA.id);
      expect(result.current.canWriteOperations).toBe(true);

      // Set up deferred query for Org B
      let resolveBQuery!: (val: unknown) => void;
      const bPromise = new Promise((res) => {
        resolveBQuery = res;
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation((_col: string, _val: any) => ({
              maybeSingle: () => bPromise.then(() => ({ data: eligB, error: null })),
            })),
          };
          return query;
        }
        if (table === 'organization_subscriptions') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation((_col: string, _val: any) => ({
              maybeSingle: () => bPromise.then(() => ({ data: subB, error: null })),
            })),
          };
          return query;
        }
        return createQueryMock([]);
      });

      // Initiate switch to B without awaiting
      let inFlightSwitch!: Promise<void>;
      act(() => {
        inFlightSwitch = result.current.switchOrganization(orgB.id);
      });

      // Synchronously, prior eligibility & subscription are cleared immediately
      expect(result.current.isSwitchingOrg).toBe(true);
      expect(result.current.eligibility).toBeNull();
      expect(result.current.subscription).toBeNull();
      // Operational writes are guaranteed disabled during switch
      expect(result.current.canWriteOperations).toBe(false);

      // Resolve Org B queries
      resolveBQuery(true);
      await act(async () => {
        await inFlightSwitch;
      });

      // Once resolved, Org B's data is populated and writes re-evaluated
      expect(result.current.isSwitchingOrg).toBe(false);
      expect(result.current.eligibility?.organizationId).toBe(orgB.id);
      expect(result.current.subscription?.organizationId).toBe(orgB.id);
      expect(result.current.canWriteOperations).toBe(true);
    });

    it('26. Eligibility query error: Retains selected org with write operations disabled, captures authError, and allows recovery via refreshOrgData', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligA, eligB]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subA, subB]);
        return createQueryMock([]);
      });

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Make organization_eligibility fail on switch
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'eligibility table locked' } }),
            })),
          };
          return query;
        }
        if (table === 'organization_subscriptions') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => Promise.resolve({ data: subB, error: null }),
            })),
          };
          return query;
        }
        return createQueryMock([]);
      });

      await act(async () => {
        await result.current.switchOrganization(orgB.id);
      });

      // Error captured, currentOrg retained, write access strictly disabled
      expect(result.current.currentOrg?.id).toBe(orgB.id);
      expect(result.current.authError).toContain('eligibility table locked');
      expect(result.current.eligibility).toBeNull();
      expect(result.current.subscription).toBeNull();
      expect(result.current.canWriteOperations).toBe(false);
      expect(result.current.isSwitchingOrg).toBe(false);

      // Now database recovers
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligB]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subB]);
        return createQueryMock([]);
      });

      await act(async () => {
        await result.current.refreshOrgData();
      });

      // Verification succeeded on retry
      expect(result.current.authError).toBeNull();
      expect(result.current.currentOrg?.id).toBe(orgB.id);
      expect(result.current.eligibility?.organizationId).toBe(orgB.id);
      expect(result.current.subscription?.organizationId).toBe(orgB.id);
      expect(result.current.canWriteOperations).toBe(true);
    });

    it('27. Subscription query error: Retains selected org with write operations disabled and captures error', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligA, eligB]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subA, subB]);
        return createQueryMock([]);
      });

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      // Make organization_subscriptions fail on switch
      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => Promise.resolve({ data: eligB, error: null }),
            })),
          };
          return query;
        }
        if (table === 'organization_subscriptions') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: 'subscription service unreachable' } }),
            })),
          };
          return query;
        }
        return createQueryMock([]);
      });

      await act(async () => {
        await result.current.switchOrganization(orgB.id);
      });

      expect(result.current.currentOrg?.id).toBe(orgB.id);
      expect(result.current.authError).toContain('subscription service unreachable');
      expect(result.current.subscription).toBeNull();
      expect(result.current.canWriteOperations).toBe(false);
      expect(result.current.isSwitchingOrg).toBe(false);
    });

    it('28. Logout during active organization switch: Purges state and drops pending switch response', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <OrgProvider>{children}</OrgProvider>
      );

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'memberships') return makeFilterableMock([memA, memB]);
        if (table === 'organizations') return makeFilterableMock([orgA, orgB]);
        if (table === 'organization_eligibility') return makeFilterableMock([eligA, eligB]);
        if (table === 'organization_subscriptions') return makeFilterableMock([subA, subB]);
        return createQueryMock([]);
      });

      const { result } = renderHook(() => useOrg(), { wrapper });
      await waitFor(() => expect(result.current.isLoadingAuth).toBe(false));

      let resolveSlowSwitchQuery!: (val: unknown) => void;
      const slowSwitchPromise = new Promise((res) => {
        resolveSlowSwitchQuery = res;
      });

      mockFromFn.mockImplementation((table: string) => {
        if (table === 'organization_eligibility') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => slowSwitchPromise.then(() => ({ data: eligB, error: null })),
            })),
          };
          return query;
        }
        if (table === 'organization_subscriptions') {
          const query: any = {
            select: vi.fn().mockImplementation(() => query),
            eq: vi.fn().mockImplementation(() => ({
              maybeSingle: () => slowSwitchPromise.then(() => ({ data: subB, error: null })),
            })),
          };
          return query;
        }
        return createQueryMock([]);
      });

      // Initiate switch
      let switchPromise!: Promise<void>;
      act(() => {
        switchPromise = result.current.switchOrganization(orgB.id);
      });
      expect(result.current.isSwitchingOrg).toBe(true);

      // Sign out while switch is in flight
      await act(async () => {
        await result.current.signOut();
      });

      expect(result.current.currentOrg).toBeNull();
      expect(result.current.organizations).toEqual([]);
      expect(result.current.isSwitchingOrg).toBe(false);

      // Delayed query finishes
      resolveSlowSwitchQuery(true);
      await act(async () => {
        await switchPromise;
      });

      // Stale switch response did NOT restore org
      expect(result.current.currentOrg).toBeNull();
      expect(result.current.organizations).toEqual([]);
      expect(result.current.isSwitchingOrg).toBe(false);
    });
  });
});
