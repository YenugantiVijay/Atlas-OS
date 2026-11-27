import type { FaqItem } from '../types';

export const FAQS: FaqItem[] = [
  {
    id: 'what-is-atlas-os',
    question: 'What is Atlas OS?',
    answer: 'Atlas OS brings inventory, sales orders, GST invoices, customer balances, payments, and reporting into one workspace for retailers, wholesalers, and distributors.',
    category: 'General',
  },
  {
    id: 'target-audience',
    question: 'Who is Atlas OS designed for?',
    answer: 'Atlas OS supports common inventory, sales, and collection workflows for small shops, general wholesalers, agri-input distributors, hardware suppliers, and electrical and electronics businesses.',
    category: 'General',
  },
  {
    id: 'wholesale-and-retail',
    question: 'Can I use Atlas OS for both wholesale and retail operations?',
    answer: 'Yes. Retail Counter creates draft orders from your catalog for existing customers. Invoices and collections have dedicated screens. Open a recorded payment to print its receipt, then review collections by payment method at the end of the day.',
    category: 'Product & Features',
  },
  {
    id: 'multi-org-support',
    question: 'Does Atlas OS support multiple business organizations?',
    answer: 'Yes. Atlas OS features an enterprise multi-tenant architecture. Business owners can switch between organizations they have access to from a single account. Each organization maintains its own isolated database scope, inventory catalog, customer ledgers, and GSTIN profiles.',
    category: 'Product & Features',
  },
  {
    id: 'gst-compliance',
    question: 'How does Atlas OS handle statutory Indian GST compliance?',
    answer: 'Atlas OS calculates invoice tax totals using decimal-safe arithmetic. The GST calculator shows CGST plus SGST/UTGST for a selected local supply, or IGST for an inter-state supply. Correct classification depends on the actual transaction and place of supply; SEZ, import/export and other special cases need separate review. Historical records do not always contain separate component snapshots, and a GSTIN format match is not GST-portal verification. Atlas OS does not currently file GST returns or register live e-invoices/e-way bills.',
    category: 'Product & Features',
  },
  {
    id: 'download-desktop-app',
    question: 'How can I download the Atlas OS Windows application?',
    answer: 'Use the Installation Centre to install the web application through Chrome or Edge, or continue online. The PWA is online-first. Native Windows installers are planned and are not available for download.',
    category: 'Download & Deployment',
  },
  {
    id: 'system-requirements',
    question: 'What are the system requirements for Atlas OS?',
    answer: 'Use a current Chrome or Microsoft Edge browser for installation, with JavaScript, browser storage and internet access for business operations. Other browsers can use the online site where compatible. Native desktop/mobile applications are planned; their hardware requirements have not been established.',
    category: 'Download & Deployment',
  },
  {
    id: 'data-security',
    question: 'How is business and financial data protected?',
    answer: 'Atlas OS is built on PostgreSQL with Row Level Security (RLS) policies enforced directly at the database engine level. The app uses organization-scoped policies and role checks for business data. Audit events cover supported workflows. See the Security page for details on access controls and deployment settings.',
    category: 'Security & Compliance',
  },
  {
    id: 'trial-availability',
    question: 'Is a free trial available?',
    answer: 'Request a walkthrough to ask about trial availability and the receipt features included in each plan.',
    category: 'Pricing & Trials',
  },
  {
    id: 'pricing-structure',
    question: 'How will Atlas OS be priced?',
    answer: 'Atlas Sprout covers shop billing and drawer closing. Atlas Stride adds goods receiving, purchasing and supplier price history. Atlas Summit is planned for multi-branch businesses. Request a demo to confirm the proposed terms.',
    category: 'Pricing & Trials',
  },
];
