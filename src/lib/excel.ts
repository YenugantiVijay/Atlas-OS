/**
 * Atlas OS — Professional Excel Reporting & Financial Workbook Engine
 *
 * Implements authoritative .xlsx generation with:
 * 1. Formula injection protection across all untrusted user-controlled text
 * 2. Multi-worksheet financial exports (Reconciliation, Invoice Summary, Invoice Products, Payment Receipts, Payment Allocations)
 * 3. Exact INR number and currency formatting
 * 4. Frozen headers, auto-filters, professional corporate styling
 * 5. Complete mathematical reconciliation across sheets
 */

import ExcelJS from 'exceljs';
import { Invoice, Payment, Organization, Customer } from '@/types';
import { roundMoney, calculateInvoiceBalance } from './money';
import { resolvePlaceOfSupply, findMatchingIndianState } from './gst';
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

export interface WorkbookPayload {
  organization: Organization;
  criteria: ReportCriteria;
  invoices: Invoice[];
  payments: Payment[];
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
  columns: Array<{ header: string; key: string; width: number; numFmt?: string }>
): void {
  // Title Block
  const titleRow = ws.addRow([`Atlas OS — ${title}`]);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.mergeCells(1, 1, 1, 6);

  const subRow = ws.addRow([
    `Organization: ${org.name || 'Business'} | Period: ${criteria.periodLabel} (${criteria.startDate} to ${criteria.endDate}) | Mode: ${
      criteria.isDemoMode ? 'DEMO MODE (Sample Data)' : 'Production Records'
    }`,
  ]);
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

  // Section 3: Invoices Reconciliation
  let totalInvoiceSubtotal = 0;
  let totalInvoiceDiscount = 0;
  let totalInvoiceTax = 0;
  let totalInvoiceAmount = 0;
  let totalInvoicePaid = 0;
  let totalInvoiceOutstanding = 0;

  const statusCounts: Record<string, number> = {
    DRAFT: 0,
    ISSUED: 0,
    PARTIALLY_PAID: 0,
    PAID: 0,
    CANCELLED: 0,
  };

  for (const inv of invoices) {
    statusCounts[inv.status] = (statusCounts[inv.status] || 0) + 1;
    totalInvoiceSubtotal += inv.subtotal;
    totalInvoiceDiscount += inv.discountAmount;
    totalInvoiceTax += inv.taxAmount;
    totalInvoiceAmount += inv.totalAmount;
    totalInvoicePaid += inv.totalPaid;
    totalInvoiceOutstanding += calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
  }

  const rInvH = ws.addRow(['3. INVOICES & REVENUE RECONCILIATION']);
  rInvH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Total Invoices Selected', invoices.length]);
  ws.addRow(['— Status: ISSUED', statusCounts['ISSUED'] || 0]);
  ws.addRow(['— Status: PARTIALLY_PAID', statusCounts['PARTIALLY_PAID'] || 0]);
  ws.addRow(['— Status: PAID', statusCounts['PAID'] || 0]);
  ws.addRow(['— Status: DRAFT', statusCounts['DRAFT'] || 0]);
  ws.addRow(['— Status: CANCELLED', statusCounts['CANCELLED'] || 0]);

  const addCurrencyRow = (label: string, val: number) => {
    const row = ws.addRow([label, roundMoney(val)]);
    row.getCell(2).numFmt = INR_FORMAT;
    row.getCell(2).font = { name: 'Segoe UI', size: 10, bold: true };
    return row;
  };

  addCurrencyRow('Total Invoiced Subtotal (Gross)', totalInvoiceSubtotal);
  addCurrencyRow('Total Document Discounts', totalInvoiceDiscount);
  addCurrencyRow('Total Statutory GST (Tax Amount)', totalInvoiceTax);
  addCurrencyRow('Total Invoiced Grand Total (A)', totalInvoiceAmount);
  addCurrencyRow('Total Current Amount Paid on Selected Invoices', totalInvoicePaid);
  addCurrencyRow('Total Current Outstanding Receivables on Selected Invoices', totalInvoiceOutstanding);

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

  const rPayH = ws.addRow(['4. PAYMENT RECEIPTS & COLLECTIONS RECONCILIATION']);
  rPayH.getCell(1).font = SECTION_FONT;
  ws.addRow(['Total Payment Receipts Selected', payments.length]);

  const standardMethods = ['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'];
  for (const m of standardMethods) {
    if (methodCounts[m]) {
      const row = ws.addRow([`— Method: ${m} (${methodCounts[m]} receipts)`, roundMoney(methodTotals[m] || 0)]);
      row.getCell(2).numFmt = INR_FORMAT;
    }
  }

  addCurrencyRow('Total Collections in Selected Period (B)', totalCollected);
  addCurrencyRow('Total Allocated to Invoices', totalAllocatedInReceipts);
  addCurrencyRow('Total Unallocated Collection Balance', Math.max(0, totalCollected - totalAllocatedInReceipts));

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
    'Invoices issued in prior periods paid in this period appear in collections. Invoices issued in this period paid in subsequent periods reflect partial or open outstanding balances.',
  ]);
  ws.addRow([
    'Customer Receivables State',
    'Current Amount Paid and Current Outstanding Balance reflect cumulative authoritative ledger balances as of report execution date.',
  ]);
  ws.addRow([
    'Payment Verification Notice',
    'Manually entered UPI, NEFT, and Bank Transfer entries represent merchant-recorded remittances. Bank-level settlement requires external bank statement match.',
  ]);
  ws.addRow([
    'Historical Snapshot Guarantee',
    'Product names, SKUs, HSN codes, unit prices, and statutory tax rates in this report are exact immutable snapshots recorded at invoice issuance.',
  ]);

  // Adjust column widths for Reconciliation sheet
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 40;
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
    { header: 'Place of Supply', key: 'place_of_supply', width: 20 },
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
    const outstanding = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);

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
      place_of_supply: sanitizeExcelText(pos.placeOfSupply || 'Unverified'),
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
    { header: 'GST Treatment', key: 'gst_treatment', width: 22 },
    { header: 'CGST Rate %', key: 'cgst_rate', width: 14, numFmt: PCT_FORMAT },
    { header: 'CGST Amount (₹)', key: 'cgst_amount', width: 16, numFmt: INR_FORMAT },
    { header: 'SGST Rate %', key: 'sgst_rate', width: 14, numFmt: PCT_FORMAT },
    { header: 'SGST Amount (₹)', key: 'sgst_amount', width: 16, numFmt: INR_FORMAT },
    { header: 'IGST Rate %', key: 'igst_rate', width: 14, numFmt: PCT_FORMAT },
    { header: 'IGST Amount (₹)', key: 'igst_amount', width: 16, numFmt: INR_FORMAT },
  ];

  setupWorksheetHeader(ws, 'Invoice Products & Line Items', criteria, org, columns);

  let totalQty = 0;
  let totalDocDiscount = 0;
  let totalTaxable = 0;
  let totalTax = 0;
  let totalLineSum = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const orgStateMatch = findMatchingIndianState(org.state);

  for (const inv of invoices) {
    const cust = inv.customer;
    const pos = resolvePlaceOfSupply({ customer: cust, currentOrg: org });

    // Determine GST jurisdiction
    let isIntraState = false;
    let isInterState = false;

    if (pos.isVerified && orgStateMatch) {
      if (pos.stateCode === orgStateMatch.code) {
        isIntraState = true;
      } else {
        isInterState = true;
      }
    }

    const items = inv.items || [];
    for (const item of items) {
      totalQty += item.quantity;
      totalDocDiscount += item.documentDiscountShare || 0;
      totalTaxable += item.lineSubtotal;
      totalTax += item.lineTax;
      totalLineSum += item.lineTotal;

      let gstTreatment = 'Unverified Place of Supply';
      let cgstRate: number | string = '—';
      let cgstAmt: number | string = '—';
      let sgstRate: number | string = '—';
      let sgstAmt: number | string = '—';
      let igstRate: number | string = '—';
      let igstAmt: number | string = '—';

      if (isIntraState) {
        gstTreatment = 'Intra-State (CGST + SGST)';
        const halfRate = item.taxRate / 2;
        const halfTax = roundMoney(item.lineTax / 2);
        const remTax = roundMoney(item.lineTax - halfTax);
        cgstRate = halfRate;
        cgstAmt = halfTax;
        sgstRate = halfRate;
        sgstAmt = remTax;
        igstRate = 0;
        igstAmt = 0;
        totalCgst += halfTax;
        totalSgst += remTax;
      } else if (isInterState) {
        gstTreatment = 'Inter-State (IGST)';
        cgstRate = 0;
        cgstAmt = 0;
        sgstRate = 0;
        sgstAmt = 0;
        igstRate = item.taxRate;
        igstAmt = item.lineTax;
        totalIgst += item.lineTax;
      }

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
        gst_treatment: gstTreatment,
        cgst_rate: typeof cgstRate === 'number' ? cgstRate / 100 : cgstRate,
        cgst_amount: cgstAmt,
        sgst_rate: typeof sgstRate === 'number' ? sgstRate / 100 : sgstRate,
        sgst_amount: sgstAmt,
        igst_rate: typeof igstRate === 'number' ? igstRate / 100 : igstRate,
        igst_amount: igstAmt,
      });

      row.getCell('invoice_date').alignment = { horizontal: 'center' };
      row.getCell('uom').alignment = { horizontal: 'center' };
      row.getCell('quantity').numFmt = INT_FORMAT;
      row.getCell('unit_price').numFmt = INR_FORMAT;
      row.getCell('discount_percent').numFmt = PCT_FORMAT;
      row.getCell('doc_discount_share').numFmt = INR_FORMAT;
      row.getCell('line_subtotal').numFmt = INR_FORMAT;
      row.getCell('tax_rate').numFmt = PCT_FORMAT;
      row.getCell('line_tax').numFmt = INR_FORMAT;
      row.getCell('line_total').numFmt = INR_FORMAT;

      if (typeof cgstRate === 'number') row.getCell('cgst_rate').numFmt = PCT_FORMAT;
      if (typeof cgstAmt === 'number') row.getCell('cgst_amount').numFmt = INR_FORMAT;
      if (typeof sgstRate === 'number') row.getCell('sgst_rate').numFmt = PCT_FORMAT;
      if (typeof sgstAmt === 'number') row.getCell('sgst_amount').numFmt = INR_FORMAT;
      if (typeof igstRate === 'number') row.getCell('igst_rate').numFmt = PCT_FORMAT;
      if (typeof igstAmt === 'number') row.getCell('igst_amount').numFmt = INR_FORMAT;

      for (let i = 1; i <= columns.length; i++) {
        row.getCell(i).border = THIN_BORDER;
      }
    }
  }

  // Summary Row
  const totalRow = ws.addRow({
    invoice_number: 'TOTAL',
    quantity: totalQty,
    doc_discount_share: roundMoney(totalDocDiscount),
    line_subtotal: roundMoney(totalTaxable),
    line_tax: roundMoney(totalTax),
    line_total: roundMoney(totalLineSum),
    cgst_amount: roundMoney(totalCgst),
    sgst_amount: roundMoney(totalSgst),
    igst_amount: roundMoney(totalIgst),
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
  totalRow.getCell('cgst_amount').numFmt = INR_FORMAT;
  totalRow.getCell('sgst_amount').numFmt = INR_FORMAT;
  totalRow.getCell('igst_amount').numFmt = INR_FORMAT;
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
    { header: 'Organization Name', key: 'org_name', width: 24 },
    { header: 'Receipt ID', key: 'receipt_id', width: 36 },
    { header: 'Receipt Number', key: 'receipt_number', width: 18 },
    { header: 'Payment Date', key: 'payment_date', width: 14 },
    { header: 'Customer ID', key: 'customer_id', width: 36 },
    { header: 'Customer Name', key: 'customer_name', width: 26 },
    { header: 'Payment Amount (₹)', key: 'amount', width: 18, numFmt: INR_FORMAT },
    { header: 'Payment Method', key: 'payment_method', width: 18 },
    { header: 'Reference / UTR', key: 'reference_number', width: 22 },
    { header: 'Verification Status', key: 'verification_status', width: 32 },
    { header: 'Total Allocated (₹)', key: 'total_allocated', width: 18, numFmt: INR_FORMAT },
    { header: 'Unallocated (₹)', key: 'unallocated', width: 18, numFmt: INR_FORMAT },
    { header: 'Linked Invoices', key: 'linked_invoices', width: 28 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Created Timestamp', key: 'created_at', width: 22 },
  ];

  setupWorksheetHeader(ws, 'Payment Receipts', criteria, org, columns);

  let totalCollected = 0;
  let totalAllocated = 0;
  let totalUnallocated = 0;

  for (const p of payments) {
    const cust = p.customer;
    let allocatedSum = 0;
    const invoiceNums: string[] = [];

    if (p.allocations && p.allocations.length > 0) {
      for (const a of p.allocations) {
        allocatedSum += a.amountAllocated;
        if (a.invoice?.invoiceNumber) {
          invoiceNums.push(a.invoice.invoiceNumber);
        }
      }
    }

    const unallocated = Math.max(0, p.amount - allocatedSum);

    totalCollected += p.amount;
    totalAllocated += allocatedSum;
    totalUnallocated += unallocated;

    const row = ws.addRow({
      org_name: sanitizeExcelText(org.name),
      receipt_id: sanitizeExcelText(p.id),
      receipt_number: sanitizeExcelText(p.paymentNumber),
      payment_date: p.paymentDate,
      customer_id: sanitizeExcelText(p.customerId),
      customer_name: sanitizeExcelText(cust?.name || 'Walk-in Customer'),
      amount: p.amount,
      payment_method: p.paymentMethod,
      reference_number: sanitizeExcelText(p.referenceNumber || '—'),
      verification_status: 'Merchant Recorded Remittance',
      total_allocated: allocatedSum,
      unallocated: unallocated,
      linked_invoices: invoiceNums.length > 0 ? invoiceNums.join(', ') : '—',
      notes: sanitizeExcelText(p.notes || '—'),
      created_at: p.createdAt ? formatDisplayDate(p.createdAt) : '—',
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
    org_name: 'TOTAL',
    receipt_number: `${payments.length} Receipts`,
    amount: roundMoney(totalCollected),
    total_allocated: roundMoney(totalAllocated),
    unallocated: roundMoney(totalUnallocated),
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

      const linkedInv = alloc.invoice || invMap.get(alloc.invoiceId);
      const invNum = linkedInv?.invoiceNumber || '—';

      const row = ws.addRow({
        allocation_id: sanitizeExcelText(alloc.id),
        receipt_number: sanitizeExcelText(p.paymentNumber),
        payment_id: sanitizeExcelText(p.id),
        payment_date: p.paymentDate,
        payment_amount: p.amount,
        invoice_number: sanitizeExcelText(invNum),
        invoice_id: sanitizeExcelText(alloc.invoiceId),
        customer_name: sanitizeExcelText(cust?.name || 'Walk-in Customer'),
        amount_allocated: alloc.amountAllocated,
        created_at: alloc.createdAt ? formatDisplayDate(alloc.createdAt) : '—',
      });

      row.getCell('payment_date').alignment = { horizontal: 'center' };
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
    const wsReceipts = wb.addWorksheet('Payment Receipts', {
      views: [{ showGridLines: true }],
    });
    buildPaymentReceiptsSheet(wsReceipts, payload);

    // 5. Payment Allocations Sheet
    const wsAlloc = wb.addWorksheet('Payment Allocations', {
      views: [{ showGridLines: true }],
    });
    buildPaymentAllocationsSheet(wsAlloc, payload);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

/**
 * Triggers browser download of generated spreadsheet buffer.
 */
export function triggerExcelDownload(
  buffer: ArrayBuffer | Uint8Array,
  filename: string
): void {
  const blobPart: BlobPart = buffer instanceof Uint8Array ? (buffer as Uint8Array<ArrayBuffer>) : buffer;
  const blob = new Blob([blobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
