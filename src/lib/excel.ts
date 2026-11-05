/**
 * Atlas OS — Professional Excel Reporting & Financial Workbook Engine
 *
 * Implements authoritative .xlsx generation with:
 * 1. Formula injection protection across all untrusted user-controlled text
 * 2. Multi-worksheet financial exports (Reconciliation, Invoice Summary, Invoice Products, Payment Receipts, Payment Allocations)
 * 3. Exact INR number and currency formatting
 * 4. Frozen headers, auto-filters, professional corporate styling
 * 5. Complete mathematical reconciliation across sheets segregating recognized sales from draft/cancelled documents
 * 6. Historical tax fidelity: Total tax rate and tax amounts are authoritative; unrecorded historical component splits are disclosed
 * 7. Cross-period payment allocation resolution for referenced invoices
 */

import ExcelJS from 'exceljs';
import { Invoice, Payment, Organization, Customer } from '@/types';
import { roundMoney, calculateInvoiceBalance } from './money';
import { resolvePlaceOfSupply } from './gst';
import { formatDisplayDate } from './dates';

export interface ReportCriteria {
  periodType: 'FY' | 'MONTH' | 'DAY' | 'CUSTOM';
  periodLabel: string;
  startDate: string;
  endDate: string;
  customerId?: string;
  customerName?: string;
  documentType: 'ALL' | 'INVOICES' | 'PAYMENTS';
  invoiceStatus?: string;
  isDemoMode: boolean;
}

export interface ReferencedInvoiceMeta {
  id: string;
  invoiceNumber: string;
  invoiceDate?: string;
  status?: string;
}

export interface WorkbookPayload {
  organization: Organization;
  criteria: ReportCriteria;
  invoices: Invoice[];
  payments: Payment[];
  referencedInvoices?: Map<string, ReferencedInvoiceMeta>;
  customersMap?: Record<string, Customer>;
}

/**
 * Formula Injection Escaping:
 * If a string begins with any character that spreadsheet engines (Excel, LibreOffice, Google Sheets)
 * evaluate as an active formula or command (=, +, -, @, \t, \r, |, %), prepend a single quote (').
 *
 * Numerical fields are passed directly as numbers to ExcelJS and are not subject to formula injection.
 */
export function sanitizeExcelText(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (!str) return '';

  const firstChar = str.charAt(0);
  if (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@' ||
    firstChar === '\t' ||
    firstChar === '\r' ||
    firstChar === '|' ||
    firstChar === '%'
  ) {
    return `'${str}`;
  }

  return str;
}

// Visual styling constants
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E293B' }, // Slate 800
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: 'Segoe UI',
  size: 10,
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

const TITLE_FONT: Partial<ExcelJS.Font> = {
  name: 'Segoe UI',
  size: 14,
  bold: true,
  color: { argb: 'FF0F172A' }, // Slate 900
};

const SUBTITLE_FONT: Partial<ExcelJS.Font> = {
  name: 'Segoe UI',
  size: 10,
  italic: true,
  color: { argb: 'FF475569' }, // Slate 600
};

const SECTION_FONT: Partial<ExcelJS.Font> = {
  name: 'Segoe UI',
  size: 11,
  bold: true,
  color: { argb: 'FF0F766E' }, // Teal 700
};

const TOTAL_FONT: Partial<ExcelJS.Font> = {
  name: 'Segoe UI',
  size: 10,
  bold: true,
  color: { argb: 'FF0F172A' },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' }, // Slate 100
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

const TOTAL_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'double', color: { argb: 'FF0F172A' } },
};

const INR_FORMAT = '₹#,##0.00;[Red](₹#,##0.00);₹0.00';
const INT_FORMAT = '#,##0';
const PCT_FORMAT = '0.00"%"';

/**
 * Creates and formats a header row on a given worksheet with frozen pane and auto-filter.
 */
