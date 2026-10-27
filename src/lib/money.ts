/**
 * Financial calculation engine with deterministic fixed-decimal precision.
 * Avoids binary floating-point representation bugs by operating on rounded minor units (paise).
 */

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

export function roundMoney(amount: number): number {
  return fromPaise(toPaise(amount));
}

export interface LineCalculation {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/**
 * Calculates a commercial line item following standard Indian GST distribution practice:
 * 1. Gross = quantity * unitPrice
 * 2. Discount = Gross * (discountPercent / 100)
 * 3. Taxable = Gross - Discount
 * 4. Tax (GST) = Taxable * (taxRate / 100)
 * 5. Line Total = Taxable + Tax
 */
export function calculateLineItem(
  quantity: number,
  unitPrice: number,
  discountPercent: number = 0,
  taxRate: number = 18
): LineCalculation {
  const safeQty = Math.max(0, quantity);
  const safePrice = Math.max(0, unitPrice);
  const safeDiscount = Math.min(100, Math.max(0, discountPercent));
  const safeTaxRate = Math.max(0, taxRate);

  const grossPaise = toPaise(safeQty * safePrice);
  const discountPaise = Math.round(grossPaise * (safeDiscount / 100));
  const taxablePaise = grossPaise - discountPaise;
  const taxPaise = Math.round(taxablePaise * (safeTaxRate / 100));
  const totalPaise = taxablePaise + taxPaise;

  return {
    quantity: safeQty,
    unitPrice: roundMoney(safePrice),
    discountPercent: safeDiscount,
    taxRate: safeTaxRate,
    grossAmount: fromPaise(grossPaise),
    discountAmount: fromPaise(discountPaise),
    taxableAmount: fromPaise(taxablePaise),
    taxAmount: fromPaise(taxPaise),
    totalAmount: fromPaise(totalPaise),
  };
}

/**
 * Format currency with Indian grouping system (lakhs & crores) e.g., ₹ 1,50,000.00
 */
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  const safeAmount = isNaN(amount) ? 0 : amount;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

/**
 * Format number with Indian comma notation without currency symbol
 */
export function formatIndianNumber(num: number): string {
  const safeNum = isNaN(num) ? 0 : num;
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
  }).format(safeNum);
}

export function calculateInvoiceBalance(totalAmount: number, totalPaid: number): number {
  const totalPaise = toPaise(totalAmount);
  const paidPaise = toPaise(totalPaid);
  return fromPaise(Math.max(0, totalPaise - paidPaise));
}
