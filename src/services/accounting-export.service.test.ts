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
    expect(xml).toContain('<PARTYLEDGERNAME>Balaji Electrical Works</PARTYLEDGERNAME>');
    expect(xml).toContain('<VOUCHERNUMBER>SLE-26-001</VOUCHERNUMBER>');
    expect(xml).toContain('<LEDGERNAME>Sales Account</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output CGST</LEDGERNAME>');
    expect(xml).toContain('<LEDGERNAME>Output SGST</LEDGERNAME>');
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
});