function setupWorksheetHeader(
  ws: ExcelJS.Worksheet,
  title: string,
  criteria: ReportCriteria,
  org: Organization,
  columns: Array<{ header: string; key: string; width: number; numFmt?: string }>,
  customSubtitle?: string
): void {
  // Title Block
  const titleRow = ws.addRow([`Atlas OS — ${title}`]);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.mergeCells(1, 1, 1, 6);

  const defaultSub = `Organization: ${org.name || 'Business'} | Period: ${criteria.periodLabel} (${criteria.startDate} to ${criteria.endDate}) | Mode: ${
    criteria.isDemoMode ? 'DEMO MODE (Sample Data)' : 'Production Records'
  }`;

  const subRow = ws.addRow([customSubtitle ? `${defaultSub} | ${customSubtitle}` : defaultSub]);
  subRow.getCell(1).font = SUBTITLE_FONT;
  ws.mergeCells(2, 1, 2, 8);

  ws.addRow([]); // Blank spacer row 3

  // Table Headers (Row 4)
  ws.columns = columns.map((c) => ({
    key: c.key,
    width: c.width,
    style: { font: { name: 'Segoe UI', size: 10 } },
  }));

  const headerRow = ws.getRow(4);
  headerRow.height = 24;

  for (let colIdx = 1; colIdx <= columns.length; colIdx++) {
    const colDef = columns[colIdx - 1];
    const cell = headerRow.getCell(colIdx);
    cell.value = colDef.header;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = THIN_BORDER;
  }

  // Freeze top 4 rows
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  // Auto-filter across all columns
  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: columns.length },
  };
}

/**
 * Builds the Reconciliation Worksheet.
 * Authoritatively reconciles recognized sales revenue, accounts receivable,
 * non-revenue documents (drafts/cancelled), and period cash collections.
 */
