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

export const FEATURED_INDUSTRIES = [
  {
    icon: 'retail',
    label: 'Retail & Wholesale Counters',
    href: industryHref('retail-wholesale'),
    description: 'Bill customers and reconcile cash and UPI collections.',
  },
  {
    icon: 'shop',
    label: 'Small Shops & General Trade',
    href: industryHref('small-business'),
    description: 'Track stock, everyday sales, invoices, and receipts.',
  },
  {
    icon: 'electrical',
    label: 'Electrical Distributors',
    href: industryHref('electrical'),
    description: 'Track wires, switchgear, and conduits, and manage contractor balances.',
  },
  {
    icon: 'hardware',
    label: 'Hardware & Tools',
    href: industryHref('hardware'),
    description: 'Manage fasteners, building supplies, and stock sold in different units.',
  },
  {
    icon: 'electronics',
    label: 'Electronics Wholesalers',
    href: industryHref('electronics'),
    description: 'Find component SKUs, check stock, and fulfil wholesale orders.',
  },
  {
    icon: 'ecommerce',
    label: 'E-commerce & Online Sellers',
    href: industryHref('ecommerce'),
    description: 'Record online orders and track stock, invoices, and collections.',
  },
] as const;

export const INDUSTRY_NAVIGATION = [
  ...FEATURED_INDUSTRIES,
  { icon: 'agriculture', label: 'Fertilizers & Agri Inputs', href: industryHref('agricultural-inputs'), description: 'Receive stock by bag and track supplier rates and credit customers.' },
  { icon: 'printer', label: 'Banner & Print Studio', href: industryHref('banner-print-studio'), description: 'Manage quotes, proof approvals and print deadlines.' },
  { icon: 'icecreamcone', label: 'Ice Cream Stalls', href: industryHref('ice-cream-stalls'), description: 'Serve packaged items and scoops, then reconcile the stall.' },
  { icon: 'snowflake', label: 'Ice Cream Distribution', href: industryHref('ice-cream-distribution'), description: 'Track bulk cases from factory receipt to return.' },
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
    { label: 'Invoice Formats', href: '/invoice-formats/' },
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
