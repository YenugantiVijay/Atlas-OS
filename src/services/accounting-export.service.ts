/**
 * ATLAS OS — Indian Accounting Software Export Service (Tally Prime XML & BUSY CSV)
 *
 * Generates review-required Tally-oriented XML and BUSY-oriented CSV drafts.
 */

import { fromPaise, toPaise } from '@/lib/money';
import { Organization, Customer, Invoice } from '@/types';

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] || character);
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export const accountingExportService = {
  /**
   * Generates a Tally-oriented XML draft for issued sales vouchers.
   */
  exportSalesToTallyXml(
    org: Organization,
    invoices: Invoice[],
    customers: Customer[]
  ): string {
    if (!org.gstin || !/^\d{2}[A-Z0-9]{13}$/.test(org.gstin)) {
      throw new Error('A valid seller GSTIN is required to determine the Tally tax ledgers.');
    }

    let voucherXml = '';

    for (const inv of invoices) {
      if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') continue;

      const customer = customers.find((c) => c.id === inv.customerId);
      if (!customer) {
        throw new Error(`Invoice ${inv.invoiceNumber} has no matching customer record.`);
      }
      if (customer.organizationId !== inv.organizationId || inv.organizationId !== org.id) {
        throw new Error(`Invoice ${inv.invoiceNumber} is not associated with the selected organization.`);
      }

      if (inv.taxAmount > 0 && !inv.gstJurisdiction) {
        throw new Error(`Invoice ${inv.invoiceNumber} needs a confirmed place of supply before Tally export.`);
      }
      const isInterstate = inv.gstJurisdiction
        ? inv.gstJurisdiction.sellerStateCode !== inv.gstJurisdiction.placeOfSupplyCode
        : false;
      let partyLedgerName = 'Consumer / Unregistered Dealer';

      if (customer.gstin && customer.gstin.trim()) {
        const trimmedGstin = customer.gstin.trim().toUpperCase();
        if (!/^\d{2}[A-Z0-9]{13}$/.test(trimmedGstin)) {
          throw new Error(`Invoice ${inv.invoiceNumber} has an invalid buyer GSTIN.`);
        }
        partyLedgerName = customer.name;
      }

      if (![inv.totalAmount, inv.subtotal, inv.discountAmount, inv.taxAmount].every(Number.isFinite)) {
        throw new Error(`Invoice ${inv.invoiceNumber} contains a non-finite total.`);
      }
      const netSubtotalPaise = toPaise(inv.subtotal) - toPaise(inv.discountAmount);
      const taxPaise = toPaise(inv.taxAmount);
      const totalPaise = toPaise(inv.totalAmount);
      if (netSubtotalPaise < 0 || taxPaise < 0 || totalPaise !== netSubtotalPaise + taxPaise) {
        throw new Error(`Invoice ${inv.invoiceNumber} totals do not reconcile; export was stopped.`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.invoiceDate) || Number.isNaN(Date.parse(inv.invoiceDate))) {
        throw new Error(`Invoice ${inv.invoiceNumber} has an invalid invoice date.`);
      }
      const dateFormatted = inv.invoiceDate.replace(/-/g, ''); // YYYYMMDD for Tally
      const partyDebit = fromPaise(-totalPaise).toFixed(2);
      const salesCredit = fromPaise(netSubtotalPaise).toFixed(2);

      let taxLedgersXml = '';
      if (isInterstate) {
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output IGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${fromPaise(taxPaise).toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      } else {
        const cgstCents = Math.floor(taxPaise / 2);
        const sgstCents = taxPaise - cgstCents;
        const cgstAmount = (cgstCents / 100).toFixed(2);
        const sgstAmount = (sgstCents / 100).toFixed(2);
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output CGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${cgstAmount}</AMOUNT>
        </LEDGERENTRIES.LIST>
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output SGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${sgstAmount}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      }

      voucherXml += `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${dateFormatted}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(inv.invoiceNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(partyLedgerName)}</PARTYLEDGERNAME>
          <NARRATION>Atlas OS Tax Invoice #${escapeXml(inv.invoiceNumber)}</NARRATION>
          <EFFECTIVEDATE>${dateFormatted}</EFFECTIVEDATE>
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(partyLedgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>${partyDebit}</AMOUNT>
          </LEDGERENTRIES.LIST>
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>Sales Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${salesCredit}</AMOUNT>
          </LEDGERENTRIES.LIST>${taxLedgersXml}
        </VOUCHER>
      </TALLYMESSAGE>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>${voucherXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  },

  /**
   * Generates a BUSY-oriented CSV draft from actual invoice line items.
   */
  exportSalesToBusyCsv(
    invoices: Invoice[],
    customers: Customer[]
  ): string {
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));
    const headers = [
      'Date',
      'Voucher Type',
      'Invoice No',
      'Customer Name',
      'Item Name',
      'HSN',
      'Quantity',
      'UOM',
      'Price',
      'Taxable Value',
      'GST Rate',
      'Tax Amount',
      'Total Amount',
    ];

    const rows: string[] = [headers.join(',')];

    for (const inv of invoices) {
      if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') continue;
      const customerName = customerMap.get(inv.customerId);
      if (!customerName) {
        throw new Error(`Invoice ${inv.invoiceNumber} has no matching customer record.`);
      }
      const customer = customers.find((candidate) => candidate.id === inv.customerId);
      if (!customer || customer.organizationId !== inv.organizationId) {
        throw new Error(`Invoice ${inv.invoiceNumber} is not associated with the selected customer organization.`);
      }
      if (!inv.items || inv.items.length === 0) {
        throw new Error(`Invoice ${inv.invoiceNumber} has no line items; a truthful BUSY CSV cannot be generated.`);
      }

      for (const item of inv.items) {
        if (![item.quantity, item.unitPrice, item.lineSubtotal, item.taxRate, item.lineTax, item.lineTotal]
          .every(Number.isFinite)) {
          throw new Error(`Invoice ${inv.invoiceNumber} contains a non-finite line-item value.`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.invoiceDate) || Number.isNaN(Date.parse(inv.invoiceDate))) {
          throw new Error(`Invoice ${inv.invoiceNumber} has an invalid invoice date.`);
        }
        rows.push([
          inv.invoiceDate,
          'Sales',
          inv.invoiceNumber,
          customerName,
          item.productName,
          item.hsnCode || '',
          item.quantity,
          item.uom,
          item.unitPrice.toFixed(2),
          item.lineSubtotal.toFixed(2),
          item.taxRate,
          item.lineTax.toFixed(2),
          item.lineTotal.toFixed(2),
        ].map(csvCell).join(','));
      }
    }

    return rows.join('\n');
  },
};
