import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Organization, Role, Membership, User } from '@/types';
import { storage } from '@/lib/storage';

interface OrgContextType {
  currentOrg: Organization | null;
  organizations: Organization[];
  currentRole: Role;
  currentUser: User;
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
  const [currentRole, setCurrentRole] = useState<Role>('owner');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentUser, setCurrentUser] = useState<User>(() => storage.getCurrentUser());

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
      setCurrentRole(mems[0]?.role || 'owner');
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
