import { describe, it, expect } from 'vitest';
import { hasPermission } from './permissions';

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
