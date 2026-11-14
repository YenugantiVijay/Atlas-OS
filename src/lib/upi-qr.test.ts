import { describe, it, expect } from 'vitest';
import { upiQr } from './upi-qr';

describe('Area 6: India Ecosystem — Bharat UPI QR & Instant Links', () => {
  it('validates VPA format accurately', () => {
    expect(upiQr.validateVpa('electricals@hdfcbank').valid).toBe(true);
    expect(upiQr.validateVpa('9848012345@paytm').valid).toBe(true);
    expect(upiQr.validateVpa('sri.lakshmi@icici').valid).toBe(true);

    expect(upiQr.validateVpa('').valid).toBe(false);
    expect(upiQr.validateVpa('invalid-vpa-without-at').valid).toBe(false);
    expect(upiQr.validateVpa('@bankonly').valid).toBe(false);
  });

  it('generates compliant NPCI Bharat UPI deep link URI with parameters', () => {
    const uri = upiQr.generateBharatUpiUri({
      payeeVpa: 'srilakshmi@icici',
      payeeName: 'Sri Lakshmi Electricals',
      amount: 1450.50,
      transactionRef: 'INV001',
      transactionNote: 'Bill Payment',
    });

    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(uri).toContain('pa=srilakshmi%40icici');
    expect(uri).toContain('pn=Sri+Lakshmi+Electricals');
    expect(uri).toContain('am=1450.50');
    expect(uri).toContain('cu=INR');
  });

  it('does not invent a payee VPA for an organization', () => {
    const org = {
      id: 'org-1',
      name: 'Example Electricals',
      currency: 'INR',
      createdAt: '',
      updatedAt: '',
    };
    const invoice = {
      id: 'invoice-1',
      organizationId: 'org-1',
      invoiceNumber: 'INV-1',
      customerId: 'customer-1',
      invoiceDate: '2026-01-01',
      dueDate: '2026-01-31',
      status: 'ISSUED' as const,
      subtotal: 100,
      discountAmount: 0,
      taxAmount: 18,
      totalAmount: 118,
      totalPaid: 0,
      items: [],
      createdAt: '',
      updatedAt: '',
    };
    expect(() => upiQr.getInvoiceUpiPaymentInfo(org, invoice)).toThrow(/verified UPI ID/i);
  });

  it('does not generate a payment request for a settled invoice', () => {
    const org = {
      id: 'org-1',
      name: 'Example Electricals',
      currency: 'INR',
      createdAt: '',
      updatedAt: '',
    };
    const invoice = {
      id: 'invoice-1',
      organizationId: 'org-1',
      invoiceNumber: 'INV-1',
      customerId: 'customer-1',
      invoiceDate: '2026-01-01',
      dueDate: '2026-01-31',
      status: 'PAID' as const,
      subtotal: 100,
      discountAmount: 0,
      taxAmount: 18,
      totalAmount: 118,
      totalPaid: 118,
      items: [],
      createdAt: '',
      updatedAt: '',
    };
    expect(() => upiQr.getInvoiceUpiPaymentInfo(org, invoice, 'dealer@okaxis'))
      .toThrow(/no outstanding balance/i);
  });
});
