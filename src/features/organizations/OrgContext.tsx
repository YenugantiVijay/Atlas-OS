import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Organization, Role, Membership, User } from '@/types';
import { storage } from '@/lib/storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryClient } from '@/app/query-client';

export type CreateOrganizationInput = Omit<Organization, 'id' | 'createdAt' | 'updatedAt'> & {
  idempotencyKey?: string;
};

export interface OrgContextType {
  currentOrg: Organization | null;
  organizations: Organization[];
  currentRole: Role | null;
  currentUser: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isMockAuth: boolean;
  isDemoMode: boolean;
  isLoadingAuth: boolean;
  authError: string | null;
  switchOrganization: (orgId: string) => Promise<void>;
  createOrganization: (data: CreateOrganizationInput) => Promise<Organization>;
  updateOrganization: (orgId: string, updates: Partial<Organization>) => Promise<Organization>;
  updateCurrentUser: (updates: Partial<User>) => Promise<User>;
  refreshOrgData: () => Promise<void>;
  memberships: Membership[];
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string; sessionPresent: boolean }>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

const ACTIVE_ORG_STORAGE_KEY = 'atlas_active_org_id_v2';
const AUTH_MODE_STORAGE_KEY = 'atlas_auth_mode_v2';

export interface CreateOrganizationRpcParams {
  p_name: string;
  p_legal_name: string | null;
  p_gstin: string | null;
  p_pan: string | null;
  p_currency: string;
  p_phone: string | null;
  p_email: string | null;
  p_address_line1: string | null;
  p_city: string | null;
  p_state: string | null;
  p_pincode: string | null;
  p_idempotency_key: string | null;
}

export interface CreateOrganizationRpcResponse {
  id: string;
  name: string;
  legal_name?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  currency?: string | null;
  created_at: string;
  updated_at: string;
  idempotent_replay?: boolean;
}

export interface DbOrganizationRow {
  id: string;
  name: string;
  legal_name?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  currency?: string | null;
  logo_url?: string | null;
  created_at: string;
  updated_at: string;
}

export function isCreateOrgRpcResponse(data: unknown): data is CreateOrganizationRpcResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.updated_at === 'string'
  );
}

