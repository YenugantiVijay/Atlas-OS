import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  evaluateActionPermission,
  ActionPermissionContext,
} from './permissions';

describe('RBAC Permission Matrix', () => {
  it('grants owner full capabilities', () => {
    expect(hasPermission('owner', 'org:manage')).toBe(true);
    expect(hasPermission('owner', 'products:delete')).toBe(true);
    expect(hasPermission('owner', 'inventory:adjust')).toBe(true);
    expect(hasPermission('owner', 'orders:confirm')).toBe(true);
    expect(hasPermission('owner', 'invoices:issue')).toBe(true);
    expect(hasPermission('owner', 'payments:record')).toBe(true);
  });

  it('restricts sales role from adjusting inventory or deleting products', () => {
    expect(hasPermission('sales', 'orders:create')).toBe(true);
    expect(hasPermission('sales', 'quotations:create')).toBe(true);
    expect(hasPermission('sales', 'customers:manage')).toBe(true);

    expect(hasPermission('sales', 'inventory:adjust')).toBe(false);
    expect(hasPermission('sales', 'products:delete')).toBe(false);
    expect(hasPermission('sales', 'org:manage')).toBe(false);
  });

  it('allows inventory role to adjust stock but not issue invoices', () => {
    expect(hasPermission('inventory', 'inventory:adjust')).toBe(true);
    expect(hasPermission('inventory', 'products:create')).toBe(true);

    expect(hasPermission('inventory', 'invoices:issue')).toBe(false);
    expect(hasPermission('inventory', 'payments:record')).toBe(false);
  });

  it('allows accounts role to issue invoices and record payments', () => {
    expect(hasPermission('accounts', 'invoices:issue')).toBe(true);
    expect(hasPermission('accounts', 'payments:record')).toBe(true);
    expect(hasPermission('accounts', 'reports:financial')).toBe(true);

    expect(hasPermission('accounts', 'inventory:adjust')).toBe(false);
  });

  it('restricts viewer to read-only access', () => {
    expect(hasPermission('viewer', 'data:read')).toBe(true);
    expect(hasPermission('viewer', 'orders:create')).toBe(false);
    expect(hasPermission('viewer', 'payments:record')).toBe(false);
    expect(hasPermission('viewer', 'products:create')).toBe(false);
  });

  it('returns false for null or undefined roles', () => {
    expect(hasPermission(null, 'data:read')).toBe(false);
    expect(hasPermission(undefined, 'data:read')).toBe(false);
  });
});

describe('evaluateActionPermission Lifecycle & Boundary Guarding', () => {
  const baseLiveContext: ActionPermissionContext = {
    role: 'owner',
    isAuthenticated: true,
    isDemoMode: false,
    currentOrg: { id: 'org-test-123', name: 'Standard Org' },
    canWriteOperations: true,
    eligibility: { status: 'approved' },
    subscription: {
      status: 'active',
      currentPeriodEndsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };

  it('permits authorized owner in active live cloud environment', () => {
    const result = evaluateActionPermission('orders:create', baseLiveContext);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('denies action when user role does not permit it (role_unauthorized)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      role: 'viewer',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('role_unauthorized');
    expect(result.message).toContain('Viewer');
    expect(result.message).toContain('create sales orders');
  });

  it('denies action for viewer even when in demo mode', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      isDemoMode: true,
      role: 'viewer',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('role_unauthorized');
  });

  it('allows owner in demo mode regardless of backend subscription', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      isDemoMode: true,
      subscription: null,
      eligibility: null,
      canWriteOperations: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('denies action when unauthenticated in live cloud (unauthenticated)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      isAuthenticated: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('unauthenticated');
    expect(result.message).toContain('must be signed in');
  });

  it('denies action when no organization is active (no_organization)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      currentOrg: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_organization');
    expect(result.message).toContain('select an active organization');
  });

  it('denies action when eligibility is not approved (eligibility_restricted)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      eligibility: { status: 'pending' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('eligibility_restricted');
    expect(result.message).toContain('eligibility is pending');
  });

  it('denies action when subscription trial is expired (subscription_restricted)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      subscription: {
        status: 'trialing',
        trialEndsAt: new Date(Date.now() - 60000).toISOString(),
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_restricted');
    expect(result.message).toContain('trial has expired');
  });

  it('denies action when operational write access is false fallback', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      canWriteOperations: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_restricted');
    expect(result.message).toBe('Write operations are disabled for your account');
  });
});
