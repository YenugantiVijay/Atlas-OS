import { ArrowLeftRight, Banknote, Boxes, Calculator, ClipboardList, Landmark, Receipt, ShieldCheck, TrendingUp } from 'lucide-react';

const field = (name: string, label: string, example: string) => ({ name, label, example });
export const CALCULATORS = [
  { id: 'gst', label: 'GST Calculator', description: 'Add or remove GST and see the tax split for your supply type.', Icon: Receipt, hue: '#0f766e', href: '/gst-calculator/' },
  { id: 'income-tax', label: 'Income Tax Calculator', description: 'Compare old and new regime estimates for 2025–26 and 2026–27.', Icon: Landmark, hue: '#1d4ed8',
    note: 'For resident individuals under 60 with ordinary slab-rate taxable income up to ₹50 lakh. Enter separate taxable incomes after applicable deductions. The estimate includes applicable rebate or marginal relief and cess. Special-rate income, interest and penalties are outside this estimate.',
    fields: [field('oldIncome','Old regime taxable income (₹)','1000000'), field('newIncome','New regime taxable income (₹)','1000000')] },
  { id: 'gstin-check', label: 'Vendor GSTIN Format Check', description: 'Check the standard GSTIN format, then verify the vendor on the GST portal.', Icon: ShieldCheck, hue: '#15803d',
    note: 'This checks the character pattern only. Use Search Taxpayer on the GST portal to verify registration status and business details.',
    reference: 'https://services.gst.gov.in/services/searchtp',
    fields: [field('gstin','Vendor GSTIN','')] },
  { id: 'input-tax-credit', label: 'Input Tax Credit Calculator', description: 'Total the GST credit you have confirmed as eligible and subtract reversals.', Icon: ArrowLeftRight, hue: '#7c3aed',
    note: 'Enter confirmed eligible amounts for the period. The calculator does not determine eligibility or offset credit against output tax.',
    reference: 'https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm',
    fields: [field('igst','Eligible IGST (₹)','2000'), field('cgst','Eligible CGST (₹)','1500'), field('regional','Eligible SGST / UTGST (₹)','1500'), field('reversals','Credit reversals (₹)','500')] },
  { id: 'profit-margin', label: 'Profit Margin Calculator', description: 'Find gross profit, margin, and markup from cost and selling price.', Icon: TrendingUp, hue: '#0f766e',
    note: 'Enter both amounts on the same basis, such as excluding GST. The calculator uses gross profit divided by sales for margin and gross profit divided by cost for markup.',
    fields: [field('cost','Cost (₹)','800'), field('sale','Selling price (₹)','1000')] },
  { id: 'emi', label: 'EMI Calculator', description: 'Estimate a loan’s monthly payment, total interest, and total repayment.', Icon: Banknote, hue: '#b45309',
    note: 'This estimate assumes a fixed annual rate, monthly payments, and no fees or prepayments. Lender schedules may differ.',
    fields: [field('principal','Principal (₹)','100000'), field('interest','Annual interest rate (%)','12'), field('months','Loan term (months)','12')] },
  { id: 'inventory-turnover', label: 'Inventory Turnover Calculator', description: 'Compare annual cost of goods sold with average stock value.', Icon: Boxes, hue: '#0369a1',
    note: 'Use annual COGS and opening and closing inventory at cost for the same period. Days of inventory uses a 365-day year.',
    fields: [field('opening','Opening inventory (₹)','50000'), field('closing','Closing inventory (₹)','70000'), field('cogs','Annual cost of goods sold (₹)','360000')] },
  { id: 'annual-tax-balance', label: 'Annual Tax Balance Calculator', description: 'Compare assessed tax with TDS, advance tax, and self-assessment payments.', Icon: Calculator, hue: '#6d28d9',
    note: 'Enter assessed liability and recorded payments for the same year. Excess paid is an estimate from your inputs.',
    fields: [field('liability','Assessed tax liability (₹)','80000'), field('tds','TDS / TCS (₹)','55000'), field('advance','Advance tax (₹)','15000'), field('selfAssessment','Self-assessment payment (₹)','0')] },
  { id: 'eway-bill-template', label: 'E-Way Bill Worksheet', description: 'Prepare invoice, shipment, and transport details in a printable worksheet.', Icon: ClipboardList, hue: '#be185d',
    note: 'Use this worksheet to collect details before generating the official e-way bill on the government portal.',
    reference: 'https://ewaybillgst.gov.in/',
    fields: [field('document','Invoice / challan number',''),field('date','Document date',''),field('supplier','Supplier GSTIN',''),field('recipient','Recipient GSTIN',''),field('dispatch','Dispatch address and PIN code',''),field('delivery','Delivery address and PIN code',''),field('items','Goods, HSN codes, quantities and values',''),field('transport','Transporter ID / vehicle number',''),field('distance','Approximate distance (km)','')] },
] as const;

export const calculatorHref = (tool: (typeof CALCULATORS)[number]) => 'href' in tool ? tool.href : `/calculators/${tool.id}/`;
