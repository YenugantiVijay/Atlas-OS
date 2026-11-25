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

  it('does not present a payload as complete when buyer location data is unavailable', () => {
    const customerWithoutAddress: Customer = {
      ...b2bCustomer,
      billingAddress: undefined,
      deliveryAddress: undefined,
    };
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, customerWithoutAddress, sampleInvoice);
    expect(res.eligible).toBe(null);
    expect(res.fieldsComplete).toBe(false);
    expect(res.payload).toBeUndefined();
    expect(res.missingFields).toContain('Buyer Address');
    expect(res.missingFields).toContain('Buyer Location (not available on the customer profile)');
    expect(res.missingFields).toContain('Buyer PIN Code (not available on the customer profile)');
  });

  it('detects missing PIN code when only city/location is present in buyer address', () => {
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, b2bCustomer, sampleInvoice);
    expect(res.eligible).toBe(null);
    expect(res.fieldsComplete).toBe(false);
    expect(res.payload).toBeUndefined();
    expect(res.missingFields).not.toContain('Buyer Location (not available on the customer profile)');
    expect(res.missingFields).toContain('Buyer PIN Code (not available on the customer profile)');
  });

  it('extracts buyer location and 6-digit PIN code to generate complete B2B NIC e-invoice payload', () => {
    const completeCustomer: Customer = {
      ...b2bCustomer,
      billingAddress: 'Plot 12, Banjara Hills, Hyderabad - 500034',
    };
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, completeCustomer, sampleInvoice);
    expect(res.eligible).toBe(null);
    expect(res.fieldsComplete).toBe(true);
    expect(res.missingFields).toHaveLength(0);
    expect(res.payload).toBeDefined();
    expect(res.payload?.BuyerDtls.Loc).toBe('Hyderabad');
    expect(res.payload?.BuyerDtls.Pin).toBe(500034);
    expect(res.payload?.ValDtls.TotInvVal).toBe(118000);
    expect(res.payload?.ValDtls.CgstVal).toBe(9000);
    expect(res.payload?.ValDtls.SgstVal).toBe(9000);
  });

  it('correctly marks B2C / unregistered sales as exempt from e-Invoicing under GST Rule 48(4)', () => {
    const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, b2cCustomer, sampleInvoice);
    expect(res.eligible).toBe(false);
    expect(res.fieldsComplete).toBe(false);
    expect(res.reason).toMatch(/buyer GSTIN is required/i);
    expect(res.missingFields[0]).toMatch(/exempt/i);
  });

  it('enforces statutory ₹50,000 threshold for E-Way Bill requirement', () => {
    // Under ₹50,000 consignment
    const lowValueInvoice: Invoice = {
      ...sampleInvoice,
      totalAmount: 35000,
    };

    const lowRes = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, lowValueInvoice);
    expect(lowRes.required).toBe(null);
    expect(lowRes.thresholdExceeded).toBe(false);

    const thresholdInvoice: Invoice = { ...sampleInvoice, totalAmount: 50000 };
    const thresholdRes = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, thresholdInvoice);
    expect(thresholdRes.required).toBe(null);
    expect(thresholdRes.thresholdExceeded).toBe(false);

    // High value consignment (₹1,18,000 >= ₹50,000 threshold)
    const highRes = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, sampleInvoice, {
      vehicleNo: 'TS09UB1234',
      distanceKm: 45,
    });
    expect(highRes.required).toBe(null);
    expect(highRes.thresholdExceeded).toBe(true);
    expect(highRes.fieldsComplete).toBe(true);
    expect(highRes.payload?.vehicleNo).toBe('TS09UB1234');
    expect(highRes.payload?.totalValue).toBe(118000);
    // Intra-state ₹18,000 tax split equally into ₹9,000 CGST and ₹9,000 SGST
    expect(highRes.payload?.cgstValue).toBe(9000);
    expect(highRes.payload?.sgstValue).toBe(9000);
    expect(highRes.payload?.igstValue).toBe(0);
  });

  it('splits odd-paise intra-state GST without 1-paisa drift', () => {
    // ₹105.00 taxable @ 5% GST = ₹5.25 total tax (odd paise).
    // Statutory rule: CGST = ₹2.62, SGST = ₹2.63, CGST + SGST = ₹5.25 exactly.
    const oddTaxInvoice: Invoice = {
      ...sampleInvoice,
      totalAmount: 55000,
      taxAmount: 5.25,
    };

    const res = indiaComplianceService.validateEWayBillReadiness(testOrg, b2bCustomer, oddTaxInvoice, {
      vehicleNo: 'TS09UB5678',
      distanceKm: 20,
    });
    expect(res.payload?.cgstValue).toBe(2.62);
    expect(res.payload?.sgstValue).toBe(2.63);
    expect(Number((res.payload!.cgstValue + res.payload!.sgstValue).toFixed(2))).toBe(5.25);
  });

  it('returns clean sandbox simulation status without calling live external servers', () => {
    const status = indiaComplianceService.getSandboxStatus(testOrg);
    expect(status.mode).toBe('SANDBOX_SIMULATION');
    expect(status.isReadyForTesting).toBe(true);
  });

  describe('P0-01 & P2-02: Discount reconciliation and statutory tax calculations', () => {
    const completeCustomer: Customer = {
      ...b2bCustomer,
      billingAddress: 'Plot 12, Banjara Hills, Hyderabad - 500034',
    };

    it('single-item invoice with line discount does not double-deduct discount in e-invoice TotInvVal', () => {
      // Item: ₹10,000 gross, 10% discount (₹1,000), Assessable = ₹9,000, 18% GST = ₹1,620 (₹810 CGST + ₹810 SGST).
      // Invoice total: 10,000 - 1,000 + 1,620 = ₹10,620.
      const discountedInvoice: Invoice = {
        ...sampleInvoice,
        id: 'inv-disc-01',
        invoiceNumber: 'INV/26-27/002',
        subtotal: 10000,
        discountAmount: 1000,
        taxAmount: 1620,
        totalAmount: 10620,
        items: [
          {
            id: 'item-d1',
            invoiceId: 'inv-disc-01',
            productId: 'prod-d1',
            productName: 'Commercial Cable 4 sq mm',
            productSku: 'CAB-4.0',
            hsnCode: '8544',
            quantity: 5,
            unitPrice: 2000,
            taxRate: 18,
            discountPercent: 10,
            lineSubtotal: 9000,
            lineTax: 1620,
            lineTotal: 10620,
            uom: 'Coils',
          },
        ],
      };

      const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, completeCustomer, discountedInvoice);
      expect(res.fieldsComplete).toBe(true);
      expect(res.payload).toBeDefined();

      const val = res.payload!.ValDtls;
      // Assessable value is net of line discount (₹9,000)
      expect(val.AssVal).toBe(9000);
      expect(val.CgstVal).toBe(810);
      expect(val.SgstVal).toBe(810);
      expect(val.IgstVal).toBe(0);
      // ValDtls.Disc must be 0 because line discounts are already subtracted in AssVal
      expect(val.Disc).toBe(0);
      // Crucial: TotInvVal must strictly match invoice.totalAmount (₹10,620), NOT under-report as ₹9,620
      expect(val.TotInvVal).toBe(discountedInvoice.totalAmount);
      expect(val.TotInvVal).toBe(10620);
      expect(res.payload?.ItemList[0]).toMatchObject({ Discount: 1000, AssAmt: 9000 });
    });

    it('multi-item invoice with varying discounts reconciles exactly with invoice.totalAmount', () => {
      // Customer in Bangalore (Karnataka - 29) -> Inter-state IGST
      const interstateCustomer: Customer = {
        ...completeCustomer,
        gstin: '29AAAAA0000A1Z5',
        billingAddress: 'MG Road, Bangalore, Karnataka - 560001',
      };

      // Item 1: 5 x ₹2,000 = ₹10,000, 10% disc = ₹1,000, Taxable = ₹9,000, 18% IGST = ₹1,620, Total = ₹10,620
      // Item 2: 2 x ₹5,000 = ₹10,000, 5% disc = ₹500, Taxable = ₹9,500, 12% IGST = ₹1,140, Total = ₹10,640
      // Combined Subtotal = ₹20,000, Total Discount = ₹1,500, Total Tax = ₹2,760, Total Amount = ₹21,260
      const multiItemInvoice: Invoice = {
        ...sampleInvoice,
        id: 'inv-disc-02',
        invoiceNumber: 'INV/26-27/003',
        subtotal: 20000,
        discountAmount: 1500,
        taxAmount: 2760,
        totalAmount: 21260,
        items: [
          {
            id: 'item-m1',
            invoiceId: 'inv-disc-02',
            productId: 'prod-m1',
            productName: 'Heavy Cable 10 sq mm',
            productSku: 'CAB-10.0',
            hsnCode: '8544',
            quantity: 5,
            unitPrice: 2000,
            taxRate: 18,
            discountPercent: 10,
            lineSubtotal: 9000,
            lineTax: 1620,
            lineTotal: 10620,
            uom: 'Coils',
          },
          {
            id: 'item-m2',
            invoiceId: 'inv-disc-02',
            productId: 'prod-m2',
            productName: 'Distribution Box 8 Way',
            productSku: 'DB-08',
            hsnCode: '8537',
            quantity: 2,
            unitPrice: 5000,
            taxRate: 12,
            discountPercent: 5,
            lineSubtotal: 9500,
            lineTax: 1140,
            lineTotal: 10640,
            uom: 'Nos',
          },
        ],
      };

      const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, interstateCustomer, multiItemInvoice);
      expect(res.fieldsComplete).toBe(true);
      expect(res.payload).toBeDefined();

      const val = res.payload!.ValDtls;
      expect(val.AssVal).toBe(18500);
      expect(val.IgstVal).toBe(2760);
      expect(val.CgstVal).toBe(0);
      expect(val.SgstVal).toBe(0);
      expect(val.Disc).toBe(0);
      expect(val.TotInvVal).toBe(multiItemInvoice.totalAmount);
      expect(val.TotInvVal).toBe(21260);
    });

    it('handles zero-discount and 0% GST (exempt) items with exact reconciliation', () => {
      // 10 units @ ₹500 = ₹5,000, 0% discount, 0% GST (exempt supply)
      const exemptInvoice: Invoice = {
        ...sampleInvoice,
        id: 'inv-exempt-01',
        invoiceNumber: 'INV/26-27/004',
        subtotal: 5000,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 5000,
        items: [
          {
            id: 'item-ex1',
            invoiceId: 'inv-exempt-01',
            productId: 'prod-ex1',
            productName: 'Agricultural Solar Wire (Exempt)',
            productSku: 'AGRI-01',
            hsnCode: '8544',
            quantity: 10,
            unitPrice: 500,
            taxRate: 0,
            discountPercent: 0,
            lineSubtotal: 5000,
            lineTax: 0,
            lineTotal: 5000,
            uom: 'Meters',
          },
        ],
      };

      const res = indiaComplianceService.validateEInvoiceReadiness(testOrg, completeCustomer, exemptInvoice);
      expect(res.fieldsComplete).toBe(true);
      expect(res.payload).toBeDefined();

      const val = res.payload!.ValDtls;
      expect(val.AssVal).toBe(5000);
      expect(val.CgstVal).toBe(0);
      expect(val.SgstVal).toBe(0);
      expect(val.IgstVal).toBe(0);
      expect(val.Disc).toBe(0);
      expect(val.TotInvVal).toBe(5000);
      expect(val.TotInvVal).toBe(exemptInvoice.totalAmount);
    });
  });
});
