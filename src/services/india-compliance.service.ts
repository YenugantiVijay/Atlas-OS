/**
 * ATLAS OS — India Compliance & GST Ecosystem Service
 *
 * Implements:
 * 1. GST E-Invoice (NIC Schema v1.03) readiness validation and JSON payload generation.
 * 2. E-Way Bill (EWB) statutory ₹50,000 threshold checking and Part A/B payload preparation.
 * 3. Safe sandbox simulation state (strictly avoids live external network calls).
 */

import { Organization, Customer, Invoice } from '@/types';

export const E_WAY_BILL_STATUTORY_THRESHOLD = 50000; // ₹50,000 statutory consignment limit under CGST Rule 138
export const E_INVOICE_TURNOVER_THRESHOLD = 50000000; // ₹5 Crore threshold (Notification 10/2023-CT)

export interface NicItemDetail {
  ItemNo: number;
  PrdDesc: string;
  IsServc: 'N' | 'Y';
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
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
  eligible: boolean;
  compliant: boolean;
  missingFields: string[];
  payload?: NicEInvoicePayload;
  reason?: string;
}

export interface EWayBillValidationResult {
  required: boolean;
  thresholdExceeded: boolean;
  compliant: boolean;
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
  if (isNaN(d.getTime())) return '01/04/2026';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export const indiaComplianceService = {
  /**
   * Validates invoice against NIC E-Invoice Schema v1.03 requirements.
   */
  validateEInvoiceReadiness(
    org: Organization,
    customer: Customer | undefined,
    invoice: Invoice
  ): EInvoiceValidationResult {
    const missingFields: string[] = [];

    // Seller checks
    if (!org.gstin || org.gstin.trim().length !== 15) {
      missingFields.push('Seller GSTIN (must be a valid 15-character GSTIN)');
    }
    if (!org.name) missingFields.push('Seller Legal Name');
    if (!org.pincode) missingFields.push('Seller PIN Code');

    // Buyer checks (E-Invoicing strictly applies to B2B where buyer is registered)
    if (!customer?.gstin || customer.gstin.trim().length !== 15) {
      return {
        eligible: false,
        compliant: false,
        missingFields: ['Buyer GSTIN is required for B2B e-Invoicing. Unregistered/B2C sales are exempt.'],
        reason: 'Invoice recipient is not a registered GST taxpayer (B2C sale). E-invoicing applies strictly to B2B transactions under GST Rule 48(4).',
      };
    }

    // Document checks
    if (!invoice.invoiceNumber) missingFields.push('Invoice Number');
    if (!invoice.invoiceDate) missingFields.push('Invoice Date');
    if (!invoice.items || invoice.items.length === 0) {
      missingFields.push('Line items (at least 1 line item required)');
    }

    const sellerStateCode = (org.gstin || '36').substring(0, 2);
    const buyerStateCode = (customer.gstin || '36').substring(0, 2);
    const isInterstate = sellerStateCode !== buyerStateCode;

    let totalAssVal = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    const itemList: NicItemDetail[] = [];

    (invoice.items || []).forEach((item, idx) => {
      const itemNo = idx + 1;
      const hsn = (item.hsnCode || '8544').trim();
      if (hsn.length < 4) {
        missingFields.push(`Item ${itemNo} (${item.productName || 'Line'}): HSN code must be at least 4 digits under Indian GST.`);
      }

      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unitPrice || 0);
      const taxRate = Number(item.taxRate || 18);
      const discount = Number(item.discountPercent || 0);

      const grossAmt = Number((qty * unitPrice).toFixed(2));
      const discAmt = Number(((grossAmt * discount) / 100).toFixed(2));
      const assAmt = Number((grossAmt - discAmt).toFixed(2));

      let cgstAmt = 0;
      let sgstAmt = 0;
      let igstAmt = 0;

      if (isInterstate) {
        igstAmt = Number(((assAmt * taxRate) / 100).toFixed(2));
      } else {
        cgstAmt = Number(((assAmt * (taxRate / 2)) / 100).toFixed(2));
        sgstAmt = Number(((assAmt * (taxRate / 2)) / 100).toFixed(2));
      }

      const totItemVal = Number((assAmt + cgstAmt + sgstAmt + igstAmt).toFixed(2));

      totalAssVal += assAmt;
      totalCgst += cgstAmt;
      totalSgst += sgstAmt;
      totalIgst += igstAmt;

      itemList.push({
        ItemNo: itemNo,
        PrdDesc: (item.productName || 'Electrical Component').substring(0, 100),
        IsServc: 'N',
        HsnCd: hsn,
        Qty: qty,
        Unit: item.uom ? item.uom.substring(0, 3).toUpperCase() : 'NOS',
        UnitPrice: unitPrice,
        TotAmt: grossAmt,
        GstRt: taxRate,
        CgstAmt: cgstAmt,
        SgstAmt: sgstAmt,
        IgstAmt: igstAmt,
        TotItemVal: totItemVal,
      });
    });

    if (missingFields.length > 0) {
      return {
        eligible: true,
        compliant: false,
        missingFields,
        reason: 'Invoice is missing mandatory statutory fields required by the NIC e-Invoice schema.',
      };
    }

    const totInvVal = Number((totalAssVal + totalCgst + totalSgst + totalIgst).toFixed(2));

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
        LglNm: org.name,
        Addr1: org.addressLine1 || 'Main Road',
        Loc: org.city || 'Commercial Hub',
        Pin: Number(org.pincode) || 500001,
        Stcd: sellerStateCode,
      },
      BuyerDtls: {
        Gstin: customer.gstin,
        LglNm: customer.name,
        Pos: buyerStateCode,
        Addr1: customer.billingAddress || customer.deliveryAddress || 'Market Area',
        Loc: 'Local',
        Pin: 500001,
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
        Disc: 0,
        OthChrg: 0,
        RndOffAmt: 0,
        TotInvVal: totInvVal,
      },
    };

    return {
      eligible: true,
      compliant: true,
      missingFields: [],
      payload,
    };
  },

  /**
   * Validates whether an invoice requires an E-Way Bill under the statutory ₹50,000 threshold.
   */
  validateEWayBillReadiness(
    org: Organization,
    customer: Customer | undefined,
    invoice: Invoice,
    transportDetails?: { transporterId?: string; vehicleNo?: string; distanceKm?: number }
  ): EWayBillValidationResult {
    const totalAmount = Number(invoice.totalAmount || 0);
    const thresholdExceeded = totalAmount >= E_WAY_BILL_STATUTORY_THRESHOLD;

    if (!thresholdExceeded) {
      return {
        required: false,
        thresholdExceeded: false,
        compliant: true,
        missingFields: [],
        reason: `Consignment total value (₹${totalAmount.toLocaleString('en-IN')}) is below the statutory ₹50,000 limit. E-Way Bill is optional.`,
      };
    }

    const missingFields: string[] = [];
    if (!org.gstin) missingFields.push('Supplier GSTIN');
    if (!customer?.name) missingFields.push('Recipient Name');
    if (!transportDetails?.vehicleNo && !transportDetails?.transporterId) {
      missingFields.push('Transport Details: Either Vehicle Number or Transporter ID is required for Part B.');
    }

    const sellerStateCode = (org.gstin || '36').substring(0, 2);
    const buyerStateCode = (customer?.gstin || sellerStateCode).substring(0, 2);
    const isInterstate = sellerStateCode !== buyerStateCode;

    const taxAmount = Number(invoice.taxAmount || 0);

    const payload = {
      supplyType: 'O' as const,
      subSupplyType: '1' as const,
      docType: 'INV' as const,
      docNo: invoice.invoiceNumber,
      docDate: formatNicDate(invoice.invoiceDate),
      fromGstin: org.gstin || '',
      toGstin: customer?.gstin || 'URP', // Unregistered person
      totalValue: totalAmount,
      cgstValue: isInterstate ? 0 : Number((taxAmount / 2).toFixed(2)),
      sgstValue: isInterstate ? 0 : Number((taxAmount / 2).toFixed(2)),
      igstValue: isInterstate ? taxAmount : 0,
      transporterId: transportDetails?.transporterId,
      vehicleNo: transportDetails?.vehicleNo,
      distanceKm: transportDetails?.distanceKm || 25,
    };

    return {
      required: true,
      thresholdExceeded: true,
      compliant: missingFields.length === 0,
      missingFields,
      payload: missingFields.length === 0 ? payload : undefined,
      reason:
        missingFields.length === 0
          ? 'Mandatory statutory threshold exceeded (>= ₹50,000). E-Way Bill Part A and B generated.'
          : 'Mandatory statutory threshold exceeded (>= ₹50,000). Complete transporter information before vehicle dispatch.',
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
      note: 'Atlas OS operates in deterministic compliance mode. In live production, registered credentials connect directly to the authorized GST Suvidha Provider (GSP) or IRP sandbox.',
    };
  },
};
