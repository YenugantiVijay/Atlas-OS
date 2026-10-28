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

export function parseTaxRate(val: unknown, defaultRate: number = 18): number {
  if (val === null || val === undefined || val === '') {
    return defaultRate;
  }
  const num = Number(val);
  if (isNaN(num)) {
    return defaultRate;
  }
  return Math.max(0, num);
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
  documentDiscountShare?: number;
}

/**
 * Calculates a commercial line item following standard Indian GST distribution practice:
 * 1. Gross = quantity * unitPrice
 * 2. Discount = Gross * (discountPercent / 100)
 * 3. Taxable = Gross - Discount
 * 4. Tax (GST) = Taxable * (taxRate / 100)
 * 5. Line Total = Taxable + Tax
 * 
 * Validates inputs strictly: non-finite or negative values and out-of-range percentages throw clear errors.
 */
export function calculateLineItem(
  quantity: number,
  unitPrice: number,
  discountPercent: number = 0,
  taxRate: number = 18
): LineCalculation {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Quantity cannot be negative or invalid');
  }
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('Unit price cannot be negative or invalid');
  }
  if (typeof discountPercent !== 'number' || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error('Line discount percentage must be between 0% and 100%');
  }
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0) {
    throw new Error('Tax rate cannot be negative or invalid');
  }

  const grossPaise = toPaise(quantity * unitPrice);
  const discountPaise = Math.round(grossPaise * (discountPercent / 100));
  const taxablePaise = grossPaise - discountPaise;
  const taxPaise = Math.round(taxablePaise * (taxRate / 100));
  const totalPaise = taxablePaise + taxPaise;

  return {
    quantity,
    unitPrice: roundMoney(unitPrice),
    discountPercent,
    taxRate,
    grossAmount: fromPaise(grossPaise),
    discountAmount: fromPaise(discountPaise),
    taxableAmount: fromPaise(taxablePaise),
    taxAmount: fromPaise(taxPaise),
    totalAmount: fromPaise(totalPaise),
    documentDiscountShare: 0,
  };
}

