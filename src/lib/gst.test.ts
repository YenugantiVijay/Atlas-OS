import { describe, it, expect } from 'vitest';
import {
  isValidGstin,
  getStateFromGstin,
  findMatchingIndianState,
  resolvePlaceOfSupply,
} from './gst';

describe('GST and Place of Supply Resolution', () => {
  it('validates genuine Indian GSTINs correctly', () => {
    expect(isValidGstin('29ABCDE1234F1Z5')).toBe(true);
    expect(isValidGstin('27AAAAA0000A1Z5')).toBe(true);
    expect(isValidGstin('36AABCA5678H1Z2')).toBe(true);
    expect(isValidGstin('INVALID_GSTIN')).toBe(false);
    expect(isValidGstin('')).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it('extracts state code and state name from GSTIN', () => {
    expect(getStateFromGstin('29ABCDE1234F1Z5')).toEqual({
      code: '29',
      name: 'Karnataka',
    });
    expect(getStateFromGstin('27AAAAA0000A1Z5')).toEqual({
      code: '27',
      name: 'Maharashtra',
    });
    expect(getStateFromGstin('36AABCA5678H1Z2')).toEqual({
      code: '36',
      name: 'Telangana',
    });
    expect(getStateFromGstin('99INVALID0000A1Z5')).toBe(null);
  });

  it('matches states from address strings accurately', () => {
    expect(findMatchingIndianState('123 BVK Iyengar Road, Bengaluru, Karnataka - 560053')).toEqual({
      code: '29',
      name: 'Karnataka',
    });
    expect(findMatchingIndianState('Shop 4, Lamington Road, Mumbai, Maharashtra 400007')).toEqual({
      code: '27',
      name: 'Maharashtra',
    });
    expect(findMatchingIndianState('No recognized state here, 560001')).toBe(null);
  });

  it('resolves Place of Supply from customer GSTIN with priority', () => {
    const res = resolvePlaceOfSupply({
      customer: {
        gstin: '27AAAAA0000A1Z5',
        billingAddress: 'BVK Iyengar Road, Bengaluru, Karnataka',
      },
      currentOrg: {
        state: 'Karnataka',
        gstin: '29ABCDE1234F1Z5',
      },
    });
    expect(res.isVerified).toBe(true);
    expect(res.stateCode).toBe('27');
    expect(res.placeOfSupply).toBe('Maharashtra');
    expect(res.source).toBe('customer_gstin');
  });

  it('resolves Place of Supply from customer address when unregistered', () => {
    const res = resolvePlaceOfSupply({
      customer: {
        gstin: null,
        billingAddress: '42 MG Road, Panaji, Goa 403001',
      },
      currentOrg: {
        state: 'Karnataka',
        gstin: '29ABCDE1234F1Z5',
      },
    });
    expect(res.isVerified).toBe(true);
    expect(res.stateCode).toBe('30');
    expect(res.placeOfSupply).toBe('Goa');
    expect(res.source).toBe('customer_address');
  });

  it('falls back to organization state for local unregistered customer without address', () => {
    const res = resolvePlaceOfSupply({
      customer: {
        gstin: null,
        billingAddress: null,
      },
      currentOrg: {
        state: 'Karnataka',
        gstin: '29ABCDE1234F1Z5',
      },
    });
    expect(res.isVerified).toBe(true);
    expect(res.stateCode).toBe('29');
    expect(res.placeOfSupply).toBe('Karnataka');
    expect(res.source).toBe('org_state');
  });

  it('fails safely with warning when neither customer nor organization state is available', () => {
    const res = resolvePlaceOfSupply({
      customer: {
        gstin: null,
        billingAddress: null,
      },
      currentOrg: {
        state: null,
        gstin: null,
      },
    });
    expect(res.isVerified).toBe(false);
    expect(res.placeOfSupply).toBe(null);
    expect(res.source).toBe('none');
    expect(res.warning).toBeDefined();
  });
});
