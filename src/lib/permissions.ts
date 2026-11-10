import { Role } from '@/types';

export type Action =
  | 'org:manage'
  | 'members:manage'
  | 'audit:read'
  | 'products:create'
  | 'products:update'
  | 'products:delete'
  | 'inventory:receive'
  | 'supplier-prices:read'
  | 'supplier-prices:record'
  | 'inventory:adjust'
  | 'customers:manage'
  | 'suppliers:manage'
  | 'quotations:create'
  | 'quotations:update'
  | 'orders:create'
  | 'orders:confirm'
  | 'orders:cancel'
  | 'invoices:create'
  | 'invoices:issue'
  | 'payments:record'
  | 'reports:financial'
  | 'data:read';

const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: [
    'org:manage',
    'members:manage',
    'audit:read',
    'products:create',
    'products:update',
    'products:delete',
    'inventory:receive',
    'supplier-prices:read',
    'supplier-prices:record',
    'inventory:adjust',
    'customers:manage',
    'suppliers:manage',
    'quotations:create',
    'quotations:update',
    'orders:create',
    'orders:confirm',
    'orders:cancel',
    'invoices:create',
    'invoices:issue',
    'payments:record',
    'reports:financial',
    'data:read',
  ],
  admin: [
    'members:manage',
    'audit:read',
    'products:create',
    'products:update',
    'inventory:receive',
    'supplier-prices:read',
    'supplier-prices:record',
    'inventory:adjust',
    'customers:manage',
    'suppliers:manage',
    'quotations:create',
    'quotations:update',
    'orders:create',
    'orders:confirm',
    'orders:cancel',
    'invoices:create',
    'invoices:issue',
    'payments:record',
    'reports:financial',
    'data:read',
  ],
  sales: [
    'customers:manage',
    'quotations:create',
    'quotations:update',
    'orders:create',
    'orders:confirm',
    'data:read',
  ],
  inventory: [
    'products:create',
    'products:update',
    'inventory:receive',
    'supplier-prices:read',
    'supplier-prices:record',
    'inventory:adjust',
    'suppliers:manage',
    'data:read',
  ],
  accounts: [
    'supplier-prices:read',
    'customers:manage',
    'invoices:create',
    'invoices:issue',
    'payments:record',
    'reports:financial',
    'data:read',
  ],
  viewer: [
    'data:read',
  ],
};

export function hasPermission(role: Role | undefined | null, action: Action): boolean {
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.includes(action) : false;
}

export function getRoleBadgeVariant(role: Role | null | undefined): 'violet' | 'indigo' | 'success' | 'warning' | 'info' | 'default' {
  if (!role) return 'default';
  switch (role) {
    case 'owner':
      return 'violet';
    case 'admin':
      return 'info';
    case 'sales':
      return 'success';
    case 'accounts':
      return 'warning';
    case 'inventory':
      return 'info';
    case 'viewer':
    default:
      return 'default';
  }
}

export const ACTION_DESCRIPTIONS: Record<Action, string> = {
  'org:manage': 'manage organization settings',
  'members:manage': 'manage team members and roles',
  'audit:read': 'view the system audit trail',
  'products:create': 'create products',
  'products:update': 'edit products',
  'products:delete': 'delete products',
  'inventory:receive': 'receive supplier stock',
  'supplier-prices:read': 'view supplier purchase-price history',
  'supplier-prices:record': 'record a supplier quoted purchase rate',
  'inventory:adjust': 'record stock adjustments',
  'customers:manage': 'create or edit customers',
  'suppliers:manage': 'create or edit suppliers',
  'quotations:create': 'create quotations',
  'quotations:update': 'edit quotations',
  'orders:create': 'create sales orders',
  'orders:confirm': 'confirm sales orders',
  'orders:cancel': 'cancel sales orders',
  'invoices:create': 'create tax invoices',
  'invoices:issue': 'issue tax invoices',
  'payments:record': 'record customer payments',
  'reports:financial': 'view financial reports',
  'data:read': 'read organization data',
};

export const READ_ONLY_ACTIONS: readonly Action[] = ['data:read', 'audit:read', 'reports:financial', 'supplier-prices:read'];

export function isReadOnlyAction(action: Action): boolean {
  return READ_ONLY_ACTIONS.includes(action);
}

export type PermissionDenialReason =
  | 'unauthenticated'
  | 'no_organization'
  | 'role_unauthorized'
  | 'verification_incomplete'
  | 'manual_review_pending'
  | 'eligibility_rejected'
  | 'trial_expired'
  | 'subscription_inactive'
  | 'verification_unavailable'
  | 'eligibility_restricted'
  | 'subscription_restricted';

export interface ActionPermissionContext {
  role: Role | null | undefined;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  currentOrg: { id: string; name?: string } | null | undefined;
  canWriteOperations: boolean;
  authError?: string | null;
  eligibility?: {
    status: string;
    rejectionReason?: string | null;
    reviewerNotes?: string | null;
  } | null;
  subscription?: {
    status: string;
    trialEndsAt?: string | null;
    currentPeriodEndsAt?: string | null;
    gracePeriodEndsAt?: string | null;
  } | null;
}

export interface ActionPermissionCheck {
  allowed: boolean;
  reason?: PermissionDenialReason;
  title?: string;
  message?: string;
  actionRoute?: string;
  actionLabel?: string;
}

