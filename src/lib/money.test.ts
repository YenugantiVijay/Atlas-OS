import { describe, it, expect } from 'vitest';
import {
  toPaise,
  fromPaise,
  roundMoney,
  parseTaxRate,
  calculateLineItem,
  calculateDocumentTotals,
  formatCurrency,
  calculateInvoiceBalance,
  resolveDocumentPresentation,
} from './money';
import { mapDbProduct } from '@/services/products.service';
import { mapDbSalesOrderItem, mapDbQuotationItem } from '@/services/orders.service';
import { mapDbInvoiceItem } from '@/services/invoices.service';

describe('Financial and Money Calculation Engine', () => {
  describe('Minor Unit (Paise) Precision and Rounding', () => {
    it('converts correctly between rupees and paise without floating-point errors', () => {
      expect(toPaise(100.5)).toBe(10050);
      expect(toPaise(19.99)).toBe(1999);
      expect(fromPaise(10050)).toBe(100.5);
      expect(fromPaise(1999)).toBe(19.99);
      expect(roundMoney(100.555)).toBe(100.56);
      expect(roundMoney(100.554)).toBe(100.55);
    });

    it('formats currency with Indian numbering system', () => {
      const formatted = formatCurrency(150000);
      expect(formatted).toContain('1,50,000');
    });

    it('calculates remaining invoice balance correctly', () => {
      expect(calculateInvoiceBalance(50000, 25000)).toBe(25000);
      expect(calculateInvoiceBalance(50000, 50000)).toBe(0);
      expect(calculateInvoiceBalance(50000, 60000)).toBe(0); // cannot be negative
    });
  });

  describe('Tax Rate Parsing & 0% Preservation (Resolves || 18 Bug)', () => {
    it('preserves legitimate 0% tax rate as a number', () => {
      expect(parseTaxRate(0)).toBe(0);
      expect(parseTaxRate('0')).toBe(0);
      expect(parseTaxRate(0.0)).toBe(0);
      expect(parseTaxRate('0.00')).toBe(0);
    });

    it('preserves statutory GST tax rates (5%, 12%, 18%, 28%)', () => {
      expect(parseTaxRate(5)).toBe(5);
      expect(parseTaxRate('5')).toBe(5);
      expect(parseTaxRate(12)).toBe(12);
      expect(parseTaxRate('12')).toBe(12);
      expect(parseTaxRate(18)).toBe(18);
      expect(parseTaxRate('18')).toBe(18);
      expect(parseTaxRate(28)).toBe(28);
    });

    it('falls back to default only when value is truly missing or invalid', () => {
      expect(parseTaxRate(null, 18)).toBe(18);
      expect(parseTaxRate(undefined, 18)).toBe(18);
      expect(parseTaxRate('', 18)).toBe(18);
      expect(parseTaxRate('invalid', 18)).toBe(18);
      expect(parseTaxRate(NaN, 18)).toBe(18);
      expect(parseTaxRate(undefined, 0)).toBe(0);
    });

    it('ensures database mappers preserve legitimate 0% tax rates', () => {
      const prod0 = mapDbProduct({
        id: 'p-0',
        organization_id: 'org-1',
        sku: 'SKU-0',
        name: 'Exempt Wire Item',
        tax_rate: 0,
        purchase_cost: '100',
        selling_price: '150',
      });
      expect(prod0.taxRate).toBe(0);

      const prod0Str = mapDbProduct({
        id: 'p-0s',
        organization_id: 'org-1',
        sku: 'SKU-0S',
        name: 'Exempt String Item',
        tax_rate: '0',
        purchase_cost: '100',
        selling_price: '150',
      });
      expect(prod0Str.taxRate).toBe(0);

      const soItem0 = mapDbSalesOrderItem({
        id: 'so-it-0',
        tax_rate: '0.00',
        quantity: 5,
        unit_price: 200,
      });
      expect(soItem0.taxRate).toBe(0);

      const quotItem0 = mapDbQuotationItem({
        id: 'qt-it-0',
        tax_rate: 0,
        quantity: 5,
        unit_price: 200,
      });
      expect(quotItem0.taxRate).toBe(0);

      const invItem0 = mapDbInvoiceItem({
        id: 'inv-it-0',
        tax_rate: '0',
        quantity: 5,
        unit_price: 200,
      });
      expect(invItem0.taxRate).toBe(0);
    });
  });

  describe('Commercial Line Item Calculations (calculateLineItem)', () => {
    it('calculates standard 18% GST line with 5% discount', () => {
      // 10 units at ₹2250, 5% discount, 18% GST
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
      expect(roundMoney(item.taxableAmount + item.taxAmount)).toBe(item.totalAmount);
      expect(roundMoney(item.grossAmount - item.discountAmount)).toBe(item.taxableAmount);
    });

    it('calculates 0% tax rate line correctly with zero tax', () => {
      const item = calculateLineItem(10, 500, 10, 0);
      expect(item.grossAmount).toBe(5000);
      expect(item.discountAmount).toBe(500);
      expect(item.taxableAmount).toBe(4500);
      expect(item.taxAmount).toBe(0);
      expect(item.totalAmount).toBe(4500);
    });

    it('calculates 5% GST rate accurately', () => {
      // 20 units at ₹150, 0% discount, 5% GST
      // Gross: 3,000, Taxable: 3,000, Tax: 150, Total: 3,150
      const item = calculateLineItem(20, 150, 0, 5);
      expect(item.grossAmount).toBe(3000);
      expect(item.discountAmount).toBe(0);
      expect(item.taxableAmount).toBe(3000);
      expect(item.taxAmount).toBe(150);
      expect(item.totalAmount).toBe(3150);
    });

    it('calculates 12% GST rate accurately', () => {
      // 5 units at ₹800, 10% discount, 12% GST
      // Gross: 4,000, Discount: 400, Taxable: 3,600, Tax: 432, Total: 4,032
      const item = calculateLineItem(5, 800, 10, 12);
      expect(item.grossAmount).toBe(4000);
      expect(item.discountAmount).toBe(400);
      expect(item.taxableAmount).toBe(3600);
      expect(item.taxAmount).toBe(432);
      expect(item.totalAmount).toBe(4032);
    });

    it('handles fractional/decimal quantities accurately with exact paise rounding', () => {
      // 2.5 meters of heavy cable at ₹43.50/m, 0% discount, 18% GST
      // Gross: 2.5 * 43.50 = 108.75
      // Tax (18%): 108.75 * 0.18 = 19.575 -> rounds to 19.58
      // Total: 108.75 + 19.58 = 128.33
      const item = calculateLineItem(2.5, 43.5, 0, 18);
      expect(item.grossAmount).toBe(108.75);
      expect(item.discountAmount).toBe(0);
      expect(item.taxableAmount).toBe(108.75);
      expect(item.taxAmount).toBe(19.58);
      expect(item.totalAmount).toBe(128.33);
      expect(roundMoney(item.taxableAmount + item.taxAmount)).toBe(item.totalAmount);
    });

    it('handles rounding boundaries and repeating decimals safely', () => {
      // 3 items at ₹33.33 each with 33.33% discount and 18% tax
      const item = calculateLineItem(3, 33.33, 33.33, 18);
      expect(item.grossAmount).toBe(99.99);
      expect(item.discountAmount).toBe(33.33);
      expect(item.taxableAmount).toBe(66.66);
      expect(item.taxAmount).toBe(12.0);
      expect(item.totalAmount).toBe(78.66);
      expect(roundMoney(item.grossAmount - item.discountAmount + item.taxAmount)).toBe(item.totalAmount);
    });
  });

  describe('Document Totals Engine & Reconciliation Identity Guarantee', () => {
    it('reconciles documents with zero discounts', () => {
      const doc = calculateDocumentTotals([
        { quantity: 10, unitPrice: 1000, discountPercent: 0, taxRate: 18 },
        { quantity: 2, unitPrice: 500, discountPercent: 0, taxRate: 18 },
      ]);

      expect(doc.grossSubtotal).toBe(11000);
      expect(doc.lineDiscountTotal).toBe(0);
      expect(doc.discountTotal).toBe(0);
      expect(doc.taxableAmount).toBe(11000);
      expect(doc.taxAmount).toBe(1980);
      expect(doc.totalAmount).toBe(12980);

      // Identity: Gross - Discount + Tax = Total
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('reconciles documents with non-zero line discounts', () => {
      const doc = calculateDocumentTotals([
        { quantity: 10, unitPrice: 2250, discountPercent: 5, taxRate: 18 },
        { quantity: 4, unitPrice: 680, discountPercent: 0, taxRate: 18 },
      ]);

      // Item 1: Gross 22,500, Discount 1,125, Taxable 21,375, Tax 3,847.50, Total 25,222.50
      // Item 2: Gross 2,720, Discount 0, Taxable 2,720, Tax 489.60, Total 3,209.60
      expect(doc.grossSubtotal).toBe(25220);
      expect(doc.lineDiscountTotal).toBe(1125);
      expect(doc.discountTotal).toBe(1125);
      expect(doc.taxableAmount).toBe(24095);
      expect(doc.taxAmount).toBe(4337.1);
      expect(doc.totalAmount).toBe(28432.1);

      // Identity: Gross - Discount + Tax = Total
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('reconciles mixed-tax documents (0%, 5%, 12%, 18%)', () => {
      const doc = calculateDocumentTotals([
        { quantity: 10, unitPrice: 100, discountPercent: 0, taxRate: 0 },   // 0% tax
        { quantity: 5, unitPrice: 200, discountPercent: 10, taxRate: 5 },   // 5% tax, 10% disc
        { quantity: 2, unitPrice: 1500, discountPercent: 5, taxRate: 12 },  // 12% tax, 5% disc
        { quantity: 1, unitPrice: 4000, discountPercent: 20, taxRate: 18 }, // 18% tax, 20% disc
      ]);

      // Line 1: Gross 1,000, Disc 0, Taxable 1,000, Tax 0, Total 1,000
      // Line 2: Gross 1,000, Disc 100, Taxable 900, Tax 45, Total 945
      // Line 3: Gross 3,000, Disc 150, Taxable 2,850, Tax 342, Total 3,192
      // Line 4: Gross 4,000, Disc 800, Taxable 3,200, Tax 576, Total 3,776

      expect(doc.grossSubtotal).toBe(9000);
      expect(doc.discountTotal).toBe(1050);
      expect(doc.taxableAmount).toBe(7950);
      expect(doc.taxAmount).toBe(963);
      expect(doc.totalAmount).toBe(8913);

      // Identity: Gross - Discount + Tax = Total
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
      // Identity: Taxable + Tax = Total
      expect(roundMoney(doc.taxableAmount + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('supports document-level discounts with pro-rated GST base apportionment', () => {
      // 2 items: 1000 @ 18%, 2000 @ 18%. Total gross: 3000.
      // Document discount of ₹300.
      const doc = calculateDocumentTotals(
        [
          { quantity: 1, unitPrice: 1000, discountPercent: 0, taxRate: 18 },
          { quantity: 1, unitPrice: 2000, discountPercent: 0, taxRate: 18 },
        ],
        300
      );

      expect(doc.grossSubtotal).toBe(3000);
      expect(doc.documentDiscount).toBe(300);
      expect(doc.discountTotal).toBe(300);
      expect(doc.taxableAmount).toBe(2700);
      // Tax: 18% of 2700 = 486
      expect(doc.taxAmount).toBe(486);
      expect(doc.totalAmount).toBe(3186);

      // Identity: Gross - Discount + Tax = Total
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('reconciles decimal quantities with discounts and taxes', () => {
      const doc = calculateDocumentTotals([
        { quantity: 12.5, unitPrice: 85.5, discountPercent: 4, taxRate: 18 },
        { quantity: 3.75, unitPrice: 240, discountPercent: 0, taxRate: 12 },
      ]);

      // Verify mathematical reconciliation
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
      expect(roundMoney(doc.taxableAmount + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('reconciles simultaneous line discounts and document-level discount across mixed tax rates', () => {
      // Line 1: 10 @ 1000, 10% line disc, 18% tax -> Gross 10000, line disc 1000, taxable base 9000
      // Line 2: 5 @ 2000, 5% line disc, 12% tax -> Gross 10000, line disc 500, taxable base 9500
      // Line 3: 20 @ 100, 0% line disc, 0% tax (exempt) -> Gross 2000, line disc 0, taxable base 2000
      // Total Gross = 22,000. Line discounts = 1,500. Raw taxable base = 20,500.
      // Document discount: ₹2,050 (exactly 10% of remaining taxable base)
      const doc = calculateDocumentTotals(
        [
          { quantity: 10, unitPrice: 1000, discountPercent: 10, taxRate: 18 },
          { quantity: 5, unitPrice: 2000, discountPercent: 5, taxRate: 12 },
          { quantity: 20, unitPrice: 100, discountPercent: 0, taxRate: 0 },
        ],
        2050
      );

      expect(doc.grossSubtotal).toBe(22000);
      expect(doc.lineDiscountTotal).toBe(1500);
      expect(doc.documentDiscount).toBe(2050);
      expect(doc.discountTotal).toBe(3550);
      expect(doc.taxableAmount).toBe(18450);

      // Line 1: share = 2050 * 9000 / 20500 = 900. Adj taxable = 8100. Tax (18%) = 1458. Total = 9558.
      expect(doc.items[0].taxableAmount).toBe(8100);
      expect(doc.items[0].taxAmount).toBe(1458);
      expect(doc.items[0].totalAmount).toBe(9558);

      // Line 2: share = 2050 * 9500 / 20500 = 950. Adj taxable = 8550. Tax (12%) = 1026. Total = 9576.
      expect(doc.items[1].taxableAmount).toBe(8550);
      expect(doc.items[1].taxAmount).toBe(1026);
      expect(doc.items[1].totalAmount).toBe(9576);

      // Line 3 (0% tax): share = 2050 - (900 + 950) = 200. Adj taxable = 1800. Tax (0%) = 0. Total = 1800.
      expect(doc.items[2].taxableAmount).toBe(1800);
      expect(doc.items[2].taxAmount).toBe(0);
      expect(doc.items[2].totalAmount).toBe(1800);

      // Verify line items sum exactly to header totals
      const sumLineTaxable = roundMoney(doc.items.reduce((s, it) => s + it.taxableAmount, 0));
      const sumLineTax = roundMoney(doc.items.reduce((s, it) => s + it.taxAmount, 0));
      const sumLineTotal = roundMoney(doc.items.reduce((s, it) => s + it.totalAmount, 0));

      expect(sumLineTaxable).toBe(doc.taxableAmount);
      expect(sumLineTax).toBe(doc.taxAmount);
      expect(sumLineTotal).toBe(doc.totalAmount);
      expect(roundMoney(doc.grossSubtotal - doc.discountTotal + doc.taxAmount)).toBe(doc.totalAmount);
    });

    it('absorbs document discount rounding remainder into the last positive taxable line item', () => {
      // 3 items with ₹100 taxable each (total 300). Document discount: ₹100 (1/3 per item = 33.33... paise)
      const doc = calculateDocumentTotals(
        [
          { quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 },
          { quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 },
          { quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 },
        ],
        100
      );

      // In paise: 10,000 paise gross per item (total 30,000 paise). Document discount: 10,000 paise.
      // Line 1: round(10000 * 10000 / 30000) = 3333 paise (₹33.33). Adj taxable = 6667 paise (₹66.67).
      // Line 2: round(10000 * 10000 / 30000) = 3333 paise (₹33.33). Adj taxable = 6667 paise (₹66.67).
      // Line 3: remainder absorbed = 10000 - (3333 + 3333) = 3334 paise (₹33.34). Adj taxable = 6666 paise (₹66.66).
      expect(doc.items[0].taxableAmount).toBe(66.67);
      expect(doc.items[1].taxableAmount).toBe(66.67);
      expect(doc.items[2].taxableAmount).toBe(66.66);
      expect(roundMoney(doc.items[0].taxableAmount + doc.items[1].taxableAmount + doc.items[2].taxableAmount)).toBe(200);

      const sumLineTotal = roundMoney(doc.items.reduce((s, it) => s + it.totalAmount, 0));
      expect(sumLineTotal).toBe(doc.totalAmount);
    });

    it('rejects document discount when it exceeds remaining taxable subtotal (over-discount rejection)', () => {
      // Gross subtotal is ₹1,000. Caller attempts to apply ₹5,000 document discount.
      // Must explicitly reject with user-readable error, NOT silently clamp to 1000.
      expect(() =>
        calculateDocumentTotals(
          [{ quantity: 10, unitPrice: 100, discountPercent: 0, taxRate: 18 }],
          5000
        )
      ).toThrow(/exceeds remaining taxable subtotal/);
    });

    it('rejects negative, NaN, non-finite, and invalid inputs with explicit user-readable errors', () => {
      // Line quantity validation
      expect(() => calculateLineItem(-5, 100, 0, 18)).toThrow(/Quantity cannot be negative or invalid/);
      expect(() => calculateLineItem(NaN, 100, 0, 18)).toThrow(/Quantity cannot be negative or invalid/);
      expect(() => calculateLineItem(Infinity, 100, 0, 18)).toThrow(/Quantity cannot be negative or invalid/);

      // Unit price validation
      expect(() => calculateLineItem(5, -100, 0, 18)).toThrow(/Unit price cannot be negative or invalid/);
      expect(() => calculateLineItem(5, NaN, 0, 18)).toThrow(/Unit price cannot be negative or invalid/);
      expect(() => calculateLineItem(5, Infinity, 0, 18)).toThrow(/Unit price cannot be negative or invalid/);

      // Line discount percentage validation (must be 0-100%)
      expect(() => calculateLineItem(5, 100, -10, 18)).toThrow(/Line discount percentage must be between 0% and 100%/);
      expect(() => calculateLineItem(5, 100, 150, 18)).toThrow(/Line discount percentage must be between 0% and 100%/);
      expect(() => calculateLineItem(5, 100, NaN, 18)).toThrow(/Line discount percentage must be between 0% and 100%/);

      // Tax rate validation
      expect(() => calculateLineItem(5, 100, 0, -5)).toThrow(/Tax rate cannot be negative or invalid/);
      expect(() => calculateLineItem(5, 100, 0, NaN)).toThrow(/Tax rate cannot be negative or invalid/);

      // Document-level discount validation
      expect(() =>
        calculateDocumentTotals([{ quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 }], -50)
      ).toThrow(/Document discount cannot be negative or invalid/);
      expect(() =>
        calculateDocumentTotals([{ quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 }], NaN)
      ).toThrow(/Document discount cannot be negative or invalid/);
    });

    it('persists and reports each line documentDiscountShare accurately', () => {
      // 2 lines: 1000 @ 18%, 2000 @ 18%. Doc discount 300.
      const doc = calculateDocumentTotals(
        [
          { quantity: 1, unitPrice: 1000, discountPercent: 0, taxRate: 18 },
          { quantity: 1, unitPrice: 2000, discountPercent: 0, taxRate: 18 },
        ],
        300
      );

      expect(doc.items[0].documentDiscountShare).toBe(100);
      expect(doc.items[1].documentDiscountShare).toBe(200);
      expect(roundMoney(doc.items[0].documentDiscountShare! + doc.items[1].documentDiscountShare!)).toBe(300);
    });
  });

  describe('Historical Document Compatibility & Presentation (resolveDocumentPresentation)', () => {
    describe('Canonical Version 2 Document Resolution', () => {
      it('resolves canonical v2 document with discount as STANDARD (isLegacy = false)', () => {
        const presentation = resolveDocumentPresentation({
          totalsVersion: 2,
          subtotal: 25220,
          discountAmount: 1125,
          taxAmount: 4337.1,
          totalAmount: 28432.1,
          items: [
            { quantity: 10, unitPrice: 2250, discountPercent: 5, taxRate: 18, lineSubtotal: 21375, lineTax: 3847.5, lineTotal: 25222.5 },
            { quantity: 4, unitPrice: 680, discountPercent: 0, taxRate: 18, lineSubtotal: 2720, lineTax: 489.6, lineTotal: 3209.6 },
          ],
        });

        expect(presentation.format).toBe('STANDARD');
        expect(presentation.isLegacy).toBe(false);
        expect(presentation.subtotalLabel).toBe('Gross Subtotal');
        expect(presentation.subtotalAmount).toBe(25220);
        expect(presentation.showDiscount).toBe(true);
        expect(presentation.discountLabel).toBe('Discount');
        expect(presentation.discountAmount).toBe(1125);
        expect(presentation.taxableAmount).toBe(24095);
        expect(presentation.totalAmount).toBe(28432.1);
        expect(presentation.statusNotice).toBeUndefined();
      });

      it('resolves canonical v2 document with 0% tax and zero discount as ZERO_DISCOUNT (isLegacy = false)', () => {
        const presentation = resolveDocumentPresentation({
          totalsVersion: 2,
          subtotal: 5000,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: 5000,
        });

        expect(presentation.format).toBe('ZERO_DISCOUNT');
        expect(presentation.isLegacy).toBe(false);
        expect(presentation.subtotalLabel).toBe('Taxable Subtotal');
        expect(presentation.showDiscount).toBe(false);
        expect(presentation.statusNotice).toBeUndefined();
      });

      it('detects and flags calculation variance on v2 records without misclassifying as legacy', () => {
        const presentation = resolveDocumentPresentation({
          totalsVersion: 2,
          subtotal: 10000,
          discountAmount: 1000,
          taxAmount: 1620,
          totalAmount: 20000, // variance: expected 10620
        });

        expect(presentation.format).toBe('UNRESOLVED_HISTORICAL');
        expect(presentation.isLegacy).toBe(false); // v2 record, not legacy, but has variance
        expect(presentation.statusNotice).toContain('Document total does not mathematically reconcile');
      });
    });

    describe('Historical / Unversioned Document Compatibility (totalsVersion !== 2)', () => {
      it('correctly classifies legacy cloud records with line discounts and zero header discount', () => {
        // In legacy cloud mode, subtotal was stored net of line discounts (24,095)
        // discount_amount was hardcoded to 0 in header, tax was 4,337.10, total was 28,432.10
        const presentation = resolveDocumentPresentation({
          subtotal: 24095,
          discountAmount: 0,
          taxAmount: 4337.1,
          totalAmount: 28432.1,
          items: [
            { quantity: 10, unitPrice: 2250, discountPercent: 5, taxRate: 18, lineSubtotal: 21375, lineTax: 3847.5, lineTotal: 25222.5 },
            { quantity: 4, unitPrice: 680, discountPercent: 0, taxRate: 18, lineSubtotal: 2720, lineTax: 489.6, lineTotal: 3209.6 },
          ],
        });

        expect(presentation.format).toBe('LEGACY_NET_SUBTOTAL');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Taxable Subtotal (Legacy)');
        expect(presentation.subtotalAmount).toBe(24095); // Must NOT be falsely relabelled as gross 25,220
        expect(presentation.showDiscount).toBe(true);
        expect(presentation.discountLabel).toBe('Line Discount (Applied at Line Level)');
        expect(presentation.discountAmount).toBe(1125);
        expect(presentation.taxableLabel).toBe('Taxable Amount');
        expect(presentation.taxableAmount).toBe(24095);
        expect(presentation.totalAmount).toBe(28432.1);
        expect(presentation.statusNotice).toContain('Historical record format');
        expect(presentation.linesReconciled).toBe(true);
      });

      it('prevents double deduction on previously persisted demo-mode totals', () => {
        // In legacy demo mode, subtotal was stored net (24,095) AND discount was stored (1,125)
        // but total was subtotal + tax (28,432.10).
        const presentation = resolveDocumentPresentation({
          subtotal: 24095,
          discountAmount: 1125,
          taxAmount: 4337.1,
          totalAmount: 28432.1,
        });

        expect(presentation.format).toBe('LEGACY_DOUBLE_DEDUCTION');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Taxable Subtotal (Legacy)');
        expect(presentation.subtotalAmount).toBe(24095);
        expect(presentation.showDiscount).toBe(true);
        expect(presentation.discountLabel).toContain('Already Deducted');
        expect(presentation.discountAmount).toBe(1125);
        expect(presentation.taxableLabel).toBe('Net Taxable Value');
        expect(presentation.taxableAmount).toBe(24095); // Does NOT deduct 1125 again!
        expect(presentation.totalAmount).toBe(28432.1);
        expect(presentation.statusNotice).toContain('without double-deduction');
      });

      it('correctly classifies clean historical documents with no discounts and 0% tax', () => {
        const presentation = resolveDocumentPresentation({
          subtotal: 5000,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: 5000,
          items: [
            { quantity: 50, unitPrice: 100, discountPercent: 0, taxRate: 0, lineSubtotal: 5000, lineTax: 0, lineTotal: 5000 },
          ],
        });

        expect(presentation.format).toBe('ZERO_DISCOUNT');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Taxable Subtotal');
        expect(presentation.subtotalAmount).toBe(5000);
        expect(presentation.showDiscount).toBe(false);
        expect(presentation.taxableAmount).toBe(5000);
        expect(presentation.taxAmount).toBe(0);
        expect(presentation.totalAmount).toBe(5000);
        expect(presentation.linesReconciled).toBe(true);
      });

      it('verifies historical standard document when line items reliably substantiate gross subtotal', () => {
        const presentation = resolveDocumentPresentation({
          subtotal: 25220,
          discountAmount: 1125,
          taxAmount: 4337.1,
          totalAmount: 28432.1,
          items: [
            { quantity: 10, unitPrice: 2250, discountPercent: 5, taxRate: 18, lineSubtotal: 21375, lineTax: 3847.5, lineTotal: 25222.5 },
            { quantity: 4, unitPrice: 680, discountPercent: 0, taxRate: 18, lineSubtotal: 2720, lineTax: 489.6, lineTotal: 3209.6 },
          ],
        });

        expect(presentation.format).toBe('STANDARD');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Gross Subtotal');
        expect(presentation.statusNotice).toContain('verified against line item breakdown');
      });

      it('keeps unversioned historical record explicitly unresolved when line items are missing', () => {
        // Without version 2 marker or verifying line items, mathematical reconciliation alone
        // must NOT be treated as definitive proof of format.
        const presentation = resolveDocumentPresentation({
          subtotal: 25220,
          discountAmount: 1125,
          taxAmount: 4337.1,
          totalAmount: 28432.1,
          // no line items provided
        });

        expect(presentation.format).toBe('UNRESOLVED_HISTORICAL');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Subtotal (As Stored)');
        expect(presentation.subtotalAmount).toBe(25220);
        expect(presentation.totalLabel).toBe('Total (As Stored)');
        expect(presentation.totalAmount).toBe(28432.1);
        expect(presentation.statusNotice).toContain('unversioned format cannot be definitively established');
      });

      it('explicitly warns about unresolved historical variances without guessing', () => {
        const presentation = resolveDocumentPresentation({
          subtotal: 10000,
          discountAmount: 200,
          taxAmount: 500,
          totalAmount: 15000,
        });

        expect(presentation.format).toBe('UNRESOLVED_HISTORICAL');
        expect(presentation.isLegacy).toBe(true);
        expect(presentation.subtotalLabel).toBe('Subtotal (As Stored)');
        expect(presentation.subtotalAmount).toBe(10000);
        expect(presentation.totalLabel).toBe('Total (As Stored)');
        expect(presentation.totalAmount).toBe(15000);
        expect(presentation.statusNotice).toContain('unversioned format cannot be definitively established');
      });
    });
  });
});