// Helper to map snake_case Postgres row or RPC JSONB to Organization interface
export function mapDbOrg(row: DbOrganizationRow | CreateOrganizationRpcResponse): Organization {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name || undefined,
    gstin: row.gstin || undefined,
    pan: row.pan || undefined,
    phone: ('phone' in row && row.phone) ? row.phone : undefined,
    email: ('email' in row && row.email) ? row.email : undefined,
    addressLine1: ('address_line1' in row && row.address_line1) ? row.address_line1 : undefined,
    city: ('city' in row && row.city) ? row.city : undefined,
    state: ('state' in row && row.state) ? row.state : undefined,
    pincode: ('pincode' in row && row.pincode) ? row.pincode : undefined,
    currency: row.currency || 'INR',
    logoUrl: ('logo_url' in row && row.logo_url) ? row.logo_url : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DbMembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

// Helper to map snake_case Postgres row to Membership interface
export function mapDbMembership(row: DbMembershipRow): Membership {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as Role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    return localStorage.getItem(AUTH_MODE_STORAGE_KEY) === 'demo';
  });

  const isMockAuth = isDemoMode;
  const isAuthenticated = Boolean(session && !isDemoMode);

  // Load organizations and active membership from remote Supabase
  const loadRemoteData = useCallback(async (activeSession: Session) => {
    if (!supabase) return;

    try {
      setAuthError(null);
      const authUser = activeSession.user;

      // 1. Set current user profile
      const userProfile: User = {
        id: authUser.id,
        email: authUser.email || '',
        fullName:
          authUser.user_metadata?.full_name ||
          authUser.user_metadata?.name ||
          authUser.email?.split('@')[0] ||
          'User',
        avatarUrl: authUser.user_metadata?.avatar_url || '',
      };
      setCurrentUser(userProfile);

      // 2. Query organizations authorized via RLS
      const { data: dbOrgs, error: orgsErr } = await supabase
        .from('organizations')
        .select('*');

      if (orgsErr) {
        throw new Error('Failed to load organizations: ' + orgsErr.message);
      }

      const orgList: Organization[] = (dbOrgs || []).map(mapDbOrg);
      setOrganizations(orgList);

      // 3. Query memberships for the current user
      const { data: dbMems, error: memsErr } = await supabase
        .from('memberships')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('is_active', true);

      if (memsErr) {
        throw new Error('Failed to load memberships: ' + memsErr.message);
      }

      const memList: Membership[] = (dbMems || []).map(mapDbMembership);
      setMemberships(memList);

      // 4. Derive active organization and server-verified role
      const savedOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
      const active =
        orgList.find((o) => o.id === savedOrgId) || orgList[0] || null;

      setCurrentOrg(active);

      if (active) {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, active.id);
        const matchMem = memList.find((m) => m.organizationId === active.id);
        // Server-enforced role: strictly deny-by-default if no active membership in this org
        setCurrentRole(matchMem ? matchMem.role : null);
      } else {
        localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
        setCurrentRole(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      setCurrentRole(null);
    }
  }, []);

  // Load offline demo data from storage.ts
  const loadDemoData = useCallback(() => {
    storage.initialize();
    const orgs = storage.getOrganizations();
    setOrganizations(orgs);

    const user = storage.getCurrentUser();
    setCurrentUser(user);

    const activeId = storage.getCurrentOrgId();
    const found = orgs.find((o) => o.id === activeId) || orgs[0] || null;
    setCurrentOrg(found);

    if (found) {
      const mems = storage.getMemberships(found.id);
      setMemberships(mems);

      const activeMem = mems.find(
        (m) => m.userId === user.id && m.isActive
      );
      setCurrentRole(activeMem ? activeMem.role : null);
    } else {
      setMemberships([]);
      setCurrentRole(null);
    }
  }, []);

  // Initialize session and listen for auth state transitions
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      setIsLoadingAuth(true);
      const isExplicitDemo = localStorage.getItem(AUTH_MODE_STORAGE_KEY) === 'demo';

      if (supabase && isSupabaseConfigured()) {
        try {
          const { data: { session: initialSession }, error } = await supabase.auth.getSession();
          if (error) {
            console.warn('Supabase getSession notice:', error.message);
          }

          if (isMounted) {
            if (initialSession) {
              setSession(initialSession);
              setIsDemoMode(false);
              localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
              await loadRemoteData(initialSession);
            } else if (isExplicitDemo) {
              setSession(null);
              setIsDemoMode(true);
              loadDemoData();
            } else {
              // Live Cloud Mode is the explicit production default!
              // Unauthenticated users will see the Cloud Gate with clear choices.
              setSession(null);
              setIsDemoMode(false);
              setCurrentOrg(null);
              setCurrentRole(null);
              setOrganizations([]);
              setMemberships([]);
              setCurrentUser(null);
            }
          }
        } catch (err: unknown) {
          if (isMounted) {
            setAuthError(err instanceof Error ? err.message : String(err));
            if (isExplicitDemo) {
              setIsDemoMode(true);
              loadDemoData();
            } else {
              setSession(null);
              setIsDemoMode(false);
            }
          }
        }
      } else {
        // Supabase client unconfigured in this environment
        if (isMounted) {
          if (isExplicitDemo) {
            setIsDemoMode(true);
            loadDemoData();
          } else {
            setIsDemoMode(false);
            setSession(null);
          }
        }
      }

      if (isMounted) {
        setIsLoadingAuth(false);
      }
    }

    initAuth();

    // Listen to real Supabase Auth events
    let subscription: { unsubscribe: () => void } | null = null;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
        if (!isMounted) return;

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          setIsDemoMode(false);
          localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
          // Invalidate React Query cache to prevent cross-account stale data
          queryClient.clear();
          if (newSession) {
            await loadRemoteData(newSession);
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null);
          setCurrentOrg(null);
          setCurrentRole(null);
          setOrganizations([]);
          setMemberships([]);
          setCurrentUser(null);
          localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
          localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
          // Purge all cached queries immediately upon logout
          queryClient.clear();
          // Never silently force demo mode; user lands on the Cloud Gate
          setIsDemoMode(false);
        }
      });
      subscription = data.subscription;
    }

    return () => {
      isMounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [loadRemoteData, loadDemoData]);

  // Organization Switching: Flushes query cache and derives new server-enforced role
  const switchOrganization = async (orgId: string) => {
    // Purge cached query data immediately to prevent cross-tenant data bleed
    queryClient.clear();

    if (isMockAuth) {
      // Demo mode switching
      storage.setCurrentOrgId(orgId);
      loadDemoData();
      return;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const targetOrg = organizations.find((o) => o.id === orgId);
    if (!targetOrg) {
      throw new Error('Access Denied: You do not belong to the requested organization.');
    }

    setCurrentOrg(targetOrg);
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, targetOrg.id);

    // Re-derive server-verified role for this specific organization
    const matchMem = memberships.find((m) => m.organizationId === targetOrg.id);
    setCurrentRole(matchMem ? matchMem.role : null);
  };

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    if (!supabase) {
      return { error: 'Supabase is not configured in this environment.' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: error.message };
      }

      if (data.session) {
        setSession(data.session);
        setIsDemoMode(false);
        localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
        queryClient.clear();
        await loadRemoteData(data.session);
      }

      return {};
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string
  ): Promise<{ error?: string; sessionPresent: boolean }> => {
    if (!supabase) {
      return { error: 'Supabase is not configured in this environment.', sessionPresent: false };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (error) {
        return { error: error.message, sessionPresent: false };
      }

      if (data.session) {
        setSession(data.session);
        setIsDemoMode(false);
        localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
        queryClient.clear();
        await loadRemoteData(data.session);
        return { sessionPresent: true };
      }

      return { sessionPresent: false };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err), sessionPresent: false };
    }
  };

  const signOut = async () => {
    if (supabase && session) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setCurrentOrg(null);
    setCurrentRole(null);
    setOrganizations([]);
    setMemberships([]);
    setCurrentUser(null);
    localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    queryClient.clear();
    setIsDemoMode(false);
  };

  const enterDemoMode = () => {
    setIsDemoMode(true);
    localStorage.setItem(AUTH_MODE_STORAGE_KEY, 'demo');
    queryClient.clear();
    loadDemoData();
  };

  const exitDemoMode = () => {
    setIsDemoMode(false);
    localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    queryClient.clear();
    if (session) {
      loadRemoteData(session);
    } else {
      setCurrentOrg(null);
      setCurrentRole(null);
      setOrganizations([]);
      setMemberships([]);
      setCurrentUser(null);
    }
  };

  const createOrganization = async (
    data: CreateOrganizationInput
  ): Promise<Organization> => {
    if (isMockAuth) {
      const newOrg = storage.createOrganization(data);
      loadDemoData();
      return newOrg;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // Reuse provided attempt-scoped idempotency key or generate fallback
    const idempotencyKey =
      data.idempotencyKey ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : null);

    // 1. Send all 12 supported entity and audit parameters to the atomic create_organization RPC (Migration 018)
    const rpcPayload: CreateOrganizationRpcParams = {
      p_name: data.name.trim(),
      p_legal_name: data.legalName?.trim() || null,
      p_gstin: data.gstin?.trim().toUpperCase() || null,
      p_pan: data.pan?.trim().toUpperCase() || null,
      p_currency: data.currency ? data.currency.trim().toUpperCase() : 'INR',
      p_phone: data.phone?.trim() || null,
      p_email: data.email?.trim() || null,
      p_address_line1: data.addressLine1?.trim() || null,
      p_city: data.city?.trim() || null,
      p_state: data.state?.trim() || null,
      p_pincode: data.pincode?.trim() || null,
      p_idempotency_key: idempotencyKey,
    };

    const { data: rawRpcData, error: rpcErr } = await supabase.rpc(
      'create_organization',
      rpcPayload
    );

    if (rpcErr) {
      throw new Error('Failed to create organization remotely: ' + rpcErr.message);
    }

    // Validate that the returned JSONB object conforms to expected structure
    if (!isCreateOrgRpcResponse(rawRpcData)) {
      throw new Error('Failed to create organization: Server returned an invalid or malformed response.');
    }

    const createdOrg = mapDbOrg(rawRpcData);

    // 2. Authenticated ownership and membership verification
    // Never assume owner role or fabricate membership records; query DB using authenticated client.
    let verifiedMembership: Membership | null = null;
    const authUserId = session?.user?.id;

    if (authUserId) {
      const { data: memberRows, error: memberErr } = await supabase
        .from('memberships')
        .select('*')
        .eq('organization_id', createdOrg.id)
        .eq('user_id', authUserId)
        .eq('is_active', true);

      if (memberErr) {
        throw new Error(
          `Organization created (${createdOrg.id}) but failed to verify server membership: ${memberErr.message}`
        );
      }

      if (!memberRows || memberRows.length === 0) {
        throw new Error(
          `Organization created (${createdOrg.id}) but server membership could not be confirmed. Access denied.`
        );
      }

      verifiedMembership = mapDbMembership(memberRows[0] as DbMembershipRow);
    } else {
      throw new Error(
        `Organization created (${createdOrg.id}) but caller has no active session to verify membership.`
      );
    }

    // 4. Update active organization and verified role only after confirmation
    localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, createdOrg.id);
    setCurrentOrg(createdOrg);
    setCurrentRole(verifiedMembership.role);
    // Purge cached query data immediately to prevent cross-tenant data bleed
    queryClient.clear();

    setOrganizations((prev) => {
      const exists = prev.some((o) => o.id === createdOrg.id);
      return exists
        ? prev.map((o) => (o.id === createdOrg.id ? createdOrg : o))
        : [...prev, createdOrg];
    });

    setMemberships((prev) => {
      const exists = prev.some((m) => m.id === verifiedMembership!.id);
      return exists
        ? prev.map((m) => (m.id === verifiedMembership!.id ? verifiedMembership! : m))
        : [...prev, verifiedMembership!];
    });

    return createdOrg;
  };

  const updateOrganization = async (
    orgId: string,
    updates: Partial<Organization>
  ): Promise<Organization> => {
    if (isMockAuth) {
      const updated = storage.updateOrganization(orgId, updates);
      loadDemoData();
      return updated;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const dbPayload: any = {};
    if (updates.name !== undefined) dbPayload.name = updates.name;
    if (updates.legalName !== undefined) dbPayload.legal_name = updates.legalName;
    if (updates.gstin !== undefined) dbPayload.gstin = updates.gstin;
    if (updates.pan !== undefined) dbPayload.pan = updates.pan;
    if (updates.phone !== undefined) dbPayload.phone = updates.phone;
    if (updates.email !== undefined) dbPayload.email = updates.email;
    if (updates.addressLine1 !== undefined) dbPayload.address_line1 = updates.addressLine1;
    if (updates.city !== undefined) dbPayload.city = updates.city;
    if (updates.state !== undefined) dbPayload.state = updates.state;
    if (updates.pincode !== undefined) dbPayload.pincode = updates.pincode;
    if (updates.currency !== undefined) dbPayload.currency = updates.currency;

    const { data: updatedRows, error } = await supabase
      .from('organizations')
      .update(dbPayload)
      .eq('id', orgId)
      .select();

    if (error) {
      throw new Error('Failed to update organization: ' + error.message);
    }

    if (!updatedRows || updatedRows.length === 0) {
      throw new Error('Organization update rejected by database authorization.');
    }

    if (session) {
      await loadRemoteData(session);
    }

    return mapDbOrg(updatedRows[0]);
  };

  const updateCurrentUser = async (updates: Partial<User>): Promise<User> => {
    if (isMockAuth) {
      const updated = storage.updateCurrentUser(updates);
      setCurrentUser(updated);
      loadDemoData();
      return updated;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // In Supabase Auth, update user metadata
    const { data: updatedAuth, error } = await supabase.auth.updateUser({
      data: {
        full_name: updates.fullName,
        avatar_url: updates.avatarUrl,
      },
    });

    if (error) {
      throw new Error('Failed to update profile: ' + error.message);
    }

    const updatedUser: User = {
      id: updatedAuth.user.id,
      email: updatedAuth.user.email || '',
      fullName: updates.fullName || currentUser?.fullName || '',
      avatarUrl: updates.avatarUrl || currentUser?.avatarUrl,
    };

    setCurrentUser(updatedUser);
    return updatedUser;
  };

  const refreshOrgData = async () => {
    if (!isMockAuth && session) {
      await loadRemoteData(session);
    } else {
      loadDemoData();
    }
  };

  return (
    <OrgContext.Provider
      value={{
        currentOrg,
        organizations,
        currentRole,
        currentUser,
        session,
        isAuthenticated,
        isMockAuth,
        isDemoMode,
        isLoadingAuth,
        authError,
        switchOrganization,
        createOrganization,
        updateOrganization,
        updateCurrentUser,
        refreshOrgData,
        memberships,
        signIn,
        signUp,
        signOut,
        enterDemoMode,
        exitDemoMode,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = (): OrgContextType => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within an OrgProvider');
  return ctx;
};
