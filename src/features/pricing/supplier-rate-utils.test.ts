import { describe, expect, it } from 'vitest';
import { parseSupplierRate, supplierRateChange } from './supplier-rate-utils';

describe('PR57 supplier quote validation and comparison', () => {
  it('accepts zero and two-decimal prices but rejects bad amounts', () => {
    expect(parseSupplierRate('1120.50')).toBe(1120.5);
    expect(parseSupplierRate('0')).toBe(0);
    expect(parseSupplierRate(' 1200 ')).toBe(1200);
    expect(() => parseSupplierRate('-10')).toThrow(/nonnegative/);
    expect(() => parseSupplierRate('12.999')).toThrow(/two decimals/);
    expect(() => parseSupplierRate('1e4')).toThrow(/nonnegative/);
    expect(() => parseSupplierRate('1,100')).toThrow(/nonnegative/);
    expect(() => parseSupplierRate('10000000000')).toThrow(/nonnegative/);
    expect(() => parseSupplierRate('')).toThrow(/nonnegative/);
  });

  it('compares prior supplier price without implying inventory or selling-price changes', () => {
    expect(supplierRateChange(1120, 1160)).toMatchObject({
      difference: 40, direction: 'increase', significant: false,
    });
    const increase = supplierRateChange(1000, 1120);
    expect(increase.percent).toBeCloseTo(12);
    expect(increase.significant).toBe(true);
    expect(supplierRateChange(1000, 900)).toMatchObject({
      difference: -100, percent: -10, direction: 'decrease', significant: true,
    });
    expect(supplierRateChange(1000, 1000).direction).toBe('unchanged');
    expect(supplierRateChange(null, 1200)).toMatchObject({
      difference: null, percent: null, direction: 'unknown', significant: false,
    });
    expect(supplierRateChange(0, 1200)).toMatchObject({
      difference: 1200, percent: null, significant: false,
    });
    expect(supplierRateChange(200, 210).significant).toBe(true);
    expect(supplierRateChange(200, 209.99).significant).toBe(false);
  });
});
