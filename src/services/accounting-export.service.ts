/**
 * ATLAS OS — Indian Accounting Software Export Service (Tally Prime XML & BUSY CSV)
 *
 * Implements standard data export formats for Indian SME accounting software:
 * 1. Tally Prime XML Sales & Receipt Vouchers.
 * 2. BUSY Accounting CSV Master/Transaction format.
 */

import { Organization, Customer, Invoice } from '@/types';

export const accountingExportService = {
  /**
   * Generates official Tally Prime XML for sales vouchers.
   */
  exportSalesToTallyXml(
    org: Organization,
    invoices: Invoice[],
    customers: Customer[]
  ): string {
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));
    const sellerStateCode = (org.gstin || '36').substring(0, 2);

    let voucherXml = '';

    for (const inv of invoices) {
      if (inv.status === 'CANCELLED') continue;

      const customerName = customerMap.get(inv.customerId) || 'Cash Customer';
      const dateFormatted = inv.invoiceDate.replace(/-/g, ''); // YYYYMMDD for Tally
      const totalAmount = Number(inv.totalAmount || 0).toFixed(2);
      const taxAmount = Number(inv.taxAmount || 0);
      const subtotal = Number(inv.subtotal || 0).toFixed(2);

      const customerObj = customers.find((c) => c.id === inv.customerId);
      const buyerStateCode = (customerObj?.gstin || sellerStateCode).substring(0, 2);
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
        const halfTax = (taxAmount / 2).toFixed(2);
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output CGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${halfTax}</AMOUNT>
        </LEDGERENTRIES.LIST>
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>Output SGST</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>-${halfTax}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      }

      voucherXml += `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${dateFormatted}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${inv.invoiceNumber}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${customerName}</PARTYLEDGERNAME>
          <NARRATION>Atlas OS Tax Invoice #${inv.invoiceNumber}</NARRATION>
          <EFFECTIVEDATE>${dateFormatted}</EFFECTIVEDATE>
          <LEDGERENTRIES.LIST>
            <LEDGERNAME>${customerName}</LEDGERNAME>
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
   * Generates BUSY Accounting CSV export format for sales invoices.
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
      if (inv.status === 'CANCELLED') continue;
      const custName = customerMap.get(inv.customerId) || 'Cash Sale';

      if (!inv.items || inv.items.length === 0) {
        rows.push([
          inv.invoiceDate,
          'Sales',
          inv.invoiceNumber,
          `"${custName}"`,
          'General Electrical Goods',
          '8544',
          1,
          'Nos',
          inv.subtotal,
          inv.subtotal,
          18,
          inv.taxAmount,
          inv.totalAmount,
        ].join(','));
      } else {
        for (const item of inv.items) {
          const qty = item.quantity || 1;
          const price = item.unitPrice || 0;
          const taxable = (qty * price).toFixed(2);
          const taxAmt = ((Number(taxable) * (item.taxRate || 18)) / 100).toFixed(2);
          const itemTotal = (Number(taxable) + Number(taxAmt)).toFixed(2);

          rows.push([
            inv.invoiceDate,
            'Sales',
            inv.invoiceNumber,
            `"${custName}"`,
            `"${item.productName || 'Electrical Item'}"`,
            item.hsnCode || '8544',
            qty,
            item.uom || 'Nos',
            price,
            taxable,
            item.taxRate || 18,
            taxAmt,
            itemTotal,
          ].join(','));
        }
      }
    }

    return rows.join('\n');
  },
};