export function evaluateActionPermission(
  action: Action,
  ctx: ActionPermissionContext
): ActionPermissionCheck {
  // 1. Role permission check (Applies in BOTH Demo Mode and Live Cloud Mode)
  if (!ctx.role || !hasPermission(ctx.role, action)) {
    const roleName = ctx.role ? ctx.role.charAt(0).toUpperCase() + ctx.role.slice(1) : 'Viewer';
    const actionDesc = ACTION_DESCRIPTIONS[action] || action;
    return {
      allowed: false,
      reason: 'role_unauthorized',
      title: 'Permission Denied',
      message: `Your current role (${roleName}) does not have permission to ${actionDesc}.`,
    };
  }

  // 2. Demo mode grants operational write capability if the user role permits it
  if (ctx.isDemoMode) {
    return { allowed: true };
  }

  // 3. Authentication check for Live Cloud
  if (!ctx.isAuthenticated) {
    return {
      allowed: false,
      reason: 'unauthenticated',
      title: 'Authentication Required',
      message: 'You must be signed in to perform this action.',
    };
  }

  // 4. Organization selection check
  if (!ctx.currentOrg) {
    return {
      allowed: false,
      reason: 'no_organization',
      title: 'Organization Required',
      message: 'Please select an active organization before creating records.',
    };
  }

  // 5. Decoupled Read vs Write: Read actions (data:read, audit:read, reports:financial)
  // are preserved even when trial expires or setup is incomplete, as long as business
  // is not rejected (matching Migration 014 can_read_organization_data SQL rule)
  if (isReadOnlyAction(action)) {
    if (ctx.eligibility?.status === 'rejected') {
      return {
        allowed: false,
        reason: 'eligibility_rejected',
        title: 'Business Eligibility Rejected',
        message:
          'Data access is restricted: ' +
          (ctx.eligibility.rejectionReason ||
            'Business eligibility declaration was rejected.'),
        actionRoute: '/settings',
        actionLabel: ctx.role === 'owner' ? 'Complete Verification' : 'View Business Status',
      };
    }
    return { allowed: true };
  }

  // 6. Verification availability check (service/connectivity error)
  if (ctx.authError) {
    return {
      allowed: false,
      reason: 'verification_unavailable',
      title: 'Verification Temporarily Unavailable',
      message: 'Operational write access is disabled: Unable to verify business status due to a connection or service error. Please retry.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  // 6. Business Eligibility check
  if (!ctx.eligibility) {
    return {
      allowed: false,
      reason: 'verification_incomplete',
      title: 'Business Verification Incomplete',
      message: 'Operational write access is disabled: Business verification is incomplete: Organization has not completed the mandatory business model declaration.',
      actionRoute: '/settings',
      actionLabel: ctx.role === 'owner' ? 'Complete Verification' : 'View Business Status',
    };
  }

  if (ctx.eligibility.status === 'review_required') {
    return {
      allowed: false,
      reason: 'manual_review_pending',
      title: 'Manual Review Pending',
      message: 'Operational write access is disabled: Business eligibility declaration is pending manual compliance review.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  if (ctx.eligibility.status === 'rejected') {
    return {
      allowed: false,
      reason: 'eligibility_rejected',
      title: 'Business Eligibility Rejected',
      message:
        'Operational write access is disabled: ' +
        (ctx.eligibility.rejectionReason ||
          'Business eligibility declaration was rejected. Operational write features are disabled.'),
      actionRoute: '/settings',
      actionLabel: ctx.role === 'owner' ? 'Complete Verification' : 'View Business Status',
    };
  }

  if (ctx.eligibility.status !== 'approved') {
    return {
      allowed: false,
      reason: 'verification_incomplete',
      title: 'Business Verification Incomplete',
      message: 'Operational write access is disabled: Organization business eligibility is pending or not approved.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  // 7. Subscription & Trial status check
  if (!ctx.subscription) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      title: 'Subscription Inactive',
      message: 'Operational write access is disabled: No active subscription found for this organization.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  const now = Date.now();
  if (ctx.subscription.status === 'trialing') {
    if (!ctx.subscription.trialEndsAt || now > new Date(ctx.subscription.trialEndsAt).getTime()) {
      return {
        allowed: false,
        reason: 'trial_expired',
        title: 'Trial Expired',
        message: 'Operational write access is disabled: 7-day trial has expired.',
        actionRoute: '/settings',
        actionLabel: 'View Business Status',
      };
    }
  } else if (ctx.subscription.status === 'active') {
    const endTimestamp = ctx.subscription.gracePeriodEndsAt || ctx.subscription.currentPeriodEndsAt;
    if (!endTimestamp || now > new Date(endTimestamp).getTime()) {
      return {
        allowed: false,
        reason: 'subscription_inactive',
        title: 'Subscription Inactive',
        message: 'Operational write access is disabled: Subscription period has ended.',
        actionRoute: '/settings',
        actionLabel: 'View Business Status',
      };
    }
  } else if (ctx.subscription.status === 'expired') {
    return {
      allowed: false,
      reason: 'trial_expired',
      title: 'Trial Expired',
      message: 'Operational write access is disabled: Subscription or trial has expired.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  } else {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      title: 'Subscription Inactive',
      message: 'Operational write access is disabled: Subscription is not active.',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  // 8. General operational writes guard fallback
  if (!ctx.canWriteOperations) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      title: 'Subscription Inactive',
      message: 'Write operations are disabled for your account',
      actionRoute: '/settings',
      actionLabel: 'View Business Status',
    };
  }

  return { allowed: true };
}

