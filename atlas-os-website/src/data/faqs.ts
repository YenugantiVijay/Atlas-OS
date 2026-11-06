import type { FaqItem } from '../types';

export const FAQS: FaqItem[] = [
  {
    id: 'what-is-atlas-os',
    question: 'What is Atlas OS?',
    answer: 'Atlas OS is a modern, AI-native business operating system specifically engineered for electrical, electronics, and hardware distributors, wholesalers, and retailers. It unifies inventory control, commercial sales orders, statutory GST invoicing, customer receivables ledgers, payment settlement allocations, and financial reporting into one connected, lightning-fast workspace.',
    category: 'General',
  },
  {
    id: 'target-audience',
    question: 'Who is Atlas OS designed for?',
    answer: 'Atlas OS is initially focused on electrical wholesale distributors, electronics component dealers, hardware and tool merchants, and combined retail-wholesale trade counters. Its workflows are tailored specifically around real commercial distribution challenges: managing thousands of technical SKUs, volatile pricing, multi-UOM packaging (Coils, Meters, Bundles), contractor credit limits, and complex payment allocations.',
    category: 'General',
  },
  {
    id: 'wholesale-and-retail',
    question: 'Can I use Atlas OS for both wholesale and retail operations?',
    answer: 'Atlas OS currently provides sales orders, customer accounts, invoices, inventory and payment tracking for distributor workflows. A dedicated fast retail counter, walk-in checkout and advanced credit policies are planned, and are not yet part of a verified retail release.',
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
    answer: 'Yes. Our commercial model includes a complimentary 7-day trial of Atlas OS upon general availability, allowing distributors to test all operational workflows with zero initial payment details required. Contact our sales team via the Request Demo page to receive priority onboarding access.',
    category: 'Pricing & Trials',
  },
  {
    id: 'pricing-structure',
    question: 'How will Atlas OS be priced?',
    answer: 'We are preparing Atlas Essentials for everyday shop workflows and Atlas Professional for more involved distribution workflows. Pricing, commercial entitlements and purchase options are not live yet. The current Simple View / Full Navigation selector changes menu layout only, not subscription access.',
    category: 'Pricing & Trials',
  },
];
