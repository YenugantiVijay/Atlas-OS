import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  OrgProvider,
  useOrg,
  mapDbOrg,
  isCreateOrgRpcResponse,
  CreateOrganizationRpcResponse,
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
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
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

    it('9. Idempotency Key: Passes all 12 parameters to create_organization RPC and reuses attempt-scoped key', async () => {
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
});
