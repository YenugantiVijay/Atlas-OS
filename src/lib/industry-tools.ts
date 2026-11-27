export const INDUSTRY_TOOLS = {
  school: {
    name: 'School Management', headline: 'Students, attendance and school fees',
    description: 'Set up academic years and classes, manage admissions, mark attendance and record school fee receipts.',
    category: 'school', primary: { label: 'Open School', path: '/school' },
    tasks: [{ label: 'School workspace', detail: 'School setup, students, admissions, attendance and fee reports.', path: '/school' }],
  },
  electrical: {
    name: 'Electrical Distribution',
    headline: 'Sales & Inventory',
    description: 'Create quotes, check stock, and track payments.',
    category: 'electrical_wholesale_distributor',
    primary: { label: 'New Quotation', path: '/quotations?action=create' },
    tasks: [
      { label: 'Contractor quotes', detail: 'Prepare quotes and convert approved work into orders.', path: '/quotations' },
      { label: 'Available stock', detail: 'Check on-hand quantities and movement history.', path: '/inventory' },
      { label: 'Receivables', detail: 'Review outstanding balances and collections.', path: '/payments' },
    ],
  },
  electronics: {
    name: 'Electronics Wholesale',
    headline: 'Manage a parts catalogue and wholesale orders',
    description: 'Find components by SKU, confirm available quantities, and follow wholesale orders through billing.',
    category: 'electronics_trade',
    primary: { label: 'New Sales Order', path: '/orders?action=create' },
    tasks: [
      { label: 'Parts catalogue', detail: 'Find components by SKU and review pricing.', path: '/products' },
      { label: 'Wholesale orders', detail: 'Check order quantities before confirming stock.', path: '/orders' },
      { label: 'Goods receiving', detail: 'Record incoming cartons and loose units.', path: '/receiving' },
    ],
  },
  hardware: {
    name: 'Hardware & Tools',
    headline: 'Receive, track and quote hardware stock',
    description: 'Track fasteners, tools and building supplies with product-specific units, goods receipts and trade quotations.',
    category: 'hardware_trade',
    primary: { label: 'New Quotation', path: '/quotations?action=create' },
    tasks: [
      { label: 'Goods receiving', detail: 'Record incoming packs and loose quantities.', path: '/receiving' },
      { label: 'Stock movements', detail: 'Trace incoming stock, sales and adjustments.', path: '/inventory' },
      { label: 'Trade quotations', detail: 'Price materials for contractors and trade buyers.', path: '/quotations' },
    ],
  },
  'retail-wholesale': {
    name: 'Retail & Wholesale Counters',
    headline: 'Run counter sales and close the drawer',
    description: 'Use a billing worksheet for counter sales, record cash or UPI, and reconcile the drawer at the end of the shift.',
    category: 'general_wholesale',
    primary: { label: 'Open Retail Counter', path: '/pos' },
    tasks: [
      { label: 'Retail counter', detail: 'Find items and enter quantities at the till.', path: '/pos' },
      { label: 'Counter shift', detail: 'Open or close a drawer and reconcile collections.', path: '/counter-shift' },
      { label: 'Wholesale orders', detail: 'Prepare trade orders with customer and item details.', path: '/orders' },
    ],
  },
  'agricultural-inputs': {
    name: 'Fertilizers & Agri Inputs',
    headline: 'Track bag stock and supplier rates',
    description: 'Receive fertilizers and other inputs in bags, review supplier price changes, and follow customer balances.',
    category: 'agricultural_inputs',
    primary: { label: 'Open Goods Receiving', path: '/receiving' },
    tasks: [
      { label: 'Receive stock by bag', detail: 'Record delivered quantities and the rate paid.', path: '/receiving' },
      { label: 'Supplier rates', detail: 'Compare purchase rates across deliveries.', path: '/supplier-prices' },
      { label: 'Customer collections', detail: 'Check outstanding invoices and payments.', path: '/payments' },
    ],
  },
  ecommerce: {
    name: 'E-commerce Orders',
    headline: 'Track online orders from stock check to dispatch',
    description: 'Record website, marketplace or chat orders with their original references, then check stock and follow billing, tracking and collections.',
    category: 'ecommerce',
    primary: { label: 'New Online Order', path: '/ecommerce?action=create' },
    tasks: [
      { label: 'Online order queue', detail: 'Find orders by channel or external reference.', path: '/ecommerce' },
      { label: 'Catalogue stock', detail: 'Check SKU availability before confirming orders.', path: '/products' },
      { label: 'Online collections', detail: 'Review payments against your invoices.', path: '/payments' },
    ],
  },
  'small-business': {
    name: 'Small Shops',
    headline: 'Handle day-to-day billing and stock',
    description: 'Find prices and quantities quickly, prepare everyday sales, and keep customer invoices and payment receipts together.',
    category: 'general_retail',
    primary: { label: 'New Sales Order', path: '/orders?action=create' },
    tasks: [
      { label: 'Products & prices', detail: 'Find items, check prices and review availability.', path: '/products' },
      { label: 'Customer invoices', detail: 'Find bills and review what customers owe.', path: '/invoices' },
      { label: 'Payments & receipts', detail: 'Record collections and print receipts.', path: '/payments' },
    ],
  },
  'banner-print-studio': {
    name: 'Banner & Print Studio',
    headline: 'Move print jobs from quote to delivery',
    description: 'Price print jobs by piece or square foot, track artwork approval, and see which jobs are due.',
    category: 'banner_print_studio',
    primary: { label: 'New Print Job', path: '/studio-jobs' },
    tasks: [
      { label: 'Print job board', detail: 'Quote mixed units and track proof, printing, delivery and balance.', path: '/studio-jobs' },
    ],
  },
  'ice-cream-stalls': {
    name: 'Ice Cream Stalls',
    headline: 'Stall Stock & Cash',
    description: 'Receive stock, record sales, and track opening and closing cash by stall.',
    category: 'ice_cream_stalls',
    primary: { label: 'Open Stall Counter', path: '/ice-cream-counter' },
    tasks: [
      { label: 'Stall counter', detail: 'Record staff, opening cash, stock and closing cash.', path: '/ice-cream-counter' },
    ],
  },
  'ice-cream-distribution': {
    name: 'Ice Cream Distribution',
    headline: 'Plan bulk orders and track freezer stock',
    description: 'Receive factory cases by batch and freezer, compare promises with dispatched cases, and record returns and credits.',
    category: 'ice_cream_distribution',
    primary: { label: 'Open Distribution Desk', path: '/cold-chain' },
    tasks: [
      { label: 'Distribution desk', detail: 'Receive, commit, dispatch and reconcile case quantities in bulk.', path: '/cold-chain' },
    ],
  },
} as const;

export type IndustryToolId = keyof typeof INDUSTRY_TOOLS;
export type IndustryTool = (typeof INDUSTRY_TOOLS)[IndustryToolId];
export type IndustryTaskPath = IndustryTool['tasks'][number]['path'];

export function isIndustryToolId(value: string | null): value is IndustryToolId {
  return value !== null && Object.prototype.hasOwnProperty.call(INDUSTRY_TOOLS, value);
}

export const SPECIALTY_TOOL_ROUTES = {
  school: '/school',
  'banner-print-studio': '/studio-jobs',
  'ice-cream-stalls': '/ice-cream-counter',
  'ice-cream-distribution': '/cold-chain',
} as const;
export type SpecialtyToolId = keyof typeof SPECIALTY_TOOL_ROUTES;
export function isSpecialtyToolId(value: string | undefined): value is SpecialtyToolId {
  return value !== undefined && Object.prototype.hasOwnProperty.call(SPECIALTY_TOOL_ROUTES, value);
}