function buildReconciliationSheet(ws: ExcelJS.Worksheet, payload: WorkbookPayload): void {
  const { organization: org, criteria, invoices, payments } = payload;

  // Title
  const r1 = ws.addRow(['Atlas OS — Financial & Operational Reconciliation Report']);
  r1.getCell(1).font = TITLE_FONT;
  ws.mergeCells(1, 1, 1, 6);

  const r2 = ws.addRow([
    `Generated on: ${new Date().toISOString()} | Business Timezone: Asia/Kolkata (IST)`,
  ]);
  r2.getCell(1).font = SUBTITLE_FONT;

  ws.addRow([]);

  // Section 1: Business Organization Profile
  const rOrgH = ws.addRow(['1. ORGANIZATION PROFILE & STATUTORY IDENTIFIERS']);
  rOrgH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Legal Business Name', sanitizeExcelText(org.legalName || org.name)]);
  ws.addRow(['Trade / Operating Name', sanitizeExcelText(org.name)]);
  ws.addRow(['Organization ID', sanitizeExcelText(org.id)]);
  ws.addRow(['GSTIN', sanitizeExcelText(org.gstin || 'Not Registered / Composition')]);
  ws.addRow(['PAN', sanitizeExcelText(org.pan || '—')]);
  ws.addRow(['Operating State', sanitizeExcelText(org.state || '—')]);
  ws.addRow(['Operating Currency', sanitizeExcelText(org.currency || 'INR')]);

  ws.addRow([]);

  // Section 2: Report Scope & Period
  const rScopeH = ws.addRow(['2. REPORT SCOPE & FILTER CRITERIA']);
  rScopeH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Reporting Period Type', criteria.periodType]);
  ws.addRow(['Period Description', criteria.periodLabel]);
  ws.addRow(['Start Date (Inclusive)', criteria.startDate]);
  ws.addRow(['End Date (Inclusive)', criteria.endDate]);
  ws.addRow(['Document Filter', criteria.documentType]);
  ws.addRow(['Invoice Status Filter', criteria.invoiceStatus || 'ALL']);
  ws.addRow(['Customer Filter', sanitizeExcelText(criteria.customerName || 'All Customers')]);
  ws.addRow([
    'Execution Environment',
    criteria.isDemoMode
      ? 'DEMO MODE — SAMPLE DATA ONLY (NOT AUTHENTICATED FINANCIAL RECORDS)'
      : 'Authoritative Production Database',
  ]);

  ws.addRow([]);

  // Section 3: Invoices Reconciliation Segregated by Legal Recognition
  let recognizedInvoiceCount = 0;
  let recognizedSubtotal = 0;
  let recognizedDiscount = 0;
  let recognizedTax = 0;
  let recognizedRevenue = 0;
  let recognizedPaid = 0;
  let recognizedOutstanding = 0;

  let draftCount = 0;
  let draftTotal = 0;

  let cancelledCount = 0;
  let cancelledTotal = 0;

  const statusCounts: Record<string, number> = {
    DRAFT: 0,
    ISSUED: 0,
    PARTIALLY_PAID: 0,
    PAID: 0,
    CANCELLED: 0,
  };

  for (const inv of invoices) {
    statusCounts[inv.status] = (statusCounts[inv.status] || 0) + 1;

    if (inv.status === 'DRAFT') {
      draftCount++;
      draftTotal += inv.totalAmount;
    } else if (inv.status === 'CANCELLED') {
      cancelledCount++;
      cancelledTotal += inv.totalAmount;
    } else {
      // Legally recognized sales: ISSUED, PARTIALLY_PAID, PAID
      recognizedInvoiceCount++;
      recognizedSubtotal += inv.subtotal;
      recognizedDiscount += inv.discountAmount;
      recognizedTax += inv.taxAmount;
      recognizedRevenue += inv.totalAmount;
      recognizedPaid += inv.totalPaid;
      if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') {
        recognizedOutstanding += calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
      }
    }
  }

  const addCurrencyRow = (label: string, val: number) => {
    const row = ws.addRow([label, roundMoney(val)]);
    row.getCell(2).numFmt = INR_FORMAT;
    row.getCell(2).font = { name: 'Segoe UI', size: 10, bold: true };
    return row;
  };

  const rInvH = ws.addRow(['3. RECOGNIZED SALES REVENUE RECONCILIATION (ISSUED, PARTIALLY PAID & PAID)']);
  rInvH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Total Recognized Invoices', recognizedInvoiceCount]);
  ws.addRow(['— Status: ISSUED', statusCounts['ISSUED'] || 0]);
  ws.addRow(['— Status: PARTIALLY_PAID', statusCounts['PARTIALLY_PAID'] || 0]);
  ws.addRow(['— Status: PAID', statusCounts['PAID'] || 0]);

  addCurrencyRow('Recognized Invoiced Subtotal (Gross)', recognizedSubtotal);
  addCurrencyRow('Recognized Document Discounts', recognizedDiscount);
  addCurrencyRow('Recognized Statutory GST Tax Amount', recognizedTax);
  addCurrencyRow('Total Net Recognized Sales Revenue (A)', recognizedRevenue);
  addCurrencyRow('Current Collections Applied to Period Invoices', recognizedPaid);
  addCurrencyRow('Current Active Accounts Receivable on Period Invoices', recognizedOutstanding);

  ws.addRow([]);

  // Section 3B: Non-Recognized Invoices
  const rNonRevH = ws.addRow(['3B. UNPOSTED & VOIDED INVOICES (EXCLUDED FROM RECOGNIZED REVENUE)']);
  rNonRevH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Draft Invoices (Unposted — 0 Recognized Sales, 0 Receivable)', draftCount]);
  addCurrencyRow('— Total Unposted Draft Value', draftTotal);
  ws.addRow(['Cancelled Invoices (Legally Voided — 0 Recognized Sales, 0 Receivable)', cancelledCount]);
  addCurrencyRow('— Total Cancelled Void Value', cancelledTotal);

  ws.addRow([]);

  // Section 4: Payment Receipts Reconciliation
  let totalCollected = 0;
  const methodTotals: Record<string, number> = {};
  const methodCounts: Record<string, number> = {};
  let totalAllocatedInReceipts = 0;

  for (const p of payments) {
    totalCollected += p.amount;
    methodTotals[p.paymentMethod] = (methodTotals[p.paymentMethod] || 0) + p.amount;
    methodCounts[p.paymentMethod] = (methodCounts[p.paymentMethod] || 0) + 1;

    if (p.allocations && p.allocations.length > 0) {
      for (const a of p.allocations) {
        totalAllocatedInReceipts += a.amountAllocated;
      }
    }
  }

  const rPayH = ws.addRow(['4. PAYMENT RECEIPTS & CASH COLLECTIONS RECONCILIATION']);
  rPayH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Total Payment Receipts in Selected Period', payments.length]);

  const standardMethods = ['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'];
  for (const m of standardMethods) {
    if (methodCounts[m]) {
      const row = ws.addRow([`— Method: ${m} (${methodCounts[m]} receipts)`, roundMoney(methodTotals[m] || 0)]);
      row.getCell(2).numFmt = INR_FORMAT;
    }
  }

  addCurrencyRow('Total Collections Received in Selected Period (B)', totalCollected);
  addCurrencyRow('Total Allocated to Invoices', totalAllocatedInReceipts);
  addCurrencyRow('Total Unallocated Advance Balance', Math.max(0, totalCollected - totalAllocatedInReceipts));

  ws.addRow([]);

  // Section 5: Authoritative Ledger Disclosures
  const rDiscH = ws.addRow(['5. STATUTORY AUDIT & RECONCILIATION DISCLOSURES']);
  rDiscH.getCell(1).font = SECTION_FONT;
  ws.addRow([
    'Period Isolation Notice',
    'Invoice totals reflect business dates (invoice_date) within the selected period. Payment receipts reflect collection dates (payment_date) within the selected period.',
  ]);
  ws.addRow([
    'Cross-Period Invariant',
    'Invoices issued in prior periods paid in this period appear in Total Collections (B). Invoices issued in this period paid in subsequent periods reflect partial or open outstanding receivables.',
  ]);
  ws.addRow([
    'Revenue Recognition Invariant',
    'Sales revenue and receivables authoritatively include only legally finalized invoices (ISSUED, PARTIALLY_PAID, PAID). Drafts and Cancelled invoices are strictly excluded.',
  ]);
  ws.addRow([
    'Statutory GST Component Disclosure',
    'Under Atlas OS database schema (Migrations 001–036), table invoice_items authoritatively records total tax_rate and line_tax snapshots at invoice creation. Discrete CGST, SGST, IGST components and Place of Supply were not stored as separate immutable columns at issuance. To prevent financial misrepresentation, component splits are marked as unrecorded/unverified.',
  ]);
  ws.addRow([
    'Customer Receivables State',
    'Current Collections and Current Outstanding Balance reflect cumulative authoritative ledger balances as of report generation date.',
  ]);
  ws.addRow([
    'Historical Snapshot Guarantee',
    'Product names, SKUs, HSN codes, unit prices, and statutory tax rates in this report are exact immutable snapshots recorded at invoice issuance.',
  ]);

  // Adjust column widths for Reconciliation sheet
  ws.getColumn(1).width = 52;
  ws.getColumn(2).width = 44;
}

