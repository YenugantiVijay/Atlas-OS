import { describe, it, expect } from 'vitest';
import {
  organizationSchema,
  productSchema,
  customerSchema,
  paymentRecordSchema,
  stockAdjustmentSchema,
  validatePan,
  validateGstin,
  extractPanFromGstin,
  validateBusinessTaxIdentifiers,
  maskPan,
  maskGstin,
  PAN_EXCEPTION_REASONS,
} from './validation';

describe('Domain Input Validation Schemas', () => {
  it('validates correct Indian organization profile with valid GSTIN', () => {
    const validOrg = {
      name: 'Balaji Electricals',
      gstin: '29ABCDE1234F1Z5',
      phone: '+91 98450 12345',
      addressLine1: 'BVK Iyengar Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560053',
      currency: 'INR',
    };
    expect(organizationSchema.safeParse(validOrg).success).toBe(true);
  });

  it('rejects malformed GSTIN format', () => {
    const invalidOrg = {
      name: 'Balaji Electricals',
      gstin: 'INVALID_GSTIN_123',
      phone: '+91 98450 12345',
      addressLine1: 'BVK Iyengar Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      currency: 'INR',
    };
    expect(organizationSchema.safeParse(invalidOrg).success).toBe(false);
  });

  it('validates customer account schema', () => {
    const validCust = {
      name: 'Ramesh Kumar',
      companyName: 'Bangalore Electro Enterprises',
      phone: '+91 98860 11223',
      billingAddress: 'Peenya Industrial Area',
      gstin: '29AAAAA0000A1Z5',
      creditLimit: 200000,
      creditDays: 30,
    };
    expect(customerSchema.safeParse(validCust).success).toBe(true);
  });

  it('validates electrical product with valid SKU and numeric constraints', () => {
    const validProduct = {
      sku: 'HAV-MCB-32A',
      name: 'Havells 32A MCB DP',
      category: 'Switchgear',
      uom: 'Nos',
      purchaseCost: 450,
      sellingPrice: 650,
      taxRate: 18,
      reorderThreshold: 10,
    };
    expect(productSchema.safeParse(validProduct).success).toBe(true);
  });

  it('rejects product with negative pricing or tax rate > 40%', () => {
    const negativePrice = {
      sku: 'POL-W',
      name: 'Polycab Wire',
      category: 'Wires',
      uom: 'Coils',
      purchaseCost: -100,
      sellingPrice: 500,
      taxRate: 18,
      reorderThreshold: 5,
    };
    expect(productSchema.safeParse(negativePrice).success).toBe(false);

    const excessiveTax = {
      sku: 'POL-W',
      name: 'Polycab Wire',
      category: 'Wires',
      uom: 'Coils',
      purchaseCost: 100,
      sellingPrice: 500,
      taxRate: 75, // Exceeds Indian GST maximum
      reorderThreshold: 5,
    };
    expect(productSchema.safeParse(excessiveTax).success).toBe(false);
  });

  it('validates stock adjustment requiring non-zero quantity and audit note', () => {
    expect(
      stockAdjustmentSchema.safeParse({
        productId: 'prod-123',
        quantityChange: 15,
        notes: 'Physical cycle count update',
      }).success
    ).toBe(true);

    expect(
      stockAdjustmentSchema.safeParse({
        productId: 'prod-123',
        quantityChange: 0, // cannot be zero
        notes: 'Nothing changed',
      }).success
    ).toBe(false);
  });

  it('validates customer payment record requires positive amount', () => {
    expect(
      paymentRecordSchema.safeParse({
        customerId: 'cust-123',
        amount: 25000,
        paymentMethod: 'UPI',
        paymentDate: '2026-02-25',
      }).success
    ).toBe(true);

    expect(
      paymentRecordSchema.safeParse({
        customerId: 'cust-123',
        amount: 0,
        paymentMethod: 'UPI',
        paymentDate: '2026-02-25',
      }).success
    ).toBe(false);
  });

  describe('Business PAN and GSTIN Tax Validation Rules', () => {
    it('validates a properly formatted 10-character Indian PAN', () => {
      const result = validatePan('ABCDE1234F');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('ABCDE1234F');
    });

    it('rejects invalid PAN formats', () => {
      expect(validatePan('12345ABCDE').valid).toBe(false);
      expect(validatePan('ABCD12345F').valid).toBe(false);
      expect(validatePan('ABCDE1234').valid).toBe(false);
      expect(validatePan('ABCDE12345').valid).toBe(false);
      expect(validatePan('SHORT').valid).toBe(false);
    });

    it('handles empty PAN with required flag and legal exceptions', () => {
      // Empty optional PAN is valid
      expect(validatePan('').valid).toBe(true);
      expect(validatePan(null).valid).toBe(true);

      // Empty required PAN without exception fails
      expect(validatePan('', { required: true }).valid).toBe(false);

      // Empty required PAN with legal exception passes
      expect(validatePan('', { required: true, allowException: true }).valid).toBe(true);
    });

    it('validates standard 15-character Indian GSTIN', () => {
      const result = validateGstin('29ABCDE1234F1Z5');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('29ABCDE1234F1Z5');
    });

    it('rejects invalid GSTIN formats', () => {
      expect(validateGstin('29ABCDE1234F1Z').valid).toBe(false);
      expect(validateGstin('ABCDE1234F1Z529').valid).toBe(false);
      expect(validateGstin('INVALID_GSTIN').valid).toBe(false);
    });

    it('extracts embedded PAN from GSTIN correctly', () => {
      expect(extractPanFromGstin('29ABCDE1234F1Z5')).toBe('ABCDE1234F');
      expect(extractPanFromGstin('07AAAAA0000A1Z5')).toBe('AAAAA0000A');
      expect(extractPanFromGstin('INVALID')).toBe(null);
      expect(extractPanFromGstin(null)).toBe(null);
    });

    it('validates matching GSTIN and PAN', () => {
      const result = validateBusinessTaxIdentifiers({
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
      });
      expect(result.valid).toBe(true);
      expect(result.derivedPan).toBe('ABCDE1234F');
      expect(result.effectivePan).toBe('ABCDE1234F');
    });

    it('fails when submitted PAN does not match embedded PAN in GSTIN', () => {
      const result = validateBusinessTaxIdentifiers({
        gstin: '29ABCDE1234F1Z5',
        pan: 'XYZAB9999K', // mismatch!
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match the PAN embedded within the GSTIN');
      expect(result.derivedPan).toBe('ABCDE1234F');
    });

    it('auto-derives effective PAN when only GSTIN is provided', () => {
      const result = validateBusinessTaxIdentifiers({
        gstin: '29ABCDE1234F1Z5',
      });
      expect(result.valid).toBe(true);
      expect(result.derivedPan).toBe('ABCDE1234F');
      expect(result.effectivePan).toBe('ABCDE1234F');
      expect(result.value?.pan).toBe('ABCDE1234F');
    });

    it('redacts PAN for secure application logging and error reporting', () => {
      expect(maskPan('ABCDE1234F')).toBe('XXXXX1234F');
      expect(maskPan('XYZAB9999K')).toBe('XXXXX9999K');
      expect(maskPan('')).toBe('');
      expect(maskPan('INVALID')).toBe('••••••••••');
    });

    it('redacts GSTIN for secure application logging and error reporting', () => {
      expect(maskGstin('29ABCDE1234F1Z5')).toBe('29XXXXX1234F1Z5');
      expect(maskGstin('')).toBe('');
      expect(maskGstin('INVALID')).toBe('•••••••••••••••');
    });

    it('rejects business tax validation when PAN is missing without documented exception', () => {
      const res = validateBusinessTaxIdentifiers({
        requirePan: true,
        allowException: false,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Valid Indian PAN is required for business registration.');
    });

    it('rejects business tax validation when allowException is true but reason or reference is missing', () => {
      const res1 = validateBusinessTaxIdentifiers({
        requirePan: true,
        allowException: true, // missing reason and reference
      });
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('Documented statutory exception reason and reference');

      const res2 = validateBusinessTaxIdentifiers({
        requirePan: true,
        allowException: true,
        exceptionReason: 'UNKNOWN_REASON',
        exceptionReference: 'REF123',
      });
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('Documented statutory exception reason and reference');
    });

    it('accepts documented statutory PAN exception when valid reason and reference are supplied', () => {
      const res = validateBusinessTaxIdentifiers({
        requirePan: true,
        allowException: true,
        exceptionReason: PAN_EXCEPTION_REASONS[0],
        exceptionReference: 'GOV-EXEMPT-ORDER-2026-99',
      });
      expect(res.valid).toBe(true);
      expect(res.isException).toBe(true);
      expect(res.exceptionReason).toBe('GOVERNMENT_EXEMPT_ENTITY');
      expect(res.exceptionReference).toBe('GOV-EXEMPT-ORDER-2026-99');
    });

    it('confirms customer schema does NOT require PAN for ordinary retail customers', () => {
      const retailCustomer = {
        name: 'Suresh Patel',
        phone: '+91 99001 22334',
        billingAddress: 'Main Road, Chickpet, Bangalore',
        creditLimit: 0,
        creditDays: 0,
      };
      // Must be completely valid without any PAN or GSTIN
      expect(customerSchema.safeParse(retailCustomer).success).toBe(true);
    });

    it('organizationSchema validates when GSTIN and PAN match', () => {
      const validOrg = {
        name: 'Balaji Electrical Agencies',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        phone: '+91 98450 12345',
        addressLine1: 'BVK Iyengar Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560053',
        currency: 'INR',
      };
      const parsed = organizationSchema.safeParse(validOrg);
      expect(parsed.success).toBe(true);
    });

    it('organizationSchema rejects when GSTIN and PAN mismatch', () => {
      const mismatchOrg = {
        name: 'Balaji Electrical Agencies',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ZZZZZ9999Z', // does not match ABCDE1234F
        phone: '+91 98450 12345',
        addressLine1: 'BVK Iyengar Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560053',
        currency: 'INR',
      };
      const parsed = organizationSchema.safeParse(mismatchOrg);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('does not match the PAN embedded within the GSTIN');
      }
    });
  });
});
