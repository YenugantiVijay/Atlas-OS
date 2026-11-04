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

  it('denies action when eligibility is missing (verification_incomplete)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      eligibility: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('verification_incomplete');
    expect(result.title).toBe('Business Verification Incomplete');
    expect(result.actionRoute).toBe('/settings');
    expect(result.actionLabel).toBe('Complete Verification');
  });

  it('denies action when eligibility requires manual review (manual_review_pending)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      eligibility: { status: 'review_required' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('manual_review_pending');
    expect(result.title).toBe('Manual Review Pending');
    expect(result.actionLabel).toBe('View Business Status');
  });

  it('denies action when eligibility was rejected (eligibility_rejected)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      eligibility: {
        status: 'rejected',
        rejectionReason: 'Unsupported business category.',
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('eligibility_rejected');
    expect(result.title).toBe('Business Eligibility Rejected');
    expect(result.message).toContain('Unsupported business category');
    expect(result.actionLabel).toBe('Complete Verification');
  });

  it('denies action when subscription trial is expired (trial_expired)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      subscription: {
        status: 'trialing',
        trialEndsAt: new Date(Date.now() - 60000).toISOString(),
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('trial_expired');
    expect(result.title).toBe('Trial Expired');
    expect(result.message).toContain('7-day trial has expired');
    expect(result.actionLabel).toBe('View Business Status');
  });

  it('denies action when subscription is missing or inactive (subscription_inactive)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      subscription: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
    expect(result.title).toBe('Subscription Inactive');
    expect(result.actionLabel).toBe('View Business Status');
  });

  it('denies action when verification service fails (verification_unavailable)', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      authError: 'Network error 503 Service Unavailable',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('verification_unavailable');
    expect(result.title).toBe('Verification Temporarily Unavailable');
    expect(result.actionLabel).toBe('View Business Status');
  });

  it('provides View Business Status actionLabel for non-owners when verification is incomplete', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      role: 'admin',
      eligibility: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('verification_incomplete');
    expect(result.actionLabel).toBe('View Business Status');
  });

  it('denies action when operational write access is false fallback', () => {
    const result = evaluateActionPermission('orders:create', {
      ...baseLiveContext,
      canWriteOperations: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
    expect(result.message).toBe('Write operations are disabled for your account');
  });
});