/**
 * Builds the Invoice Summary Worksheet.
 */
function buildInvoiceSummarySheet(
  ws: ExcelJS.Worksheet,
  payload: WorkbookPayload
): void {
  const { organization: org, criteria, invoices } = payload;

  const columns = [
    { header: 'Organization Name', key: 'org_name', width: 24 },
    { header: 'Organization ID', key: 'org_id', width: 36 },
    { header: 'Invoice ID', key: 'invoice_id', width: 36 },
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 14 },
    { header: 'Due Date', key: 'due_date', width: 14 },
    { header: 'Customer ID', key: 'customer_id', width: 36 },
    { header: 'Customer Name', key: 'customer_name', width: 26 },
    { header: 'Company Name', key: 'company_name', width: 26 },
    { header: 'Customer GSTIN', key: 'customer_gstin', width: 18 },
    { header: 'Place of Supply (Current Master)', key: 'place_of_supply', width: 28 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Subtotal (₹)', key: 'subtotal', width: 16, numFmt: INR_FORMAT },
    { header: 'Discount (₹)', key: 'discount_amount', width: 15, numFmt: INR_FORMAT },
    { header: 'Tax Amount (₹)', key: 'tax_amount', width: 15, numFmt: INR_FORMAT },
    { header: 'Grand Total (₹)', key: 'total_amount', width: 16, numFmt: INR_FORMAT },
    { header: 'Current Paid (₹)', key: 'total_paid', width: 16, numFmt: INR_FORMAT },
    { header: 'Current Outstanding (₹)', key: 'balance', width: 22, numFmt: INR_FORMAT },
    { header: 'Order Reference', key: 'order_ref', width: 36 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];

  setupWorksheetHeader(ws, 'Invoice Summary', criteria, org, columns);

  let subtotalSum = 0;
  let discountSum = 0;
  let taxSum = 0;
  let totalSum = 0;
  let paidSum = 0;
  let outstandingSum = 0;

  for (const inv of invoices) {
    const cust = inv.customer;
    const pos = resolvePlaceOfSupply({ customer: cust, currentOrg: org });

    // Outstanding balance strictly applies to ISSUED or PARTIALLY_PAID
    let outstanding = 0;
    if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') {
      outstanding = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
    }

    subtotalSum += inv.subtotal;
    discountSum += inv.discountAmount;
    taxSum += inv.taxAmount;
    totalSum += inv.totalAmount;
    paidSum += inv.totalPaid;
    outstandingSum += outstanding;

    const row = ws.addRow({
      org_name: sanitizeExcelText(org.name),
      org_id: sanitizeExcelText(org.id),
      invoice_id: sanitizeExcelText(inv.id),
      invoice_number: sanitizeExcelText(inv.invoiceNumber),
      invoice_date: inv.invoiceDate,
      due_date: inv.dueDate,
      customer_id: sanitizeExcelText(inv.customerId),
      customer_name: sanitizeExcelText(cust?.name || 'Walk-in Customer'),
      company_name: sanitizeExcelText(cust?.companyName || '—'),
      customer_gstin: sanitizeExcelText(cust?.gstin || 'Unregistered'),
      place_of_supply: pos.placeOfSupply
        ? `${sanitizeExcelText(pos.placeOfSupply)} (Current Master)`
        : 'Not Recorded at Issuance',
      status: inv.status,
      subtotal: inv.subtotal,
      discount_amount: inv.discountAmount,
      tax_amount: inv.taxAmount,
      total_amount: inv.totalAmount,
      total_paid: inv.totalPaid,
      balance: outstanding,
      order_ref: sanitizeExcelText(inv.salesOrderId || '—'),
      notes: sanitizeExcelText(inv.notes || '—'),
    });

    // Formatting
    row.getCell('invoice_date').alignment = { horizontal: 'center' };
    row.getCell('due_date').alignment = { horizontal: 'center' };
    row.getCell('status').alignment = { horizontal: 'center' };
    row.getCell('subtotal').numFmt = INR_FORMAT;
    row.getCell('discount_amount').numFmt = INR_FORMAT;
    row.getCell('tax_amount').numFmt = INR_FORMAT;
    row.getCell('total_amount').numFmt = INR_FORMAT;
    row.getCell('total_paid').numFmt = INR_FORMAT;
    row.getCell('balance').numFmt = INR_FORMAT;

    for (let i = 1; i <= columns.length; i++) {
      row.getCell(i).border = THIN_BORDER;
    }
  }

  // Summary Row
  const totalRow = ws.addRow({
    org_name: 'TOTAL',
    invoice_number: `${invoices.length} Invoices`,
    subtotal: roundMoney(subtotalSum),
    discount_amount: roundMoney(discountSum),
    tax_amount: roundMoney(taxSum),
    total_amount: roundMoney(totalSum),
    total_paid: roundMoney(paidSum),
    balance: roundMoney(outstandingSum),
  });

  totalRow.font = TOTAL_FONT;
  totalRow.height = 22;

  for (let i = 1; i <= columns.length; i++) {
    const cell = totalRow.getCell(i);
    cell.fill = TOTAL_FILL;
    cell.border = TOTAL_BORDER;
  }

  totalRow.getCell('subtotal').numFmt = INR_FORMAT;
  totalRow.getCell('discount_amount').numFmt = INR_FORMAT;
  totalRow.getCell('tax_amount').numFmt = INR_FORMAT;
  totalRow.getCell('total_amount').numFmt = INR_FORMAT;
  totalRow.getCell('total_paid').numFmt = INR_FORMAT;
  totalRow.getCell('balance').numFmt = INR_FORMAT;
}

