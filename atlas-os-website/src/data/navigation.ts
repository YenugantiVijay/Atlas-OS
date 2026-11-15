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

export const industryHref = (id: string) => `/solutions/${id}/`;

export const INDUSTRY_NAVIGATION = [
  {
    icon: 'electrical',
    label: 'Electrical Distributors',
    href: industryHref('electrical'),
    description: 'Wires, switchgear, conduits, and contractor credit ledgers.',
  },
  {
    icon: 'electronics',
    label: 'Electronics Wholesalers',
    href: industryHref('electronics'),
    description: 'High-precision SKU tracking and rapid order fulfillment.',
  },
  {
    icon: 'hardware',
    label: 'Hardware & Tools',
    href: industryHref('hardware'),
    description: 'Industrial fasteners, building materials, and multi-UOM stocks.',
  },
  {
    icon: 'retail',
    label: 'Retail & Wholesale Counters',
    href: industryHref('retail-wholesale'),
    description: 'Draft orders at the counter and reconcile cash and UPI collections.',
  },
  { icon: 'agriculture', label: 'Fertilizers & Agri Inputs', href: industryHref('agricultural-inputs'), description: 'Receive stock by bag and track supplier rates and credit customers.' },
  { icon: 'shop', label: 'Small Shops', href: industryHref('small-business'), description: 'Stock, sales, invoices and payment receipts for everyday trade.' },
] as const;

export const MAIN_NAVIGATION = [
  {
    label: 'Product',
    href: '/product',
  },
  { label: 'Industries', href: '/solutions' },
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
      { label: 'Receipt Templates', href: '/receipt-templates', description: 'Preview a customer receipt with your own branding.' },
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
  { label: 'GST', href: '/gst-calculator' },
  { label: 'Resources', href: '/resources' },
];

export const FOOTER_SECTIONS = [
  { title: 'Product', links: [
    { label: 'Product overview', href: '/product' },
    { label: 'Feature directory', href: '/features' },
    { label: 'Inventory control', href: '/features#inventory' },
    { label: 'GST invoicing', href: '/features#invoicing' },
    { label: 'Pricing plans', href: '/pricing' },
    { label: 'Download center', href: '/download' },
  ] },
  { title: 'Industries', links: INDUSTRY_NAVIGATION.map(({ label, href }) => ({ label, href })) },
  { title: 'Resources', links: [
    { label: 'Resource directory', href: '/resources/' },
    { label: 'Atlas Calculators', href: '/calculators/' },
    { label: 'GST Calculator', href: '/gst-calculator/' },
    { label: 'Receipt templates', href: '/receipt-templates' },
    { label: 'E-way bill worksheet', href: '/calculators/eway-bill-template/' },
  ] },
  { title: 'Company & support', links: [
    { label: 'About Atlas OS', href: '/about' },
    { label: 'Security architecture', href: '/security' },
    { label: 'Help center & FAQs', href: '/support' },
    { label: 'Contact us', href: '/contact' },
    { label: 'Request a demo', href: '/request-demo' },
  ] },
];
