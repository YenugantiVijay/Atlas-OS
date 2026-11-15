import { describe, it, expect } from 'vitest';
import {
  organizationSchema,
  productSchema,
  customerSchema,
  paymentRecordSchema,
  quotationFormSchema,
  salesOrderFormSchema,
  stockAdjustmentSchema,
  validatePan,
  validateGstin,
  extractPanFromGstin,
  validateBusinessTaxIdentifiers,
  maskPan,
  maskGstin,
  PAN_EXCEPTION_REASONS,
  parseStrictNumber,
  validateMoneyInput,
  validateTaxRateInput,
  validateQuantityInput,
  validateCreditDaysInput,
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

  it('preserves the currency default and the PAN mismatch error path', () => {
    const organization = {
      name: 'Balaji Electricals',
      gstin: '29ABCDE1234F1Z5',
      phone: '+91 98450 12345',
      addressLine1: 'BVK Iyengar Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      email: '',
    };
    expect(organizationSchema.parse(organization).currency).toBe('INR');
    const mismatched = organizationSchema.safeParse({ ...organization, pan: 'AAAAA1234A' });
    expect(mismatched.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['pan'], message: 'Provided PAN does not match the PAN embedded within the GSTIN.' }),
    ]));
  });

  it('preserves legacy product IDs and line-item validation on quotes and orders', () => {
    const item = {
      productId: '12345678-1234-1234-1234-123456789abc',
      productName: 'Wall Switch',
      productSku: 'SW-01',
      uom: 'Nos',
      quantity: 2,
      unitPrice: 25,
      discountPercent: 0,
      taxRate: 18,
    };
    const form = { customerId: 'customer-1', validUntil: '2026-11-30', orderDate: '2026-11-13', items: [item] };
    for (const schema of [quotationFormSchema, salesOrderFormSchema]) {
      expect(schema.safeParse(form).success).toBe(true);
      expect(schema.safeParse({ ...form, items: [] }).success).toBe(false);
      expect(schema.safeParse({ ...form, items: [{ ...item, productId: 'invalid' }] }).success).toBe(false);
      expect(schema.safeParse({ ...form, items: [{ ...item, quantity: 0 }] }).success).toBe(false);
    }
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

  describe('Strict Number and Form Input Validation', () => {
    describe('parseStrictNumber', () => {
      it('parses valid positive integer and float strings and numbers', () => {
        expect(parseStrictNumber('100')).toEqual({ valid: true, value: 100 });
        expect(parseStrictNumber('12.50')).toEqual({ valid: true, value: 12.5 });
        expect(parseStrictNumber(42)).toEqual({ valid: true, value: 42 });
        expect(parseStrictNumber(0)).toEqual({ valid: true, value: 0 });
        expect(parseStrictNumber('0')).toEqual({ valid: true, value: 0 });
        expect(parseStrictNumber('-15')).toEqual({ valid: true, value: -15 });
      });

      it('returns invalid for empty string, whitespace, null, or undefined when required', () => {
        expect(parseStrictNumber('', { fieldName: 'Amount', required: true }).valid).toBe(false);
        expect(parseStrictNumber('   ', { fieldName: 'Amount', required: true }).valid).toBe(false);
        expect(parseStrictNumber(null, { fieldName: 'Amount', required: true }).valid).toBe(false);
        expect(parseStrictNumber(undefined, { fieldName: 'Amount', required: true }).valid).toBe(false);
      });

      it('returns invalid for strings with letters, trailing non-digits, or multiple dots', () => {
        expect(parseStrictNumber('100abc').valid).toBe(false);
        expect(parseStrictNumber('abc').valid).toBe(false);
        expect(parseStrictNumber('12.34.56').valid).toBe(false);
        expect(parseStrictNumber('12,500').valid).toBe(false);
        expect(parseStrictNumber('NaN').valid).toBe(false);
        expect(parseStrictNumber('Infinity').valid).toBe(false);
      });

      it('returns invalid for numeric NaN and Infinity', () => {
        expect(parseStrictNumber(NaN).valid).toBe(false);
        expect(parseStrictNumber(Infinity).valid).toBe(false);
        expect(parseStrictNumber(-Infinity).valid).toBe(false);
      });
    });

    describe('validateMoneyInput', () => {
      it('validates valid money amounts including zero', () => {
        expect(validateMoneyInput('100', 'Selling Price')).toEqual({ valid: true, value: 100 });
        expect(validateMoneyInput('0', 'Credit Limit', { required: false, allowZero: true })).toEqual({ valid: true, value: 0 });
        expect(validateMoneyInput('1250.75', 'Amount')).toEqual({ valid: true, value: 1250.75 });
      });

      it('handles optional fields when empty or not required', () => {
        expect(validateMoneyInput('', 'Credit Limit', { required: false })).toEqual({ valid: true, value: undefined });
        expect(validateMoneyInput(undefined, 'Credit Limit', { required: false })).toEqual({ valid: true, value: undefined });
      });

      it('rejects empty input when required', () => {
        const res = validateMoneyInput('', 'Selling Price', { required: true });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Selling Price is required');
      });

      it('rejects negative values and invalid formatting', () => {
        const resNeg = validateMoneyInput('-50', 'Price');
        expect(resNeg.valid).toBe(false);
        expect(resNeg.error).toContain('cannot be less than 0');

        const resInvalid = validateMoneyInput('foo', 'Price');
        expect(resInvalid.valid).toBe(false);
        expect(resInvalid.error).toContain('must be a valid number');
      });

      it('rejects more than 2 decimal places', () => {
        const res = validateMoneyInput('10.999', 'Price');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('cannot exceed 2 decimal places');
      });

      it('rejects zero when allowZero is false', () => {
        const res = validateMoneyInput('0', 'Price', { allowZero: false });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('cannot be zero');
      });
    });

    describe('validateTaxRateInput', () => {
      it('validates statutory GST tax rates (0, 5, 12, 18, 28, 40)', () => {
        expect(validateTaxRateInput('18')).toEqual({ valid: true, value: 18 });
        expect(validateTaxRateInput('0')).toEqual({ valid: true, value: 0 });
        expect(validateTaxRateInput('28')).toEqual({ valid: true, value: 28 });
        expect(validateTaxRateInput(5)).toEqual({ valid: true, value: 5 });
      });

      it('rejects empty input when required', () => {
        expect(validateTaxRateInput('').valid).toBe(false);
      });

      it('rejects rates above 40% and negative rates', () => {
        expect(validateTaxRateInput('50').valid).toBe(false);
        expect(validateTaxRateInput('-5').valid).toBe(false);
      });
    });

    describe('validateQuantityInput', () => {
      it('validates positive integers for inventory/orders', () => {
        expect(validateQuantityInput('10', 'Quantity')).toEqual({ valid: true, value: 10 });
        expect(validateQuantityInput(5, 'Quantity')).toEqual({ valid: true, value: 5 });
      });

      it('allows negative values only when min allows it (e.g. stock adjustments)', () => {
        expect(validateQuantityInput('-5', 'Stock Adjustment', { min: -1000000 })).toEqual({ valid: true, value: -5 });
        expect(validateQuantityInput('-5', 'Order Quantity').valid).toBe(false);
      });

      it('rejects non-integers', () => {
        const res = validateQuantityInput('10.5', 'Quantity');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('must be a whole number');
      });

      it('rejects zero when default min is 1', () => {
        const res = validateQuantityInput('0', 'Quantity');
        expect(res.valid).toBe(false);
        expect(res.error).toContain('cannot be zero');
      });
    });

    describe('validateCreditDaysInput', () => {
      it('validates 0 to 180 integer days and defaults empty to 30', () => {
        expect(validateCreditDaysInput('30')).toEqual({ valid: true, value: 30 });
        expect(validateCreditDaysInput('0')).toEqual({ valid: true, value: 0 });
        expect(validateCreditDaysInput('')).toEqual({ valid: true, value: 30 });
      });

      it('rejects negative, non-integer, or >180 credit days', () => {
        expect(validateCreditDaysInput('-5').valid).toBe(false);
        expect(validateCreditDaysInput('200').valid).toBe(false);
        expect(validateCreditDaysInput('15.5').valid).toBe(false);
      });
    });
  });
});