export interface DocumentItemInput {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface DocumentTotals {
  grossSubtotal: number;       // Sum of all line gross amounts (quantity * unitPrice) before discounts
  lineDiscountTotal: number;   // Sum of line-level discounts
  documentDiscount: number;    // Document-level discount (if applied)
  discountTotal: number;       // Total discounts: lineDiscountTotal + documentDiscount
  taxableAmount: number;       // Net taxable amount: grossSubtotal - discountTotal
  taxAmount: number;           // Total tax across all lines
  totalAmount: number;         // Final total: taxableAmount + taxAmount (= grossSubtotal - discountTotal + taxAmount)
  items: LineCalculation[];    // Calculated lines with exact apportioned amounts
}

/**
 * Calculates unified document totals guaranteeing the fundamental financial identity:
 * Gross Subtotal - Total Discounts + Total GST = Final Total.
 * Handles single or multiple tax rates (0%, 5%, 12%, 18%, 28%), fractional quantities,
 * and optional document-level discounts with pro-rated GST base apportionment.
 * 
 * Rejects invalid document discounts or over-discounts with clear, user-readable errors.
 */
export function calculateDocumentTotals(
  items: (DocumentItemInput | LineCalculation)[],
  documentDiscount: number = 0
): DocumentTotals {
  if (typeof documentDiscount !== 'number' || !Number.isFinite(documentDiscount) || documentDiscount < 0) {
    throw new Error('Document discount cannot be negative or invalid');
  }

  let grossPaise = 0;
  let lineDiscountPaise = 0;

  // 1. Calculate each line item
  const lineCalcs: LineCalculation[] = items.map((it) => {
    const line =
      'grossAmount' in it && 'taxableAmount' in it
        ? (it as LineCalculation)
        : calculateLineItem(
            it.quantity,
            it.unitPrice,
            it.discountPercent ?? 0,
            parseTaxRate(it.taxRate, 18)
          );
    grossPaise += toPaise(line.grossAmount);
    lineDiscountPaise += toPaise(line.discountAmount);
    return line;
  });

  const rawLineTaxablePaise = grossPaise - lineDiscountPaise;
  const requestedDocDiscountPaise = toPaise(documentDiscount);

  // Explicit rejection: requested document discount cannot exceed remaining line taxable base
  if (requestedDocDiscountPaise > rawLineTaxablePaise) {
    throw new Error(
      `Requested document discount of ₹${roundMoney(documentDiscount).toFixed(2)} exceeds remaining taxable subtotal of ₹${fromPaise(rawLineTaxablePaise).toFixed(2)}`
    );
  }

  const docDiscountPaise = requestedDocDiscountPaise;
  const discountTotalPaise = lineDiscountPaise + docDiscountPaise;
  const taxablePaise = grossPaise - discountTotalPaise;

  // 2. Compute taxes
  let taxPaise = 0;
  let adjustedItems: LineCalculation[] = lineCalcs;

  if (docDiscountPaise === 0) {
    adjustedItems = lineCalcs.map((line) => {
      taxPaise += toPaise(line.taxAmount);
      return {
        ...line,
        documentDiscountShare: 0,
      };
    });
  } else {
    // Pro-rate document discount across lines based on taxable base.
    // Remainder is absorbed by the last line that has positive taxable base,
    // ensuring no line's taxable base drops below zero.
    let lastTaxableIdx = -1;
    for (let i = lineCalcs.length - 1; i >= 0; i--) {
      if (toPaise(lineCalcs[i].taxableAmount) > 0) {
        lastTaxableIdx = i;
        break;
      }
    }

    let allocatedDocDiscount = 0;
    adjustedItems = lineCalcs.map((line, idx) => {
      const lineTaxable = toPaise(line.taxableAmount);
      let lineShare = 0;
      if (rawLineTaxablePaise > 0 && lineTaxable > 0) {
        if (idx === lastTaxableIdx) {
          lineShare = Math.min(lineTaxable, docDiscountPaise - allocatedDocDiscount);
        } else {
          lineShare = Math.min(lineTaxable, Math.round((docDiscountPaise * lineTaxable) / rawLineTaxablePaise));
          allocatedDocDiscount += lineShare;
        }
      }
      const adjTaxablePaise = Math.max(0, lineTaxable - lineShare);
      const adjTaxPaise = Math.round(adjTaxablePaise * (line.taxRate / 100));
      const adjTotalPaise = adjTaxablePaise + adjTaxPaise;
      taxPaise += adjTaxPaise;

      return {
        ...line,
        documentDiscountShare: fromPaise(lineShare),
        discountAmount: fromPaise(toPaise(line.discountAmount) + lineShare),
        taxableAmount: fromPaise(adjTaxablePaise),
        taxAmount: fromPaise(adjTaxPaise),
        totalAmount: fromPaise(adjTotalPaise),
      };
    });
  }

  const totalPaise = taxablePaise + taxPaise;

  return {
    grossSubtotal: fromPaise(grossPaise),
    lineDiscountTotal: fromPaise(lineDiscountPaise),
    documentDiscount: fromPaise(docDiscountPaise),
    discountTotal: fromPaise(discountTotalPaise),
    taxableAmount: fromPaise(taxablePaise),
    taxAmount: fromPaise(taxPaise),
    totalAmount: fromPaise(totalPaise),
    items: adjustedItems,
  };
}

export interface DocumentHeaderInput {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  totalsVersion?: number;
  items?: Array<{
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    taxRate?: number;
    lineSubtotal?: number;
    lineTax?: number;
    lineTotal?: number;
    documentDiscountShare?: number;
  }>;
}

export type DocumentFormatType =
  | 'STANDARD'               // Canonical format: subtotal is gross, subtotal - discount + tax = total
  | 'LEGACY_NET_SUBTOTAL'    // Legacy cloud: subtotal was stored net of line discounts (discount_amount = 0)
  | 'LEGACY_DOUBLE_DEDUCTION'// Legacy demo: subtotal was net, discount_amount > 0, total = subtotal + tax
  | 'ZERO_DISCOUNT'          // Clean zero-discount record: subtotal is both gross and taxable
  | 'UNRESOLVED_HISTORICAL'; // Discrepant or unversioned historical values that cannot be safely established

export interface DocumentPresentationBreakdown {
  format: DocumentFormatType;
  isLegacy: boolean;
  statusNotice?: string;
  subtotalLabel: string;
  subtotalAmount: number;
  showDiscount: boolean;
  discountLabel?: string;
  discountAmount: number;
  taxableLabel: string;
  taxableAmount: number;
  taxLabel: string;
  taxAmount: number;
  totalLabel: string;
  totalAmount: number;
  grossAmount?: number;
  linesReconciled: boolean;
}

/**
 * Historical Document Presentation Resolver:
 * Protects legacy records from false labelling or double-deductions.
 * Uses explicit totalsVersion markers to distinguish canonical v2 documents from historical v1/unversioned records.
 * Keeps uncertain historical records explicitly unresolved rather than guessing format.
 */
export function resolveDocumentPresentation(doc: DocumentHeaderInput): DocumentPresentationBreakdown {
  const S = roundMoney(Number(doc.subtotal) || 0);
  const D = roundMoney(Number(doc.discountAmount) || 0);
  const T = roundMoney(Number(doc.taxAmount) || 0);
  const Total = roundMoney(Number(doc.totalAmount) || 0);
  const totalsVersion = doc.totalsVersion;

  // Analyze line items if available
  let lineGrossPaise = 0;
  let lineDiscountPaise = 0;
  let lineTaxablePaise = 0;
  let lineTaxPaise = 0;
  let lineTotalPaise = 0;
  const hasLineItems = Boolean(doc.items && doc.items.length > 0);

  if (doc.items && doc.items.length > 0) {
    for (const it of doc.items) {
      const qty = Math.max(0, Number(it.quantity) || 0);
      const price = Math.max(0, Number(it.unitPrice) || 0);
      const discPct = Math.min(100, Math.max(0, Number(it.discountPercent) || 0));
      const gPaise = toPaise(qty * price);
      const dPaise = Math.round(gPaise * (discPct / 100));
      const txbPaise = gPaise - dPaise;
      lineGrossPaise += gPaise;
      lineDiscountPaise += dPaise;
      lineTaxablePaise += txbPaise;

      if (it.lineTotal !== undefined) {
        lineTotalPaise += toPaise(Number(it.lineTotal) || 0);
      } else {
        const tRate = parseTaxRate(it.taxRate, 18);
        const txPaise = Math.round(txbPaise * (tRate / 100));
        lineTaxPaise += txPaise;
        lineTotalPaise += txbPaise + txPaise;
      }
    }
  }

  const lineGross = fromPaise(lineGrossPaise);
  const lineDiscount = fromPaise(lineDiscountPaise);
  const lineTotal = fromPaise(lineTotalPaise);

  const linesReconciled = hasLineItems ? Math.abs(lineTotal - Total) <= 0.05 : true;
  const eqStandard = Math.abs(roundMoney(S - D + T) - Total) <= 0.02;
  const eqNetTotal = Math.abs(roundMoney(S + T) - Total) <= 0.02;

  // --------------------------------------------------------------------------
  // PATH 1: Explicit Canonical Version 2 Document
  // --------------------------------------------------------------------------
  if (totalsVersion === 2) {
    if (eqStandard) {
      if (D === 0 && (!hasLineItems || lineDiscount === 0)) {
        return {
          format: 'ZERO_DISCOUNT',
          isLegacy: false,
          subtotalLabel: 'Taxable Subtotal',
          subtotalAmount: S,
          showDiscount: false,
          discountAmount: 0,
          taxableLabel: 'Taxable Amount',
          taxableAmount: S,
          taxLabel: 'GST Tax Amount',
          taxAmount: T,
          totalLabel: 'Total Payable',
          totalAmount: Total,
          linesReconciled,
        };
      }
      return {
        format: 'STANDARD',
        isLegacy: false,
        subtotalLabel: 'Gross Subtotal',
        subtotalAmount: S,
        showDiscount: D > 0,
        discountLabel: 'Discount',
        discountAmount: D,
        taxableLabel: 'Taxable Amount',
        taxableAmount: roundMoney(S - D),
        taxLabel: 'GST Tax Amount',
        taxAmount: T,
        totalLabel: 'Total Payable',
        totalAmount: Total,
        linesReconciled,
      };
    }

    // Version 2 record with internal variance
    return {
      format: 'UNRESOLVED_HISTORICAL',
      isLegacy: false,
      subtotalLabel: 'Subtotal (As Stored)',
      subtotalAmount: S,
      showDiscount: D > 0,
      discountLabel: 'Discount (As Stored)',
      discountAmount: D,
      taxableLabel: 'Taxable Amount (Estimated)',
      taxableAmount: roundMoney(S - D),
      taxLabel: 'GST Tax Amount',
      taxAmount: T,
      totalLabel: 'Total (As Stored)',
      totalAmount: Total,
      statusNotice: 'Document total does not mathematically reconcile with stored subtotal, discount, and tax.',
      linesReconciled,
    };
  }

  // --------------------------------------------------------------------------
  // PATH 2: Historical / Unversioned Document (totalsVersion !== 2)
  // All records here are identified as isLegacy = true.
  // --------------------------------------------------------------------------

  // Case 2A: Clean Zero Discounts across header and lines
  if (D === 0 && (!hasLineItems || lineDiscount === 0) && eqNetTotal) {
    return {
      format: 'ZERO_DISCOUNT',
      isLegacy: true,
      subtotalLabel: 'Taxable Subtotal',
      subtotalAmount: S,
      showDiscount: false,
      discountAmount: 0,
      taxableLabel: 'Taxable Amount',
      taxableAmount: S,
      taxLabel: 'GST Tax Amount',
      taxAmount: T,
      totalLabel: 'Total Payable',
      totalAmount: Total,
      linesReconciled,
    };
  }

  // Case 2B: Proven Legacy Cloud Format
  // Header discount is 0, line discounts exist, total = S + T, and S matches line taxable base
  if (D === 0 && hasLineItems && lineDiscount > 0 && eqNetTotal && Math.abs(roundMoney(S + lineDiscount) - lineGross) <= 0.05) {
    return {
      format: 'LEGACY_NET_SUBTOTAL',
      isLegacy: true,
      grossAmount: lineGross,
      subtotalLabel: 'Taxable Subtotal (Legacy)',
      subtotalAmount: S,
      showDiscount: true,
      discountLabel: 'Line Discount (Applied at Line Level)',
      discountAmount: lineDiscount,
      taxableLabel: 'Taxable Amount',
      taxableAmount: S,
      taxLabel: 'GST Tax Amount',
      taxAmount: T,
      totalLabel: 'Total Payable',
      totalAmount: Total,
      statusNotice: 'Historical record format: subtotal was recorded net of line discounts. Stored values preserved without recalculation.',
      linesReconciled,
    };
  }

  // Case 2C: Proven Legacy Demo Double-Deduction Format
  // Header discount > 0, but total was S + T (not S - D + T)
  if (D > 0 && eqNetTotal && !eqStandard) {
    return {
      format: 'LEGACY_DOUBLE_DEDUCTION',
      isLegacy: true,
      subtotalLabel: 'Taxable Subtotal (Legacy)',
      subtotalAmount: S,
      showDiscount: true,
      discountLabel: 'Line Discount (Already Deducted in Stored Subtotal)',
      discountAmount: D,
      taxableLabel: 'Net Taxable Value',
      taxableAmount: S,
      taxLabel: 'GST Tax Amount',
      taxAmount: T,
      totalLabel: 'Total Payable',
      totalAmount: Total,
      statusNotice: 'Historical demo record: discount was recorded in header but was already deducted from subtotal. Values preserved without double-deduction.',
      linesReconciled,
    };
  }

  // Case 2D: Proven Historical Standard
  // Line items are available and explicitly verify that S == lineGross and D == lineDiscount
  if (eqStandard && hasLineItems && Math.abs(S - lineGross) <= 0.05 && Math.abs(D - lineDiscount) <= 0.05) {
    return {
      format: 'STANDARD',
      isLegacy: true,
      subtotalLabel: 'Gross Subtotal',
      subtotalAmount: S,
      showDiscount: D > 0,
      discountLabel: 'Discount',
      discountAmount: D,
      taxableLabel: 'Taxable Amount',
      taxableAmount: roundMoney(S - D),
      taxLabel: 'GST Tax Amount',
      taxAmount: T,
      totalLabel: 'Total Payable',
      totalAmount: Total,
      statusNotice: 'Historical record: verified against line item breakdown.',
      linesReconciled,
    };
  }

  // Case 2E: Uncertain or Discrepant Historical Record
  // Mathematical reconciliation alone is not treated as proof when format cannot be definitively established.
  return {
    format: 'UNRESOLVED_HISTORICAL',
    isLegacy: true,
    subtotalLabel: 'Subtotal (As Stored)',
    subtotalAmount: S,
    showDiscount: D > 0,
    discountLabel: 'Discount (As Stored)',
    discountAmount: D,
    taxableLabel: 'Taxable Amount (Estimated)',
    taxableAmount: roundMoney(S - D),
    taxLabel: 'GST Tax Amount',
    taxAmount: T,
    totalLabel: 'Total (As Stored)',
    totalAmount: Total,
    statusNotice: 'Historical record: unversioned format cannot be definitively established. Values displayed as originally recorded without recalculation.',
    linesReconciled,
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

