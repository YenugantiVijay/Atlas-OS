import { describe, it, expect } from 'vitest';
import {
  organizationSchema,
  productSchema,
  customerSchema,
  paymentRecordSchema,
  stockAdjustmentSchema,
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
});
