/**
 * ATLAS OS — India Compliance & GST Ecosystem Service
 *
 * Provides sandbox-only payload drafting helpers. These checks do not determine
 * statutory applicability, validate data with NIC, or file documents.
 */

import { Organization, Customer, Invoice } from '@/types';
import { calculateLineItem, toPaise, fromPaise } from '@/lib/money';
import { INDIAN_GST_STATES } from '@/lib/gst';

export const E_WAY_BILL_STATUTORY_THRESHOLD = 50000; // ₹50,000 statutory consignment limit under CGST Rule 138
export const E_INVOICE_TURNOVER_THRESHOLD = 50000000; // ₹5 Crore threshold (Notification 10/2023-CT)

export function extractBuyerLocationAndPin(customer: Partial<Customer> & {
  city?: string;
  location?: string;
  pincode?: string | number;
  pin?: string | number;
  address?: string;
}): { location: string | null; pin: number | null } {
  // 1. PIN code extraction
  let pin: number | null = null;
  const rawPin = customer.pincode ?? customer.pin;
  if (rawPin && /^\d{6}$/.test(String(rawPin).trim())) {
    pin = parseInt(String(rawPin).trim(), 10);
  }

  const rawAddress = [
    customer.billingAddress,
    customer.deliveryAddress,
    customer.address,
  ]
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .join(', ');

  if (!pin && rawAddress) {
    const pinMatch = rawAddress.match(/\b\d{6}\b/);
    if (pinMatch) {
      pin = parseInt(pinMatch[0], 10);
    }
  }

  // 2. Location / City extraction
  let location: string | null = null;
  const rawCity = customer.city ?? customer.location;
  if (typeof rawCity === 'string' && rawCity.trim().length >= 3) {
    location = rawCity.trim().substring(0, 50);
  }

  if (!location && rawAddress) {
    // Strip PIN code, country names, and cleanup delimiters
    const cleaned = rawAddress
      .replace(/\b\d{6}\b/g, '')
      .replace(/\b(India|Bharat)\b/gi, '')
      .trim();

    // Split by commas, newlines, or semicolons
    const segments = cleaned
      .split(/[\n,;]+/)
      .map((s) => s.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim())
      .filter((s) => s.length >= 3);

    if (segments.length > 0) {
      // Check if the last segment is an Indian state name
      const knownStates = Object.values(INDIAN_GST_STATES).map((st) => st.toLowerCase());
      const lastSeg = segments[segments.length - 1];
      const isLastSegState = knownStates.some(
        (st) => st === lastSeg.toLowerCase() || lastSeg.toLowerCase().includes(st)
      );

      if (isLastSegState && segments.length > 1) {
        // Take the segment immediately before the state
        location = segments[segments.length - 2].substring(0, 50);
      } else {
        location = lastSeg.substring(0, 50);
      }
    }
  }

  return { location, pin };
}

export interface NicItemDetail {
  ItemNo: number;
  PrdDesc: string;
  IsServc: 'N' | 'Y';
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  CgstAmt: number;
  SgstAmt: number;
  IgstAmt: number;
  TotItemVal: number;
}

export interface NicEInvoicePayload {
  Version: string;
  TranDtls: {
    TaxSch: 'GST';
    SupTyp: 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
    RegRev: 'N' | 'Y';
    EcmGstin: string | null;
    IgstOnIntra: 'N' | 'Y';
  };
  DocDtls: {
    Typ: 'INV' | 'CRN' | 'DBN';
    No: string;
    Dt: string; // DD/MM/YYYY
  };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    Pos: string;
    Addr1: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  ItemList: NicItemDetail[];
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal: number;
    StCesVal: number;
    Disc: number;
    OthChrg: number;
    RndOffAmt: number;
    TotInvVal: number;
  };
}

export interface EInvoiceValidationResult {
  eligible: boolean | null;
  fieldsComplete: boolean;
  missingFields: string[];
  payload?: NicEInvoicePayload;
  reason?: string;
}

export interface EWayBillValidationResult {
  required: boolean | null;
  thresholdExceeded: boolean;
  fieldsComplete: boolean;
  missingFields: string[];
  payload?: {
    supplyType: 'O'; // Outward
    subSupplyType: '1'; // Supply
    docType: 'INV';
    docNo: string;
    docDate: string;
    fromGstin: string;
    toGstin: string;
    totalValue: number;
    cgstValue: number;
    sgstValue: number;
    igstValue: number;
    transporterId?: string;
    vehicleNo?: string;
    distanceKm: number;
  };
  reason?: string;
}

function formatNicDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export const indiaComplianceService = {
  /**
   * Checks source fields needed for a draft; it does not perform official NIC validation.
   */
  validateEInvoiceReadiness(
    org: Organization,
    customer: Customer | undefined,
    invoice: Invoice,
    placeOfSupplyCode?: string
  ): EInvoiceValidationResult {
    const missingFields: string[] = [];

    // Seller checks
    if (!org.gstin || !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(org.gstin.trim())) {
      missingFields.push('Seller GSTIN (must be a valid 15-character GSTIN)');
    }
    if (!org.legalName) missingFields.push('Seller Legal Name');
    if (!org.addressLine1) missingFields.push('Seller Address');
    if (!org.city) missingFields.push('Seller Location');
    if (!org.pincode || !/^\d{6}$/.test(org.pincode)) missingFields.push('Seller PIN Code (6 digits)');

    // The customer's GSTIN identifies a B2B candidate, but taxpayer turnover and exemptions are unavailable here.
    if (!customer?.gstin || !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(customer.gstin.trim())) {
      return {
        eligible: false,
        fieldsComplete: false,
        missingFields: ['Buyer GSTIN is required for B2B e-Invoicing. Unregistered/B2C sales are exempt.'],
        reason: 'A buyer GSTIN is required for this B2B payload. Confirm transaction classification and current e-invoice applicability separately.',
      };
    }

    // Document checks
    if (!invoice.invoiceNumber) missingFields.push('Invoice Number');
    if (!invoice.invoiceDate) missingFields.push('Invoice Date');
    if (!formatNicDate(invoice.invoiceDate)) missingFields.push('Valid Invoice Date');
    if (!invoice.items || invoice.items.length === 0) {
      missingFields.push('Line items (at least 1 line item required)');
    }
    if (!customer.billingAddress && !customer.deliveryAddress) missingFields.push('Buyer Address');
    const { location: buyerLoc, pin: buyerPin } = extractBuyerLocationAndPin(customer);
    if (!buyerLoc) {
      missingFields.push('Buyer Location (not available on the customer profile)');
    }
    if (!buyerPin) {
      missingFields.push('Buyer PIN Code (not available on the customer profile)');
    }

    const sellerStateCode = (org.gstin || '36').substring(0, 2);
    const buyerStateCode = (customer.gstin || '36').substring(0, 2);
    placeOfSupplyCode = invoice.gstJurisdiction?.placeOfSupplyCode ?? placeOfSupplyCode;
    if (!placeOfSupplyCode || !Object.prototype.hasOwnProperty.call(INDIAN_GST_STATES, placeOfSupplyCode)) {
      missingFields.push('Choose the place of supply recorded for this invoice.');
    }
    if (invoice.gstJurisdiction && invoice.gstJurisdiction.sellerStateCode !== sellerStateCode) {
      missingFields.push('Seller GSTIN does not match the recorded jurisdiction for this invoice.');
    }
    const isInterstate = sellerStateCode !== placeOfSupplyCode;

    let totalAssVal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalLineDiscountPaise = 0;

    const itemList: NicItemDetail[] = [];

    (invoice.items || []).forEach((item, idx) => {
      const itemNo = idx + 1;
      const hsn = (item.hsnCode || '').trim();
      if (!/^\d{4,8}$/.test(hsn)) {
        missingFields.push(`Item ${itemNo} (${item.productName || 'Line'}): provide a 4-to-8 digit HSN code.`);
      }

      const priorIssues = missingFields.length;
      const qty = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);
      const taxRate = Number(item.taxRate);
      const discount = Number(item.discountPercent);
      if (!Number.isFinite(qty) || qty <= 0) missingFields.push(`Item ${itemNo}: quantity must be greater than zero.`);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) missingFields.push(`Item ${itemNo}: unit price must be non-negative.`);
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) missingFields.push(`Item ${itemNo}: provide a valid GST rate.`);
      if (!Number.isFinite(discount) || discount < 0 || discount > 100) missingFields.push(`Item ${itemNo}: provide a valid discount percentage.`);
      if (!item.productName) missingFields.push(`Item ${itemNo}: product description is required.`);

      if (missingFields.length !== priorIssues) return;
      const line = calculateLineItem(qty, unitPrice, discount, taxRate);
      const allocatedShare = item.documentDiscountShare ?? 0;
      const allocatedPaise = toPaise(allocatedShare);
      if (!Number.isFinite(allocatedShare) || allocatedPaise < 0 || allocatedPaise > toPaise(line.taxableAmount)) {
        missingFields.push(`Item ${itemNo}: the recorded invoice discount allocation is invalid.`);
        return;
      }
      const lineDiscountPaise = toPaise(line.discountAmount) + allocatedPaise;
      const assPaise = toPaise(line.grossAmount) - lineDiscountPaise;
      const lineTaxPaise = toPaise(calculateLineItem(1, fromPaise(assPaise), 0, taxRate).taxAmount);
      if (toPaise(item.lineSubtotal) !== assPaise || toPaise(item.lineTax) !== lineTaxPaise ||
          toPaise(item.lineTotal) !== assPaise + lineTaxPaise) {
        missingFields.push(`Item ${itemNo}: the GST draft does not reconcile with the recorded invoice line.`);
        return;
      }
      totalLineDiscountPaise += lineDiscountPaise;

      let cgstAmt = 0;
      let sgstAmt = 0;
      let igstAmt = 0;

      if (isInterstate) {
        const igstPaise = lineTaxPaise;
        igstAmt = fromPaise(igstPaise);
        totalIgst = fromPaise(toPaise(totalIgst) + igstPaise);
      } else {
        const totalTaxPaise = lineTaxPaise;
        const cgstPaise = Math.floor(totalTaxPaise / 2);
        const sgstPaise = totalTaxPaise - cgstPaise;
        cgstAmt = fromPaise(cgstPaise);
        sgstAmt = fromPaise(sgstPaise);
        totalCgst = fromPaise(toPaise(totalCgst) + cgstPaise);
        totalSgst = fromPaise(toPaise(totalSgst) + sgstPaise);
      }

      const totItemVal = fromPaise(assPaise + toPaise(cgstAmt) + toPaise(sgstAmt) + toPaise(igstAmt));
      totalAssVal = fromPaise(toPaise(totalAssVal) + assPaise);

      itemList.push({
        ItemNo: itemNo,
        PrdDesc: item.productName.substring(0, 100),
        IsServc: 'N',
        HsnCd: hsn,
        Qty: qty,
        Unit: item.uom.substring(0, 3).toUpperCase(),
        UnitPrice: unitPrice,
        TotAmt: line.grossAmount,
        Discount: fromPaise(lineDiscountPaise),
        AssAmt: fromPaise(assPaise),
        GstRt: taxRate,
        CgstAmt: cgstAmt,
        SgstAmt: sgstAmt,
        IgstAmt: igstAmt,
        TotItemVal: totItemVal,
      });
    });

    if (missingFields.length > 0) {
      return {
        eligible: null,
        fieldsComplete: false,
        missingFields,
        reason: 'A complete payload draft cannot be built from available profile data. Legal eligibility and filing status are not determined here.',
      };
    }

    const totalDiscountPaise = toPaise(Number(invoice.discountAmount || 0));
    // In Atlas OS, line items already reflect item-level discounts in assPaise (totalAssVal).
    // Under NIC GST E-Invoice Schema 1.1, ValDtls.Disc is strictly for additional
    // unallocated document-level discounts NOT already subtracted from item taxable bases.
    const unallocatedDocDiscountPaise = Math.max(0, totalDiscountPaise - totalLineDiscountPaise);
    const unallocatedDocDiscount = fromPaise(unallocatedDocDiscountPaise);

    const totalTaxPaise = toPaise(totalCgst) + toPaise(totalSgst) + toPaise(totalIgst);
    const totInvValPaise = toPaise(totalAssVal) + totalTaxPaise - unallocatedDocDiscountPaise;
    if (totalDiscountPaise < totalLineDiscountPaise || totInvValPaise < 0 ||
        totalTaxPaise !== toPaise(invoice.taxAmount) || totInvValPaise !== toPaise(invoice.totalAmount)) {
      return {
        eligible: null,
        fieldsComplete: false,
        missingFields: ['The draft does not reconcile with the recorded invoice tax, discount, or total.'],
        reason: 'Review the posted invoice before creating a GST draft.',
      };
    }
    const totInvVal = fromPaise(totInvValPaise);

    const payload: NicEInvoicePayload = {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: 'B2B',
        RegRev: 'N',
        EcmGstin: null,
        IgstOnIntra: 'N',
      },
      DocDtls: {
        Typ: 'INV',
        No: invoice.invoiceNumber,
        Dt: formatNicDate(invoice.invoiceDate),
      },
      SellerDtls: {
        Gstin: org.gstin || '',
        LglNm: org.legalName || '',
        Addr1: org.addressLine1 || '',
        Loc: org.city || '',
        Pin: Number(org.pincode) || 0,
        Stcd: sellerStateCode,
      },
      BuyerDtls: {
        Gstin: customer.gstin,
        LglNm: customer.name,
        Pos: placeOfSupplyCode!,
        Addr1: customer.billingAddress || customer.deliveryAddress || '',
        Loc: buyerLoc || '',
        Pin: buyerPin || 0,
        Stcd: buyerStateCode,
      },
      ItemList: itemList,
      ValDtls: {
        AssVal: Number(totalAssVal.toFixed(2)),
        CgstVal: Number(totalCgst.toFixed(2)),
        SgstVal: Number(totalSgst.toFixed(2)),
        IgstVal: Number(totalIgst.toFixed(2)),
        CesVal: 0,
        StCesVal: 0,
        Disc: Number(unallocatedDocDiscount.toFixed(2)),
        OthChrg: 0,
        RndOffAmt: 0,
        TotInvVal: totInvVal,
      },
    };

    return {
      eligible: null,
      fieldsComplete: true,
      missingFields: [],
      payload,
    };
  },

  /**
   * Checks the invoice-value threshold and draft data without determining legal applicability.
   */
  validateEWayBillReadiness(
    org: Organization,
    customer: Customer | undefined,
    invoice: Invoice,
    transportDetails?: { transporterId?: string; vehicleNo?: string; distanceKm?: number }
  ): EWayBillValidationResult {
    const totalAmount = Number(invoice.totalAmount || 0);
    const thresholdExceeded = totalAmount > E_WAY_BILL_STATUTORY_THRESHOLD;

    if (!thresholdExceeded) {
      return {
        required: null,
        thresholdExceeded: false,
        fieldsComplete: false,
        missingFields: [],
        reason: `Invoice value (₹${totalAmount.toLocaleString('en-IN')}) does not exceed ₹50,000. This threshold check does not evaluate route-specific rules or exemptions.`,
      };
    }

    const missingFields: string[] = [];
    if (!org.gstin) missingFields.push('Supplier GSTIN');
    if (!customer?.name) missingFields.push('Recipient Name');
    if (!transportDetails?.vehicleNo && !transportDetails?.transporterId) {
      missingFields.push('Transport Details: Either Vehicle Number or Transporter ID is required for Part B.');
    }
    if (!Number.isFinite(transportDetails?.distanceKm) || (transportDetails?.distanceKm ?? 0) <= 0) {
      missingFields.push('Transport distance in kilometres');
    }

    const sellerStateCode = (org.gstin || '36').substring(0, 2);
    const buyerStateCode = (customer?.gstin || sellerStateCode).substring(0, 2);
    const isInterstate = sellerStateCode !== buyerStateCode;

    const taxAmount = Number(invoice.taxAmount || 0);
    const totalTaxPaise = toPaise(taxAmount);
    const cgstPaise = isInterstate ? 0 : Math.floor(totalTaxPaise / 2);
    const sgstPaise = isInterstate ? 0 : totalTaxPaise - cgstPaise;

    const payload = {
      supplyType: 'O' as const,
      subSupplyType: '1' as const,
      docType: 'INV' as const,
      docNo: invoice.invoiceNumber,
      docDate: formatNicDate(invoice.invoiceDate),
      fromGstin: org.gstin || '',
      toGstin: customer?.gstin || 'URP', // Unregistered person
      totalValue: totalAmount,
      cgstValue: fromPaise(cgstPaise),
      sgstValue: fromPaise(sgstPaise),
      igstValue: isInterstate ? taxAmount : 0,
      transporterId: transportDetails?.transporterId,
      vehicleNo: transportDetails?.vehicleNo,
      distanceKm: transportDetails?.distanceKm ?? 0,
    };

    return {
      required: null,
      thresholdExceeded: true,
      fieldsComplete: missingFields.length === 0,
      missingFields,
      payload: missingFields.length === 0 ? payload : undefined,
      reason:
        missingFields.length === 0
          ? 'Invoice value exceeds ₹50,000. Review applicable rules and exemptions before using this draft; it has not been filed.'
          : 'Invoice value exceeds ₹50,000. Complete transport information and verify statutory applicability before use.',
    };
  },

  /**
   * Returns environment configuration status for sandbox simulation without calling live APIs.
   */
  getSandboxStatus(org: Organization) {
    const hasGstin = Boolean(org.gstin && org.gstin.length === 15);
    return {
      mode: 'SANDBOX_SIMULATION',
      sellerGstin: org.gstin || 'NOT_CONFIGURED',
      isReadyForTesting: hasGstin,
      note: 'Readiness helpers only. They do not determine statutory applicability, validate data with NIC, or file documents; no live credentials or external connections are configured.',
    };
  },
};
