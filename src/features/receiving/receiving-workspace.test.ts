import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import {
  receivingWorkspaceKey, readReceivingWorkspace, saveReceivingWorkspace,
  clearReceivingWorkspace, appendConfirmedProductToWorkspace,
  readReceivingProductForm, saveReceivingProductForm,
} from './receiving-workspace';

const user = 'test-user-a';
const org = 'test-organization-a';
const product: Product = {
  id: 'product-a', organizationId: org, name: 'Staging Item',
  sku: 'STG-GRN-001', category: 'Testing', uom: 'Nos',
  purchaseCost: 100, sellingPrice: 150, taxRate: 0,
  isActive: true, currentStock: 0, reorderThreshold: 10,
  createdAt: '', updatedAt: '',
};
const snapshot = () => ({
  receiptId: 'receipt-original', supplierId: 'supplier-a',
  invoice: 'STG-INV-001', date: '2026-11-11', notes: 'Truck arrived',
  rows: [{ product, packageText: '10x12', looseUnits: '2', unitCost: '100.00' }],
  mixedRows: [], savedState: 'NEW' as const, dirty: true,
  notebook: '', showNotebook: false,
});

describe('receiving worksheet navigation and tenant isolation', () => {
  beforeEach(() => sessionStorage.clear());

  it('restores every unsaved quantity, supplier, invoice and the same receipt UUID after remount', () => {
    saveReceivingWorkspace(user, org, snapshot());
    const saved = readReceivingWorkspace(user, org)!;
    expect(saved.receiptId).toBe('receipt-original');
    expect(saved.invoice).toBe('STG-INV-001');
    expect(saved.rows[0].packageText).toBe('10x12');
    expect(saved.rows[0].looseUnits).toBe('2');
    expect(saved.rows[0].unitCost).toBe('100.00');
    expect(saved.supplierId).toBe('supplier-a');
  });

  it('isolates worksheets by both authenticated user and organization', () => {
    saveReceivingWorkspace(user, org, snapshot());
    expect(readReceivingWorkspace('test-user-b', org)).toBeNull();
    expect(readReceivingWorkspace(user, 'org-b')).toBeNull();
    expect(receivingWorkspaceKey(user, org)).not.toBe(receivingWorkspaceKey(user, 'org-b'));
  });

  it('rejects corrupted, expired and cross-organization persisted rows', () => {
    sessionStorage.setItem(receivingWorkspaceKey(user, org), 'broken json');
    expect(readReceivingWorkspace(user, org)).toBeNull();
    saveReceivingWorkspace(user, org, { ...snapshot(), rows: [{ ...snapshot().rows[0], product: { ...product, organizationId: 'org-b' } }] });
    expect(readReceivingWorkspace(user, org)).toBeNull();
    sessionStorage.setItem(receivingWorkspaceKey(user, org), JSON.stringify({
      ...snapshot(), updatedAt: Date.now() - 9 * 24 * 60 * 60 * 1000,
    }));
    expect(readReceivingWorkspace(user, org)).toBeNull();
  });

  it('attaches only confirmed products to their original receipt, never a replaced one', () => {
    const initial = { ...snapshot(), rows: [] };
    saveReceivingWorkspace(user, org, initial);
    expect(appendConfirmedProductToWorkspace(user, org, 'different-receipt', product)).toBe(false);
    expect(readReceivingWorkspace(user, org)?.rows).toHaveLength(0);
    expect(appendConfirmedProductToWorkspace(user, org, 'receipt-original', product)).toBe(true);
    expect(appendConfirmedProductToWorkspace(user, org, 'receipt-original', product)).toBe(true);
    expect(readReceivingWorkspace(user, org)?.rows).toHaveLength(1);
    expect(readReceivingWorkspace(user, org)?.rows[0].product.currentStock).toBe(0);
    clearReceivingWorkspace(user, org);
    expect(readReceivingWorkspace(user, org)).toBeNull();
  });

  it('retains incomplete product fields across route transitions', () => {
    saveReceivingProductForm(user, org, { name: 'STAGING Item', sku: 'STG-GRN-001' });
    expect(readReceivingProductForm(user, org)?.sku).toBe('STG-GRN-001');
    expect(readReceivingProductForm('another-user', org)).toBeNull();
  });
});
