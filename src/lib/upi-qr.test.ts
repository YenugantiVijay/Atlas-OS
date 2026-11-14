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
});
