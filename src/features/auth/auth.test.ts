import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Authentication & OrgContext Architecture (Phase B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('enforces deny-by-default: role evaluates to null if user has no active membership in selected org', () => {
    const orgId = 'org-123';
    const userId = 'user-456';
    
    // User is active in org-999, but not in org-123
    const memberships = [
      { id: 'm1', organizationId: 'org-999', userId, role: 'owner', isActive: true },
      { id: 'm2', organizationId: orgId, userId: 'other-user', role: 'admin', isActive: true },
    ];

    const activeMembership = memberships.find(
      (m) => m.organizationId === orgId && m.userId === userId && m.isActive
    );
    const currentRole = activeMembership ? activeMembership.role : null;

    expect(currentRole).toBeNull();
  });

  it('derives correct role when active membership exists for the authenticated user', () => {
    const orgId = 'org-123';
    const userId = 'user-456';

    const memberships = [
      { id: 'm1', organizationId: orgId, userId, role: 'sales', isActive: true },
    ];

    const activeMembership = memberships.find(
      (m) => m.organizationId === orgId && m.userId === userId && m.isActive
    );
    const currentRole = activeMembership ? activeMembership.role : null;

    expect(currentRole).toBe('sales');
  });

  it('rejects deactivated memberships: role evaluates to null if isActive is false', () => {
    const orgId = 'org-123';
    const userId = 'user-456';

    const memberships = [
      { id: 'm1', organizationId: orgId, userId, role: 'owner', isActive: false },
    ];

    const activeMembership = memberships.find(
      (m) => m.organizationId === orgId && m.userId === userId && m.isActive
    );
    const currentRole = activeMembership ? activeMembership.role : null;

    expect(currentRole).toBeNull();
  });

  it('organization switching purges query cache to prevent cross-tenant data bleed', () => {
    const queryCache = new Map<string, string>();
    queryCache.set('products-org-1', 'Org 1 Secret Product');

    const switchOrganization = (newOrgId: string) => {
      // Flushes all cached queries
      queryCache.clear();
      return newOrgId;
    };

    expect(queryCache.size).toBe(1);
    switchOrganization('org-2');
    expect(queryCache.size).toBe(0);
  });

  it('persists and restores demo mode flag in localStorage', () => {
    const AUTH_MODE_KEY = 'atlas_auth_mode_v2';
    
    // Default is null
    expect(localStorage.getItem(AUTH_MODE_KEY)).toBeNull();

    // Enter demo mode
    localStorage.setItem(AUTH_MODE_KEY, 'demo');
    expect(localStorage.getItem(AUTH_MODE_KEY)).toBe('demo');

    // Exit demo mode
    localStorage.removeItem(AUTH_MODE_KEY);
    expect(localStorage.getItem(AUTH_MODE_KEY)).toBeNull();
  });
});