/**
 * Builds the Invoice Products Worksheet.
 * Exports every individual line item recorded on all matching invoices without omitting any products.
 * Authoritative: Total tax rate and total tax amount. Component splits are marked as unrecorded.
 */
function buildInvoiceProductsSheet(
  ws: ExcelJS.Worksheet,
  payload: WorkbookPayload
): void {
  const { organization: org, criteria, invoices } = payload;

  const columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 14 },
    { header: 'Invoice ID', key: 'invoice_id', width: 36 },
    { header: 'Product ID', key: 'product_id', width: 36 },
    { header: 'Product Name', key: 'product_name', width: 34 },
    { header: 'Product SKU', key: 'product_sku', width: 18 },
    { header: 'HSN Code', key: 'hsn_code', width: 14 },
    { header: 'UOM', key: 'uom', width: 10 },
    { header: 'Quantity', key: 'quantity', width: 12, numFmt: INT_FORMAT },
    { header: 'Unit Price (₹)', key: 'unit_price', width: 16, numFmt: INR_FORMAT },
    { header: 'Discount %', key: 'discount_percent', width: 14, numFmt: PCT_FORMAT },
    { header: 'Doc Discount Share (₹)', key: 'doc_discount_share', width: 22, numFmt: INR_FORMAT },
    { header: 'Taxable Amount (₹)', key: 'line_subtotal', width: 18, numFmt: INR_FORMAT },
    { header: 'Tax Rate %', key: 'tax_rate', width: 14, numFmt: PCT_FORMAT },
    { header: 'Tax Amount (₹)', key: 'line_tax', width: 16, numFmt: INR_FORMAT },
    { header: 'Line Total (₹)', key: 'line_total', width: 18, numFmt: INR_FORMAT },
    { header: 'GST Component Treatment', key: 'gst_treatment', width: 32 },
    { header: 'CGST Amount (₹)', key: 'cgst_amount', width: 18 },
    { header: 'SGST Amount (₹)', key: 'sgst_amount', width: 18 },
    { header: 'IGST Amount (₹)', key: 'igst_amount', width: 18 },
  ];

  setupWorksheetHeader(
    ws,
    'Invoice Products & Line Items',
    criteria,
    org,
    columns,
    'Statutory Notice: Line Tax Rate & Tax Amount are authoritative historical snapshots. Component breakdown (CGST/SGST/IGST) was not stored at issuance.'
  );

  let totalQty = 0;
  let totalDocDiscount = 0;
  let totalTaxable = 0;
  let totalTax = 0;
  let totalLineSum = 0;

  for (const inv of invoices) {
    const items = inv.items || [];
    for (const item of items) {
      totalQty += item.quantity;
      totalDocDiscount += item.documentDiscountShare || 0;
      totalTaxable += item.lineSubtotal;
      totalTax += item.lineTax;
      totalLineSum += item.lineTotal;

      const row = ws.addRow({
        invoice_number: sanitizeExcelText(inv.invoiceNumber),
        invoice_date: inv.invoiceDate,
        invoice_id: sanitizeExcelText(inv.id),
        product_id: sanitizeExcelText(item.productId || '—'),
        product_name: sanitizeExcelText(item.productName),
        product_sku: sanitizeExcelText(item.productSku),
        hsn_code: sanitizeExcelText(item.hsnCode || '—'),
        uom: sanitizeExcelText(item.uom),
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_percent: (item.discountPercent || 0) / 100,
        doc_discount_share: item.documentDiscountShare || 0,
        line_subtotal: item.lineSubtotal,
        tax_rate: (item.taxRate || 0) / 100,
        line_tax: item.lineTax,
        line_total: item.lineTotal,
        gst_treatment: 'Historical Component Split Not Stored',
        cgst_amount: 'Not Stored',
        sgst_amount: 'Not Stored',
        igst_amount: 'Not Stored',
      });

      row.getCell('invoice_date').alignment = { horizontal: 'center' };
      row.getCell('quantity').numFmt = INT_FORMAT;
      row.getCell('unit_price').numFmt = INR_FORMAT;
      row.getCell('discount_percent').numFmt = PCT_FORMAT;
      row.getCell('doc_discount_share').numFmt = INR_FORMAT;
      row.getCell('line_subtotal').numFmt = INR_FORMAT;
      row.getCell('tax_rate').numFmt = PCT_FORMAT;
      row.getCell('line_tax').numFmt = INR_FORMAT;
      row.getCell('line_total').numFmt = INR_FORMAT;
      row.getCell('gst_treatment').alignment = { horizontal: 'center' };
      row.getCell('cgst_amount').alignment = { horizontal: 'center' };
      row.getCell('sgst_amount').alignment = { horizontal: 'center' };
      row.getCell('igst_amount').alignment = { horizontal: 'center' };

      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).border = THIN_BORDER;
      }
    }
  }

  // Summary Row
  const totalRow = ws.addRow({
    invoice_number: 'TOTAL',
    product_name: `${invoices.length} Invoices`,
    quantity: totalQty,
    doc_discount_share: roundMoney(totalDocDiscount),
    line_subtotal: roundMoney(totalTaxable),
    line_tax: roundMoney(totalTax),
    line_total: roundMoney(totalLineSum),
    gst_treatment: 'Total Tax Authoritative',
    cgst_amount: '—',
    sgst_amount: '—',
    igst_amount: '—',
  });

  totalRow.font = TOTAL_FONT;
  totalRow.height = 22;

  for (let i = 1; i <= columns.length; i++) {
    const cell = totalRow.getCell(i);
    cell.fill = TOTAL_FILL;
    cell.border = TOTAL_BORDER;
  }

  totalRow.getCell('quantity').numFmt = INT_FORMAT;
  totalRow.getCell('doc_discount_share').numFmt = INR_FORMAT;
  totalRow.getCell('line_subtotal').numFmt = INR_FORMAT;
  totalRow.getCell('line_tax').numFmt = INR_FORMAT;
  totalRow.getCell('line_total').numFmt = INR_FORMAT;
}

