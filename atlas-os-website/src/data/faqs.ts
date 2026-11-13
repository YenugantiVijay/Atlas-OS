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
    answer: 'Yes. Atlas OS features an enterprise multi-tenant architecture. Business owners managing multiple branch offices, partner firms, or distinct legal entities can switch seamlessly between organizations from a single account without data leakage. Each organization maintains its own isolated database scope, inventory catalog, customer ledgers, and GSTIN profiles.',
    category: 'Product & Features',
  },
  {
    id: 'gst-compliance',
    question: 'How does Atlas OS handle statutory Indian GST compliance?',
    answer: 'Atlas OS generates commercial tax invoices with verified Interstate (IGST) vs. Intrastate (CGST + SGST) place-of-supply logic based on the customer’s verified GSTIN state code. Invoices capture immutable historical tax rate snapshots, and our one-click reporting engine generates audit-ready Microsoft Excel workbooks for any statutory financial year (April 1 to March 31).',
    category: 'Product & Features',
  },
  {
    id: 'download-desktop-app',
    question: 'How can I download the Atlas OS Windows application?',
    answer: 'The official Atlas OS standalone Windows desktop installer is currently in active packaging development. We believe in 100% transparency: we do not publish fake installers or placeholder setup files. You can join the early release notification list on our Download page or request a live guided demonstration to access the web application.',
    category: 'Download & Deployment',
  },
  {
    id: 'system-requirements',
    question: 'What are the system requirements for Atlas OS?',
    answer: 'The cloud-connected web application runs smoothly in any modern web browser (Google Chrome, Microsoft Edge, Mozilla Firefox) on Windows, macOS, and Linux. The upcoming native Windows desktop application will support 64-bit Windows 10 and Windows 11 with a minimum of 4 GB RAM and 500 MB of disk space.',
    category: 'Download & Deployment',
  },
  {
    id: 'data-security',
    question: 'How is business and financial data protected?',
    answer: 'Atlas OS is built on PostgreSQL with Row Level Security (RLS) policies enforced directly at the database engine level. Every query is cryptographically bound to your verified organization tenant ID. We maintain granular 6-tier role permissions, complete audit logs of all inventory and financial adjustments, and zero public bucket exposure.',
    category: 'Security & Compliance',
  },
  {
    id: 'trial-availability',
    question: 'Is a free trial available?',
    answer: 'Atlas OS offers a seven-day trial for eligible businesses. Trial workspaces can print a customer receipt and review daily totals. Request a demo to see the two-copy receipt workflow.',
    category: 'Pricing & Trials',
  },
  {
    id: 'pricing-structure',
    question: 'How will Atlas OS be priced?',
    answer: 'Starter covers everyday shop workflows. Professional adds purchasing and supplier controls, and Enterprise Network is scoped by quote. The pricing page shows proposed launch prices. Request a demo to confirm terms.',
    category: 'Pricing & Trials',
  },
];
