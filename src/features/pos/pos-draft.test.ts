import { describe, expect, it } from 'vitest';
import { buildPosOrderDraft, summarizePosCart, type PosCartLine } from './pos-draft';
import type { Product } from '@/types';

const ORG = 'org-a';
const product: Product = {
  id: 'product-1', organizationId: ORG, sku: 'WIRE-001', name: 'Copper Wire',
  brand: 'Atlas', category: 'Wires & Cables', uom: 'Nos', purchaseCost: 70,
  sellingPrice: 100, taxRate: 18, reorderThreshold: 10, currentStock: 3,
  isActive: true, createdAt: '', updatedAt: '',
};
const line = (quantity: number, override: Partial<Product> = {}, discountPercent = 0): PosCartLine => ({
  product: { ...product, ...override }, quantity, discountPercent,
});
const make = (lines: PosCartLine[]) => buildPosOrderDraft({
  organizationId: ORG, customerId: 'customer-1', orderDate: '2026-11-09',
  idempotencyKey: '93a54640-11bb-4390-84ad-1084d4bc52a3', lines,
});

describe('Retail POS foundation — draft only', () => {
  it('saves one unit through the existing sales-order shape, never any receipt or movement', () => {
    const input = make([line(1)]);
    expect(input).toEqual({
      customerId: 'customer-1', orderDate: '2026-11-09',
      notes: undefined, idempotencyKey: '93a54640-11bb-4390-84ad-1084d4bc52a3',
      items: [{
        productId: 'product-1', productName: 'Copper Wire', productSku: 'WIRE-001',
        uom: 'Nos', quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18,
      }],
    });
    expect(input).not.toHaveProperty('payment');
    expect(input).not.toHaveProperty('invoice');
    expect(input).not.toHaveProperty('stockMovements');
  });

  it('supports bulk quantities and deterministic GST calculations', () => {
    const bulk = line(20, { sellingPrice: 24.50 }, 10);
    const totals = summarizePosCart([bulk]);
    expect(totals.grossSubtotal).toBe(490);
    expect(totals.lineDiscountTotal).toBe(49);
    expect(totals.taxAmount).toBe(79.38);
    expect(totals.totalAmount).toBe(520.38);
    expect(make([bulk]).items[0].quantity).toBe(20);
    // Cart quantity above last-seen stock remains a draft: confirmation checks stock authoritatively.
    expect(make([line(100)]).items[0].quantity).toBe(100);
  });

  it('rejects cross-tenant, inactive and duplicate product records', () => {
    expect(() => make([line(1, { organizationId: 'org-b' })])).toThrow('current business');
    expect(() => make([line(1, { isActive: false })])).toThrow('active products');
    expect(() => make([line(1), line(2)])).toThrow('only appear once');
  });

  it('rejects zero, negative, fractional, oversized and non-finite quantities', () => {
    for (const q of [0, -1, 1.5, 1000001, Infinity, NaN]) {
      expect(() => make([line(q)])).toThrow('whole numbers');
    }
  });

  it('rejects negative prices, indeterminate tax and invalid discounts', () => {
    expect(() => make([line(1, { sellingPrice: -0.01 })])).toThrow('Price');
    expect(() => make([line(1, { taxRate: NaN })])).toThrow('Price');
    expect(() => make([line(1, {}, 101)])).toThrow('Price');
    expect(() => make([line(1, {}, -1)])).toThrow('Price');
  });

  it('requires customer and valid business date and caps cart size at 50 lines', () => {
    expect(() => buildPosOrderDraft({ organizationId: ORG, customerId: '',
      orderDate: '2026-11-09', idempotencyKey: 'k', lines: [line(1)] })).toThrow('Select');
    expect(() => buildPosOrderDraft({ organizationId: ORG, customerId: 'c',
      orderDate: 'invalid', idempotencyKey: 'k', lines: [line(1)] })).toThrow('Select');
    expect(() => make([])).toThrow('1 to 50');
    expect(() => make(Array.from({ length: 51 }, (_, i) =>
      line(1, { id: `product-${i}` })))).toThrow('1 to 50');
  });
});
