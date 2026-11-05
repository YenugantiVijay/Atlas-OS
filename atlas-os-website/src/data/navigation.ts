export interface NavLink {
  label: string;
  href: string;
  badge?: string;
  description?: string;
}

export interface NavDropdown {
  label: string;
  items: NavLink[];
}

export const MAIN_NAVIGATION = [
  {
    label: 'Product',
    href: '/product',
  },
  {
    label: 'Solutions',
    href: '/solutions',
    dropdown: [
      {
        label: 'Electrical Distributors',
        href: '/solutions#electrical',
        description: 'Wires, switchgear, conduits, and contractor credit ledgers.',
      },
      {
        label: 'Electronics Wholesalers',
        href: '/solutions#electronics',
        description: 'High-precision SKU tracking and rapid order fulfillment.',
      },
      {
        label: 'Hardware & Tools',
        href: '/solutions#hardware',
        description: 'Industrial fasteners, building materials, and multi-UOM stocks.',
      },
      {
        label: 'Retail & Wholesale Counters',
        href: '/solutions#retail-wholesale',
        description: 'Unified counter billing for cash, UPI, and credit accounts.',
      },
    ],
  },
  {
    label: 'Features',
    href: '/features',
    dropdown: [
      {
        label: 'Precision Inventory',
        href: '/features#inventory',
        description: 'Multi-UOM tracking with complete stock movement auditing.',
      },
      {
        label: 'Commercial Invoicing',
        href: '/features#invoicing',
        description: 'Authoritative GST calculations and interstate tax logic.',
      },
      {
        label: 'Customer Receivables',
        href: '/features#customers',
        description: 'Real-time contractor credit limits and aging balances.',
      },
      {
        label: 'Payment Allocations',
        href: '/features#payments',
        description: 'Multi-invoice settlement against RTGS/NEFT receipts.',
      },
      {
        label: 'Excel Reporting Engine',
        href: '/features#reports',
        description: 'Audit-ready multi-tab .xlsx workbooks in one click.',
      },
      {
        label: 'Multi-Tenant Security',
        href: '/features#security',
        description: 'PostgreSQL Row Level Security and 6-tier role access.',
      },
    ],
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
  {
    label: 'Resources',
    href: '/support',
    dropdown: [
      {
        label: 'Help Center & FAQs',
        href: '/support',
        description: 'Answers to common questions regarding workflows and access.',
      },
      {
        label: 'Security & Architecture',
        href: '/security',
        description: 'Verified PostgreSQL RLS, role isolation, and audit policies.',
      },
      {
        label: 'About Atlas OS',
        href: '/about',
        description: 'Our mission to simplify business software for distributors.',
      },
      {
        label: 'Contact Team',
        href: '/contact',
        description: 'Speak directly with our product and technical team.',
      },
    ],
  },
  {
    label: 'Download',
    href: '/download',
    badge: 'Desktop',
  },
];

export const FOOTER_SECTIONS = [
  {
    title: 'Product & Capabilities',
    links: [
      { label: 'Product Overview', href: '/product' },
      { label: 'Feature Directory', href: '/features' },
      { label: 'Inventory Control', href: '/features#inventory' },
      { label: 'GST Tax Invoicing', href: '/features#invoicing' },
      { label: 'Customer Receivables', href: '/features#customers' },
      { label: 'Payment Settlement', href: '/features#payments' },
      { label: 'Excel Reporting Engine', href: '/features#reports' },
    ],
  },
  {
    title: 'Industry Solutions',
    links: [
      { label: 'Electrical Distributors', href: '/solutions#electrical' },
      { label: 'Electronics Wholesalers', href: '/solutions#electronics' },
      { label: 'Hardware Merchants', href: '/solutions#hardware' },
      { label: 'Retail-Wholesale Trade Counters', href: '/solutions#retail-wholesale' },
      { label: 'Request Custom Workflow', href: '/request-demo' },
    ],
  },
  {
    title: 'Software & Platform',
    links: [
      { label: 'Download Center', href: '/download' },
      { label: 'Windows Desktop Status', href: '/download#status' },
      { label: 'System Requirements', href: '/download#requirements' },
      { label: 'Release Notes', href: '/download#notes' },
      { label: 'SaaS Pricing Plans', href: '/pricing' },
      { label: '7-Day Commercial Trial', href: '/pricing#trial' },
    ],
  },
  {
    title: 'Security & Company',
    links: [
      { label: 'Security Architecture', href: '/security' },
      { label: 'Row Level Security (RLS)', href: '/security#rls' },
      { label: 'Audit Logging Integrity', href: '/security#audit' },
      { label: 'About Atlas OS', href: '/about' },
      { label: 'Product Philosophy', href: '/about#philosophy' },
      { label: 'Support & FAQs', href: '/support' },
      { label: 'Contact Us', href: '/contact' },
    ],
  },
];
