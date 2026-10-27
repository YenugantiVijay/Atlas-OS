import { Role } from '@/types';

export type Action =
  | 'org:manage'
  | 'members:manage'
  | 'audit:read'
  | 'products:create'
  | 'products:update'
  | 'products:delete'
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
    'inventory:adjust',
    'suppliers:manage',
    'data:read',
  ],
  accounts: [
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

export function getRoleBadgeVariant(role: Role | null | undefined): 'violet' | 'success' | 'warning' | 'info' | 'default' {
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
