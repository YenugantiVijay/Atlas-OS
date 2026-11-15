import { BookOpen, Boxes, Calculator, ClipboardList, Download, FileText, Globe, HelpCircle, Info, Mail, Receipt, Search, ShieldCheck, Sigma, Truck } from 'lucide-react';

const link = (label: string, href: string, Icon: typeof BookOpen, hue = '#0f766e') => ({ label, href, Icon, hue });
const calculator = link('GST calculator', '/gst-calculator/', Calculator);
const receipts = link('Receipt templates', '/receipt-templates', Receipt, '#a21caf');
const hsn = link('HSN and SAC guidance', 'https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_HSN_SAC_Tax_Rates.htm', Search, '#1d4ed8');

export const RESOURCE_GROUPS = [
  { label: 'Guides', links: [
    link('Inventory workflows', '/features#inventory', Boxes),
    link('GST invoicing', '/features#invoicing', FileText, '#1d4ed8'),
    link('Industry guides', '/solutions/', BookOpen, '#6d28d9'),
  ] },
  { label: 'Tools & templates', links: [
    link('Atlas Calculators', '/calculators/', Calculator),
    receipts,
    link('E-way bill worksheet', '/calculators/eway-bill-template/', Truck, '#b45309'),
  ] },
  { label: 'Support', links: [
    link('Download center', '/download', Download, '#1d4ed8'),
    link('Help center & FAQs', '/support', HelpCircle),
    link('Contact team', '/contact', Mail, '#6d28d9'),
  ] },
  { label: 'Atlas OS', links: [
    link('Resource directory', '/resources/', ClipboardList, '#1d4ed8'),
    link('Security & architecture', '/security', ShieldCheck, '#15803d'),
    link('About Atlas OS', '/about', Info, '#6d28d9'),
  ] },
];

export const GST_GROUPS = [
  { label: 'Calculators', links: [calculator, link('How the calculation works', '/gst-calculator/#formulas', Sigma, '#6d28d9'),
    link('Input tax credit calculator', '/calculators/input-tax-credit/', Calculator, '#6d28d9')] },
  { label: 'Billing & transport', links: [link('GST invoicing', '/features#invoicing', FileText, '#1d4ed8'), receipts,
    link('E-way bill worksheet', '/calculators/eway-bill-template/', Truck, '#b45309')] },
  { label: 'Rates & codes', links: [hsn, link('CBIC rates and schedules', 'https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html', BookOpen, '#b45309'),
    link('Vendor GSTIN format check', '/calculators/gstin-check/', ShieldCheck, '#15803d')] },
  { label: 'Official portals & guides', links: [link('GST portal', 'https://www.gst.gov.in/', Globe, '#1d4ed8'),
    link('E-way bill portal', 'https://ewaybillgst.gov.in/', Truck, '#b45309'),
    link('GSTR-2B guidance', 'https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm', BookOpen, '#6d28d9')] },
];
