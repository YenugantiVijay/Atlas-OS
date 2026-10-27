import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Organization, Role, Membership, User } from '@/types';
import { storage } from '@/lib/storage';

/**
 * Multi-tenant organizational context and authorization state.
 *
 * SECURITY AUDIT NOTICE:
 * 1. Role derivation is strictly scoped to the active user's verified membership record
 *    (user_id === currentUser.id AND is_active === true).
 * 2. If the user does not have an active membership in the selected organization,
 *    `currentRole` evaluates strictly to `null` (deny-by-default).
 * 3. `isMockAuth` is explicitly exposed as `true` while the application operates in
 *    local-storage demo mode prior to Supabase Auth integration. Mock identities
 *    are never treated as cryptographically verified owners in database requests.
 */
interface OrgContextType {
  currentOrg: Organization | null;
  organizations: Organization[];
  currentRole: Role | null;
  currentUser: User;
  isMockAuth: boolean;
  switchOrganization: (orgId: string) => void;
  createOrganization: (data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>) => Organization;
  updateOrganization: (orgId: string, updates: Partial<Organization>) => Organization;
  updateCurrentUser: (updates: Partial<User>) => User;
  refreshOrgData: () => void;
  memberships: Membership[];
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentUser, setCurrentUser] = useState<User>(() => storage.getCurrentUser());

  // Explicit indicator that current auth identity is a local mock, not a verified Supabase JWT session
  const isMockAuth = true;

  const loadData = useCallback(() => {
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

      // SECURITY FIX: Never default to 'owner' or pick mems[0].
      // Strictly derive role matching the active user's specific membership record.
      const activeMembership = mems.find(
        (m) => m.userId === user.id && m.isActive
      );
      setCurrentRole(activeMembership ? activeMembership.role : null);
    } else {
      setMemberships([]);
      setCurrentRole(null);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const switchOrganization = (orgId: string) => {
    storage.setCurrentOrgId(orgId);
    loadData();
  };

  const createOrganization = (data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newOrg = storage.createOrganization(data);
    loadData();
    return newOrg;
  };

  const updateOrganization = (orgId: string, updates: Partial<Organization>) => {
    const updated = storage.updateOrganization(orgId, updates);
    loadData();
    return updated;
  };

  const updateCurrentUser = (updates: Partial<User>) => {
    const updated = storage.updateCurrentUser(updates);
    setCurrentUser(updated);
    loadData();
    return updated;
  };

  return (
    <OrgContext.Provider
      value={{
        currentOrg,
        organizations,
        currentRole,
        currentUser,
        isMockAuth,
        switchOrganization,
        createOrganization,
        updateOrganization,
        updateCurrentUser,
        refreshOrgData: loadData,
        memberships,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within an OrgProvider');
  return ctx;
};