/**
 * Builds the Payment Receipts Worksheet.
 */
function buildPaymentReceiptsSheet(
  ws: ExcelJS.Worksheet,
  payload: WorkbookPayload
): void {
  const { organization: org, criteria, payments } = payload;

  const columns = [
    { header: 'Receipt Number', key: 'payment_number', width: 18 },
    { header: 'Payment Date', key: 'payment_date', width: 14 },
    { header: 'Payment ID', key: 'payment_id', width: 36 },
    { header: 'Customer ID', key: 'customer_id', width: 36 },
    { header: 'Customer Name', key: 'customer_name', width: 26 },
    { header: 'Company Name', key: 'company_name', width: 26 },
    { header: 'Payment Mode', key: 'payment_method', width: 16 },
    { header: 'Reference / UTR #', key: 'reference_number', width: 22 },
    { header: 'Amount Received (₹)', key: 'amount', width: 20, numFmt: INR_FORMAT },
    { header: 'Total Allocated (₹)', key: 'total_allocated', width: 18, numFmt: INR_FORMAT },
    { header: 'Unallocated Balance (₹)', key: 'unallocated', width: 22, numFmt: INR_FORMAT },
    { header: 'Notes', key: 'notes', width: 30 },
  ];

  setupWorksheetHeader(ws, 'Payment Receipts', criteria, org, columns);

  let amountSum = 0;
  let allocatedSum = 0;
  let unallocatedSum = 0;

  for (const p of payments) {
    const cust = p.customer;
    let allocated = 0;
    if (p.allocations && p.allocations.length > 0) {
      for (const a of p.allocations) {
        allocated += a.amountAllocated;
      }
    }
    const unallocated = Math.max(0, p.amount - allocated);

    amountSum += p.amount;
    allocatedSum += allocated;
    unallocatedSum += unallocated;

    const row = ws.addRow({
      payment_number: sanitizeExcelText(p.paymentNumber),
      payment_date: p.paymentDate,
      payment_id: sanitizeExcelText(p.id),
      customer_id: sanitizeExcelText(p.customerId),
      customer_name: sanitizeExcelText(cust?.name || 'Walk-in Customer'),
      company_name: sanitizeExcelText(cust?.companyName || '—'),
      payment_method: p.paymentMethod,
      reference_number: sanitizeExcelText(p.referenceNumber || '—'),
      amount: p.amount,
      total_allocated: allocated,
      unallocated: unallocated,
      notes: sanitizeExcelText(p.notes || '—'),
    });

    row.getCell('payment_date').alignment = { horizontal: 'center' };
    row.getCell('payment_method').alignment = { horizontal: 'center' };
    row.getCell('amount').numFmt = INR_FORMAT;
    row.getCell('total_allocated').numFmt = INR_FORMAT;
    row.getCell('unallocated').numFmt = INR_FORMAT;

    for (let i = 1; i <= columns.length; i++) {
      row.getCell(i).border = THIN_BORDER;
    }
  }

  // Summary Row
  const totalRow = ws.addRow({
    payment_number: 'TOTAL',
    customer_name: `${payments.length} Receipts`,
    amount: roundMoney(amountSum),
    total_allocated: roundMoney(allocatedSum),
    unallocated: roundMoney(unallocatedSum),
  });

  totalRow.font = TOTAL_FONT;
  totalRow.height = 22;

  for (let i = 1; i <= columns.length; i++) {
    const cell = totalRow.getCell(i);
    cell.fill = TOTAL_FILL;
    cell.border = TOTAL_BORDER;
  }

  totalRow.getCell('amount').numFmt = INR_FORMAT;
  totalRow.getCell('total_allocated').numFmt = INR_FORMAT;
  totalRow.getCell('unallocated').numFmt = INR_FORMAT;
}

