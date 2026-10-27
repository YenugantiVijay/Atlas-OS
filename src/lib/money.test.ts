import { describe, it, expect } from 'vitest';
import {
  toPaise,
  fromPaise,
  roundMoney,
  calculateLineItem,
  formatCurrency,
  calculateInvoiceBalance,
} from './money';

describe('Financial and Money Calculation Engine', () => {
  it('converts correctly between rupees and paise without floating-point errors', () => {
    expect(toPaise(100.5)).toBe(10050);
    expect(toPaise(19.99)).toBe(1999);
    expect(fromPaise(10050)).toBe(100.5);
    expect(fromPaise(1999)).toBe(19.99);
    expect(roundMoney(100.555)).toBe(100.56);
  });

  it('calculates commercial line items with Indian GST accurately', () => {
    // 10 units of Polycab wire at ₹2250 with 5% discount and 18% GST
    // Gross: 10 * 2250 = 22,500
    // Discount (5%): 1,125
    // Taxable: 21,375
    // Tax (18%): 3,847.50
    // Total: 25,222.50
    const item = calculateLineItem(10, 2250, 5, 18);
    expect(item.grossAmount).toBe(22500);
    expect(item.discountAmount).toBe(1125);
    expect(item.taxableAmount).toBe(21375);
    expect(item.taxAmount).toBe(3847.5);
    expect(item.totalAmount).toBe(25222.5);
  });

  it('handles zero quantity or zero price safely', () => {
    const item = calculateLineItem(0, 500, 10, 18);
    expect(item.grossAmount).toBe(0);
    expect(item.taxAmount).toBe(0);
    expect(item.totalAmount).toBe(0);
  });

  it('calculates remaining invoice balance correctly', () => {
    expect(calculateInvoiceBalance(50000, 25000)).toBe(25000);
    expect(calculateInvoiceBalance(50000, 50000)).toBe(0);
    expect(calculateInvoiceBalance(50000, 60000)).toBe(0); // cannot be negative
  });

  it('formats currency with Indian numbering system', () => {
    const formatted = formatCurrency(150000);
    // Should contain ₹ and standard Indian group representation (1,50,000)
    expect(formatted).toContain('1,50,000');
  });
});
