import { describe, expect, it } from 'vitest';
import { hasPermission, evaluateActionPermission } from './permissions';

const live = {
  isAuthenticated: true, isDemoMode: false,
  currentOrg: { id: '11111111-2222-4333-8444-555555555555', name: 'Test' },
  canWriteOperations: true,
  eligibility: { status: 'approved' },
  subscription: { status: 'active', currentPeriodEndsAt: '2099-01-01T00:00:00Z' },
};

describe('PR57 supplier price confidentiality',()=>{
  it('only owners, admins, inventory and accounts can review purchase rates',()=>{
    for(const role of ['owner','admin','inventory','accounts'] as const){
      expect(hasPermission(role,'supplier-prices:read')).toBe(true);
    }
    for(const role of ['sales','viewer'] as const){
      expect(hasPermission(role,'supplier-prices:read')).toBe(false);
    }
  });
  it('only owners, admins and inventory can manually record supplier quotes',()=>{
    for(const role of ['owner','admin','inventory'] as const){
      expect(hasPermission(role,'supplier-prices:record')).toBe(true);
    }
    for(const role of ['accounts','sales','viewer'] as const){
      expect(hasPermission(role,'supplier-prices:record')).toBe(false);
    }
  });
  it('preserves historical read access after an expired write entitlement',()=>{
    const historical = evaluateActionPermission('supplier-prices:read',{
      ...live, role:'accounts',canWriteOperations:false,
      subscription:{status:'expired'},
    });
    expect(historical.allowed).toBe(true);
    const blocked = evaluateActionPermission('supplier-prices:record',{
      ...live,role:'owner',canWriteOperations:false,
      subscription:{status:'expired'},
    });
    expect(blocked.allowed).toBe(false);
  });
  it('never permits sales to read cost history even in Demo Mode',()=>{
    expect(evaluateActionPermission('supplier-prices:read',{
      ...live,role:'sales',isDemoMode:true,
    }).allowed).toBe(false);
  });
});

it.each(['starter', 'professional', 'enterprise_network', 'trial', 'pro'])(
  'applies procurement write entitlements for %s without restricting history or invoicing',
  planTier => {
    const context = { ...live, role: 'owner' as const, subscription: { ...live.subscription, planTier } };
    expect(evaluateActionPermission('inventory:receive', context).allowed).toBe(planTier !== 'starter');
    expect(evaluateActionPermission('supplier-prices:record', context).allowed).toBe(planTier !== 'starter');
    expect(evaluateActionPermission('supplier-prices:read', context).allowed).toBe(true);
    expect(evaluateActionPermission('invoices:issue', context).allowed).toBe(true);
  },
);