/**
 * Builds the Payment Allocations Worksheet.
 * Accurately displays linked invoice numbers and dates across both period
 * and cross-period invoices without omitting or duplicating amounts.
 */
function buildPaymentAllocationsSheet(
  ws: ExcelJS.Worksheet,
  payload: WorkbookPayload
): void {
  const { organization: org, criteria, payments, invoices } = payload;

  const columns = [
    { header: 'Allocation ID', key: 'allocation_id', width: 36 },
    { header: 'Receipt Number', key: 'receipt_number', width: 18 },
    { header: 'Payment ID', key: 'payment_id', width: 36 },
    { header: 'Payment Date', key: 'payment_date', width: 14 },
    { header: 'Payment Amount (₹)', key: 'payment_amount', width: 18, numFmt: INR_FORMAT },
    { header: 'Invoice Number', key: 'invoice_number', width: 18 },
    { header: 'Invoice Date', key: 'invoice_date', width: 14 },
    { header: 'Invoice ID', key: 'invoice_id', width: 36 },
    { header: 'Customer Name', key: 'customer_name', width: 26 },
    { header: 'Allocated Amount (₹)', key: 'amount_allocated', width: 18, numFmt: INR_FORMAT },
    { header: 'Allocation Timestamp', key: 'created_at', width: 22 },
  ];

  setupWorksheetHeader(ws, 'Payment Allocations', criteria, org, columns);

  // Index invoices for fast lookup
  const invMap = new Map<string, Invoice>();
  for (const inv of invoices) {
    invMap.set(inv.id, inv);
  }

  let totalAllocatedSum = 0;
  let count = 0;

  for (const p of payments) {
    const cust = p.customer;
    const allocations = p.allocations || [];

    for (const alloc of allocations) {
      count++;
      totalAllocatedSum += alloc.amountAllocated;

      // Check locally fetched invoices first, then fallback to cross-period referenced invoices map
      const linkedInv = alloc.invoice || invMap.get(alloc.invoiceId) || payload.referencedInvoices?.get(alloc.invoiceId);
      const invNum = linkedInv?.invoiceNumber || (alloc.invoiceId ? `Invoice ID: ${alloc.invoiceId.slice(0, 8)}` : '—');
      const invDate = linkedInv?.invoiceDate || '—';

      const row = ws.addRow({
        allocation_id: sanitizeExcelText(alloc.id),
        receipt_number: sanitizeExcelText(p.paymentNumber),
        payment_id: sanitizeExcelText(p.id),
        payment_date: p.paymentDate,
        payment_amount: p.amount,
        invoice_number: sanitizeExcelText(invNum),
        invoice_date: invDate,
        invoice_id: sanitizeExcelText(alloc.invoiceId),
        customer_name: sanitizeExcelText(cust?.name || 'Walk-in Customer'),
        amount_allocated: alloc.amountAllocated,
        created_at: alloc.createdAt ? formatDisplayDate(alloc.createdAt) : '—',
      });

      row.getCell('payment_date').alignment = { horizontal: 'center' };
      row.getCell('invoice_date').alignment = { horizontal: 'center' };
      row.getCell('payment_amount').numFmt = INR_FORMAT;
      row.getCell('amount_allocated').numFmt = INR_FORMAT;

      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).border = THIN_BORDER;
      }
    }
  }

  // Summary Row
  const totalRow = ws.addRow({
    allocation_id: 'TOTAL',
    receipt_number: `${count} Allocations`,
    amount_allocated: roundMoney(totalAllocatedSum),
  });

  totalRow.font = TOTAL_FONT;
  totalRow.height = 22;

  for (let i = 1; i <= columns.length; i++) {
    const cell = totalRow.getCell(i);
    cell.fill = TOTAL_FILL;
    cell.border = TOTAL_BORDER;
  }

  totalRow.getCell('amount_allocated').numFmt = INR_FORMAT;
}

