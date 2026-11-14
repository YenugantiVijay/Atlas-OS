import { describe, it, expect } from 'vitest';
import { Organization, Customer, Invoice } from '@/types';
import { indiaComplianceService } from './india-compliance.service';

describe('Area 6: India Compliance — GST E-Invoice & E-Way Bill Readiness', () => {
  const testOrg: Organization = {
    id: 'org-test-gst-01',
    name: 'Sri Lakshmi Electricals',
    legalName: 'Sri Lakshmi Electricals',
    gstin: '36AAAAA0000A1Z5',
    addressLine1: 'Station Road',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const b2bCustomer: Customer = {
    id: 'cust-b2b-01',
    organizationId: testOrg.id,
    name: 'Telangana Power Contractors Pvt Ltd',
    gstin: '36BBBBB1111B1Z6',
    phone: '9848012345',
    billingAddress: 'Banjara Hills, Hyderabad',
    creditLimit: 200000,
    creditDays: 30,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const b2cCustomer: Customer = {
    id: 'cust-b2c-01',
    organizationId: testOrg.id,
    name: 'Walk-in Electrician Ramesh',
    phone: '9848099999',
    creditLimit: 0,
    creditDays: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleInvoice: Invoice = {
    id: 'inv-001',
    organizationId: testOrg.id,
    invoiceNumber: 'INV/26-27/001',
    customerId: b2bCustomer.id,
    invoiceDate: '2026-04-10',
    dueDate: '2026-05-10',
    status: 'ISSUED',
    subtotal: 100000,
    discountAmount: 0,
    taxAmount: 18000,
    totalAmount: 118000,
    totalPaid: 0,
    items: [
      {
        id: 'item-1',
        invoiceId: 'inv-001',
        productId: 'prod-1',
        productName: 'Polycab 2.5 sq mm FR Red Wire',
        productSku: 'POL-2.5',
        hsnCode: '8544',
        quantity: 50,
        unitPrice: 2000,
        taxRate: 18,
        discountPercent: 0,
        lineSubtotal: 100000,
        lineTax: 18000,
        lineTotal: 118000,
        uom: 'Coils',
      },
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  };

  it('validates and generates official NIC Schema v1.03 payload for B2B transactions', () => {
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, b2bCustomer, sampleInvoice);
    expect(res.eligible).toBe(true);
    expect(res.compliant).toBe(true);
    expect(res.missingFields.length).toBe(0);

    const payload = res.payload;
    expect(payload).toBeDefined();
    expect(payload?.Version).toBe('1.1');
    expect(payload?.TranDtls.SupTyp).toBe('B2B');
    expect(payload?.SellerDtls.Gstin).toBe(testOrg.gstin);
    expect(payload?.BuyerDtls.Gstin).toBe(b2bCustomer.gstin);
    expect(payload?.ItemList[0].HsnCd).toBe('8544');
    expect(payload?.ValDtls.TotInvVal).toBe(118000);
    // Intra-state split (Telangana to Telangana): CGST 9% and SGST 9%
    expect(payload?.ValDtls.CgstVal).toBe(9000);
    expect(payload?.ValDtls.SgstVal).toBe(9000);
    expect(payload?.ValDtls.IgstVal).toBe(0);
  });

  it('correctly marks B2C / unregistered sales as exempt from e-Invoicing under GST Rule 48(4)', () => {
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, b2cCustomer, sampleInvoice);
    expect(res.eligible).toBe(false);
    expect(res.compliant).toBe(false);
    expect(res.reason).toMatch(/B2C sale/i);
    expect(res.missingFields[0]).toMatch(/exempt/i);
  });

  it('enforces statutory ₹50,000 threshold for E-Way Bill requirement', () => {
    // Under ₹50,000 consignment
    const lowValueInvoice: Invoice = {
      ...sampleInvoice,
      totalAmount: 35000,
    };

    const lowRes = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, lowValueInvoice);
    expect(lowRes.required).toBe(false);
    expect(lowRes.thresholdExceeded).toBe(false);

    // High value consignment (₹1,18,000 >= ₹50,000 threshold)
    const highRes = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, sampleInvoice, {
      vehicleNo: 'TS09UB1234',
      distanceKm: 45,
    });
    expect(highRes.required).toBe(true);
    expect(highRes.thresholdExceeded).toBe(true);
    expect(highRes.compliant).toBe(true);
    expect(highRes.payload?.vehicleNo).toBe('TS09UB1234');
    expect(highRes.payload?.totalValue).toBe(118000);
  });

  it('returns clean sandbox simulation status without calling live external servers', () => {
    const status = indiaComplianceService.getSandboxStatus(testOrg);
    expect(status.mode).toBe('SANDBOX_SIMULATION');
    expect(status.isReadyForTesting).toBe(true);
  });
});
