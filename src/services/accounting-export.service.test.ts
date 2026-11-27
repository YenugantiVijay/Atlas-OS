import { describe, it, expect } from 'vitest';
import { Organization, Customer, Invoice } from '@/types';
import { accountingExportService } from './accounting-export.service';

describe('Area 6: India Ecosystem — Accounting Software Export (Tally Prime & BUSY)', () => {
  const testOrg: Organization = {
    id: 'org-acc-test-01',
    name: 'Sri Lakshmi Electricals',
    legalName: 'Sri Lakshmi Electricals',
    gstin: '36AAAAA0000A1Z5',
    addressLine1: 'Main Road',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const customers: Customer[] = [
    {
      id: 'cust-1',
      organizationId: testOrg.id,
      name: 'Balaji Electrical Works',
      gstin: '36BBBBB1111B1Z6',
      creditLimit: 50000,
      creditDays: 15,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const invoices: Invoice[] = [
    {
      id: 'inv-tally-1',
      organizationId: testOrg.id,
      invoiceNumber: 'SLE-26-001',
      customerId: 'cust-1',
      invoiceDate: '2026-04-15',
      dueDate: '2026-04-30',
      status: 'ISSUED',
      subtotal: 5000,
      discountAmount: 0,
      taxAmount: 900,
      gstJurisdiction: { placeOfSupplyCode: '36', sellerStateCode: '36' },
      totalAmount: 5900,
      totalPaid: 0,
      items: [
        {
          id: 'item-1',
          invoiceId: 'inv-tally-1',
          productId: 'prod-1',
          productName: '16A MCB',
          productSku: 'MCB-16',
          hsnCode: '8536',
          quantity: 25,
          unitPrice: 200,
          taxRate: 18,
          discountPercent: 0,
          lineSubtotal: 5000,
          lineTax: 900,
          lineTotal: 5900,
          uom: 'Nos',
        },
      ],
      createdAt: '2026-04-15T00:00:00Z',
      updatedAt: '2026-04-15T00:00:00Z',
    },
  ];

  it('generates valid Tally Prime XML envelope with debit/credit balance', () => {
    const xml = accountingExportService.exportSalesToTallyXml(testOrg, invoices, customers);

    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create">');
    expect(xml).toContain('<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>');
    expect(xml).toContain('<ISINVOICE>No</ISINVOICE>');
    expect(xml).toContain('<ISPARTYLEDGER>Yes</ISPARTYLEDGER>');
    expect(xml).toContain('<PARTYLEDGERNAME>Balaji Electrical Works</PARTYLEDGERNAME>');
    expect(xml).toContain('<VOUCHERNUMBER>SLE-26-001</VOUCHERNUMBER>');
    expect(xml).toContain('<LEDGERNAME>Sales Account</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output CGST</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output SGST</LEDGERNAME>');
    const ledgerAmounts = [...xml.matchAll(/<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>\s*(?:<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<ISLASTDEEMEDPOSITIVE>Yes<\/ISLASTDEEMEDPOSITIVE>\s*)?<AMOUNT>([^<]+)<\/AMOUNT>/g)]
      .map(([, side, amount]) => [side, amount]);
    expect(ledgerAmounts).toEqual([
      ['Yes', '-5900.00'], ['No', '5000.00'], ['No', '450.00'], ['No', '450.00'],
    ]);

  });

  it('rejects a one-paise unbalanced Tally voucher', () => {
    expect(() => accountingExportService.exportSalesToTallyXml(
      testOrg, [{ ...invoices[0], totalAmount: 5900.01 }], customers
    )).toThrow('totals do not reconcile');
  });

  it('uses the confirmed jurisdiction even when the buyer GSTIN is in the seller state', () => {
    const interstate = { ...invoices[0], gstJurisdiction: { placeOfSupplyCode: '37', sellerStateCode: '36' } };
    const xml = accountingExportService.exportSalesToTallyXml(testOrg, [interstate], customers);
    expect(xml).toContain('<LEDGERNAME>Output IGST</LEDGERNAME>');
  });

  it('requires confirmation instead of assuming a tax ledger for a historical invoice', () => {
    expect(() => accountingExportService.exportSalesToTallyXml(
      testOrg, [{ ...invoices[0], gstJurisdiction: undefined }], customers
    )).toThrow('needs a confirmed place of supply');
  });

  it('generates compliant BUSY Accounting CSV with line item breakdowns', () => {
    const csv = accountingExportService.exportSalesToBusyCsv(invoices, customers);

    expect(csv).toContain('Date,Voucher Type,Invoice No,Customer Name');
    expect(csv).toContain('SLE-26-001');
    expect(csv).toContain('"Balaji Electrical Works"');
    expect(csv).toContain('8536'); // HSN
    expect(csv).toContain('5900.00'); // Total
  });

  it('escapes spreadsheet cells and XML text rather than emitting injected delimiters or tags', () => {
    const specialCustomer = { ...customers[0], name: 'Balaji & Sons <Electricals>' };
    const specialInvoice = {
      ...invoices[0],
      invoiceNumber: 'SLE<&>-001',
      items: [{ ...invoices[0].items![0], productName: '=HYPERLINK("https://example.invalid","MCB")' }],
    };

    const xml = accountingExportService.exportSalesToTallyXml(testOrg, [specialInvoice], [specialCustomer]);
    const csv = accountingExportService.exportSalesToBusyCsv([specialInvoice], [specialCustomer]);

    expect(xml).toContain('<PARTYLEDGERNAME>Balaji &amp; Sons &lt;Electricals&gt;</PARTYLEDGERNAME>');
    expect(xml).toContain('<VOUCHERNUMBER>SLE&lt;&amp;&gt;-001</VOUCHERNUMBER>');
    expect(csv).toContain('"Balaji & Sons <Electricals>"');
    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"",""MCB"")"`);
  });

  it('refuses to fabricate line items when an invoice has no item details', () => {
    const invoiceWithoutItems = { ...invoices[0], items: [] };
    expect(() => accountingExportService.exportSalesToBusyCsv([invoiceWithoutItems], customers))
      .toThrow(/no line items/i);
  });

  it('supports unregistered B2C walk-in sales without GSTIN in Tally XML', () => {
    const b2cCustomer: Customer = {
      id: 'cust-b2c',
      organizationId: testOrg.id,
      name: 'Walk-in Retail Buyer',
      // no gstin
      creditLimit: 0,
      creditDays: 0,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const b2cInvoice: Invoice = {
      ...invoices[0],
      id: 'inv-tally-b2c',
      invoiceNumber: 'SLE-26-B2C',
      customerId: 'cust-b2c',
    };

    const xml = accountingExportService.exportSalesToTallyXml(testOrg, [b2cInvoice], [b2cCustomer]);

    expect(xml).toContain('<PARTYLEDGERNAME>Consumer / Unregistered Dealer</PARTYLEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Consumer / Unregistered Dealer</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Sales Account</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output CGST</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output SGST</LEDGERNAME>');
  });

  it('rejects invoices with invalid non-empty GSTIN in Tally XML', () => {
    const invalidCustomer: Customer = {
      ...customers[0],
      id: 'cust-invalid-gst',
      gstin: 'INVALID_GSTIN_123',
    };
    const invalidInvoice: Invoice = {
      ...invoices[0],
      id: 'inv-tally-invalid',
      customerId: 'cust-invalid-gst',
    };

    expect(() => accountingExportService.exportSalesToTallyXml(testOrg, [invalidInvoice], [invalidCustomer]))
      .toThrow(/invalid buyer GSTIN/i);
  });
  it('labels a confirmed Chandigarh local export as UTGST, not SGST', () => {
    const org = {...testOrg, gstin:'04AAAAA0000A1Z5', state:'Chandigarh'};
    const buyer = {...customers[0], gstin:'04BBBBB1111B1Z6'};
    const invoice = {...invoices[0], gstJurisdiction:{sellerStateCode:'04',placeOfSupplyCode:'04'}};
    const xml = accountingExportService.exportSalesToTallyXml(org,[invoice],[buyer]);
    expect(xml).toContain('<LEDGERNAME>Output CGST</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output UTGST</LEDGERNAME>');
    expect(xml).not.toContain('<LEDGERNAME>Output SGST</LEDGERNAME>');
    expect(xml).toContain('<AMOUNT>450.00</AMOUNT>');
  });
});