/**
 * Authoritative Master Workbook Generator
 */
export async function generateSalesReceiptsWorkbook(
  payload: WorkbookPayload
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Atlas OS Business ERP';
  wb.lastModifiedBy = 'Atlas OS Financial Reporting Engine';
  wb.created = new Date();
  wb.modified = new Date();

  // 1. Reconciliation Sheet (always present)
  const wsRecon = wb.addWorksheet('Reconciliation', {
    views: [{ showGridLines: true }],
  });
  buildReconciliationSheet(wsRecon, payload);

  // 2. Invoice Summary Sheet (if ALL or INVOICES)
  if (payload.criteria.documentType === 'ALL' || payload.criteria.documentType === 'INVOICES') {
    const wsInvoices = wb.addWorksheet('Invoice Summary', {
      views: [{ showGridLines: true }],
    });
    buildInvoiceSummarySheet(wsInvoices, payload);

    // 3. Invoice Products Sheet (all line items)
    const wsProducts = wb.addWorksheet('Invoice Products', {
      views: [{ showGridLines: true }],
    });
    buildInvoiceProductsSheet(wsProducts, payload);
  }

  // 4. Payment Receipts Sheet (if ALL or PAYMENTS)
  if (payload.criteria.documentType === 'ALL' || payload.criteria.documentType === 'PAYMENTS') {
    const wsPayments = wb.addWorksheet('Payment Receipts', {
      views: [{ showGridLines: true }],
    });
    buildPaymentReceiptsSheet(wsPayments, payload);

    // 5. Payment Allocations Sheet
    const wsAllocations = wb.addWorksheet('Payment Allocations', {
      views: [{ showGridLines: true }],
    });
    buildPaymentAllocationsSheet(wsAllocations, payload);
  }

  // Generate binary XLSX buffer
  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/**
 * Browser file download trigger
 */
export function triggerExcelDownload(buffer: ArrayBuffer | Uint8Array, filename: string): void {
  const blobPart: BlobPart = buffer instanceof Uint8Array ? (buffer as Uint8Array<ArrayBuffer>) : buffer;
  const blob = new Blob([blobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
