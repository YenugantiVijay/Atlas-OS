/**
 * ATLAS OS — Indian Accounting Software Export Service (Tally Prime XML & BUSY CSV)
 *
 * Generates review-required Tally-oriented XML and BUSY-oriented CSV drafts.
 */

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
    const sellerStateCode = org.gstin.substring(0, 2);

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
      if (!customer.gstin || !/^\d{2}[A-Z0-9]{13}$/.test(customer.gstin)) {
        throw new Error(`Invoice ${inv.invoiceNumber} has no buyer GSTIN to determine the Tally tax ledgers.`);
      }
      const customerName = customer.name;
      if (![inv.totalAmount, inv.subtotal, inv.discountAmount, inv.taxAmount].every(Number.isFinite)) {
        throw new Error(`Invoice ${inv.invoiceNumber} contains a non-finite total.`);
      }
      const netSubtotal = Number((inv.subtotal - inv.discountAmount).toFixed(2));
      const expectedTotal = Number((netSubtotal + inv.taxAmount).toFixed(2));
      if (Math.abs(expectedTotal - inv.totalAmount) > 0.01) {
        throw new Error(`Invoice ${inv.invoiceNumber} totals do not reconcile; export was stopped.`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.invoiceDate) || Number.isNaN(Date.parse(inv.invoiceDate))) {
        throw new Error(`Invoice ${inv.invoiceNumber} has an invalid invoice date.`);
      }
      const dateFormatted = inv.invoiceDate.replace(/-/g, ''); // YYYYMMDD for Tally
      const totalAmount = Number(inv.totalAmount || 0).toFixed(2);
      const taxAmount = Number(inv.taxAmount || 0);
      const subtotal = netSubtotal.toFixed(2);

      const buyerStateCode = customer.gstin.substring(0, 2);
      const isInterstate = sellerStateCode !== buyerStateCode;

      let taxLedgersXml = '';
      if (isInterstate) {
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output IGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${taxAmount.toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      } else {
        const cgstCents = Math.floor(Math.round(taxAmount * 100) / 2);
        const sgstCents = Math.round(taxAmount * 100) - cgstCents;
        const cgstAmount = (cgstCents / 100).toFixed(2);
        const sgstAmount = (sgstCents / 100).toFixed(2);
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output CGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${cgstAmount}</AMOUNT>
        </LEDGERENTRIES.LIST>
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output SGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${sgstAmount}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      }

      voucherXml += `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${dateFormatted}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(inv.invoiceNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(customerName)}</PARTYLEDGERNAME>
          <NARRATION>Atlas OS Tax Invoice #${escapeXml(inv.invoiceNumber)}</NARRATION>
          <EFFECTIVEDATE>${dateFormatted}</EFFECTIVEDATE>
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(customerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>${totalAmount}</AMOUNT>
          </LEDGERENTRIES.LIST>
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>Sales Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>-${subtotal}</AMOUNT>
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
