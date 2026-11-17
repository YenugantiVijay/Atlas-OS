export const INDUSTRY_PAGES = {
  electrical: {
    audience: 'Electrical distributors', accent: 'Quote with current supplier costs.',
    demoIndustry: 'electrical_wholesale', benefits: ['Stock by selling unit', 'Contractor credit limits', 'Payment allocation', 'GST reports'],
    topics: ['Cable and wire stockists', 'Lighting distributors', 'Switchgear wholesalers', 'Contractor supply desks'],
    faq: ['How do we handle coil and metre sales?', 'Set up your catalog with the units your team uses. Review your actual packaging and conversion rules in the walkthrough.'],
    comparison: ['Quote margins', 'Recheck the latest supplier rate in a separate workbook.', 'Review supplier price history and affected quotes before issuing updated prices.'],
  },
  electronics: {
    audience: 'Electronics wholesalers', accent: 'Find the right component faster.',
    demoIndustry: 'electronics', benefits: ['On-hand stock', 'Clear discounts', 'Audited adjustments', 'Product search'],
    topics: ['Component stockists', 'Power supply wholesalers', 'Electronics trade counters', 'Repair-parts distributors'],
    faq: ['How do we tell similar components apart?', 'Keep a distinct SKU for each sellable specification. Use clear names and SKU searches to check availability before quoting.'],
    comparison: ['Similar-looking parts', 'Check descriptions and balances in separate stock sheets.', 'Search the product catalog by SKU and review on-hand quantities while building an order.'],
  },
  hardware: {
    audience: 'Hardware suppliers', accent: 'Track trade stock and contractor dues.',
    demoIndustry: 'hardware', benefits: ['Mixed packaging', 'Customer dues', 'Stock history', 'Financial exports'],
    topics: ['Fastener stockists', 'Tools and fittings dealers', 'Builder supply merchants', 'Industrial consumables suppliers'],
    faq: ['Can I track credit sales to contractors?', 'Review outstanding invoices in customer receivables, then record and allocate collections to the relevant invoices.'],
    comparison: ['Contractor collections', 'Match each transfer to invoices in a separate ledger.', 'Record partial collections and apply them to selected invoices in the customer ledger.'],
  },
  'retail-wholesale': {
    audience: 'Retail and wholesale counters', accent: 'Keep orders and collections in view.',
    demoIndustry: 'general_wholesale', benefits: ['Staff permissions', 'Counter lookup', 'Daily collections', 'Receipt copies'],
    topics: ['Shopfront trade counters', 'Warehouse pickup desks', 'Account-sales outlets', 'Mixed retail and wholesale shops'],
    faq: ['Where do staff finish billing and record payment?', 'Use Retail Counter to draft the order. Complete invoicing and record the collection in the relevant workspace screens.'],
    comparison: ['End-of-day collections', 'Add receipts and payment references by hand.', 'Review recorded payment totals by method and compare them with the till and bank records.'],
  },
  'agricultural-inputs': {
    audience: 'Fertilizer and agri-input dealers', accent: 'Track stock by bag and supplier rate.',
    demoIndustry: 'agricultural_inputs', benefits: ['Catalog by bag or unit', 'Supplier receiving', 'Collections and receipts'],
    topics: ['Fertilizer dealers', 'Seed retailers', 'Agri-input stockists', 'Rural trade counters'],
    faq: ['Does Atlas cover batch expiry and fertilizer licensing?', 'Agri-input setup covers catalog, receiving, supplier rates, sales, and collections. Batch and expiry tracking and fertilizer licensing workflows require separate tools today.'],
    comparison: ['Delivery costs', 'Record supplier rate changes in notes or separate spreadsheets.', 'Record the quantity and supplier rate as you receive stock, then review the purchase-rate history.'],
  },
  ecommerce: {
    audience: 'E-commerce sellers', accent: 'Take online orders from reference to receipt.',
    demoIndustry: 'ecommerce', benefits: ['Online order references', 'Stock confirmation', 'GST billing', 'Dispatch tracking'],
    topics: ['Independent web stores', 'Marketplace sellers', 'Social commerce businesses', 'Shops selling online and in person'],
    faq: ['Does Atlas sync with my storefront or marketplace?', 'The e-commerce workspace supports manual entry by sales channel and external order reference. Direct storefront, marketplace, and shipping integrations require a separate setup and are not available in this release.'],
    comparison: ['Orders across channels', 'Match website and marketplace references across separate spreadsheets.', 'Find the channel and reference in Atlas, then use the same stock and billing workflow as other sales.'],
  },
  'small-business': {
    audience: 'Small shops and general trade', accent: 'Run stock, billing, and receipts together.',
    demoIndustry: 'general_retail', benefits: ['Everyday tools', 'SKU and stock search', 'Receipts and totals'],
    topics: ['Kirana and general stores', 'Stationery shops', 'Home supplies shops', 'Local retail and wholesale shops'],
    faq: ['What can a small shop do with Starter?', 'Set up a product catalog, search by SKU, issue invoices, record collections, and print a customer receipt. Compare plans for more receipt and workspace options.'],
    comparison: ['Daily records', 'Search separate notebooks for stock, invoices, and payments.', 'Open catalog, billing, and collections from the Shop essentials area.'],
  },
  "banner-print-studio": {"audience": "Banner & Print Studio", "accent": "Manage quotes, proof approvals and print deadlines.", "demoIndustry": "banner_print_studio", "benefits": ["Prepare a quote", "Approve artwork", "Schedule production"], "topics": ["Print studios", "Flex banner makers", "Signage shops"], "faq": ["Can one job include different pricing units?", "Yes. Add a quote line for each item and choose piece or square foot for that line."], "comparison": ["Approve artwork", "Check paper notes and separate spreadsheets.", "Record the latest artwork reference before approving proof."]},
  "ice-cream-stalls": {"audience": "Ice Cream Stalls", "accent": "Track stall stock and daily cash.", "demoIndustry": "ice_cream_stalls", "benefits": ["Assign staff and open the stall", "Receive stock and record sales", "Record closing cash"], "topics": ["Seasonal stalls", "Event counters", "Ice cream kiosks"], "faq": ["How are scoops counted?", "Scoops use estimated servings. Enter the physical closing count to correct the estimate."], "comparison": ["Track daily cash", "Check paper notes and separate spreadsheets.", "Record opening and closing cash for each stall and staff member."]},
  "ice-cream-distribution": {"audience": "Ice Cream Distribution", "accent": "Track bulk cases from factory receipt to return.", "demoIndustry": "ice_cream_distribution", "benefits": ["Receive factory cases", "Commit and dispatch", "Reconcile returns"], "topics": ["Frozen goods distributors", "Cold-storage depots", "Retail outlet suppliers"], "faq": ["Can I dispatch cases from more than one batch?", "Yes. Record each batch as a separate dispatch on the same order reference."], "comparison": ["Commit and dispatch", "Check paper notes and separate spreadsheets.", "Record a customer order reference and dispatch part or all from an available batch."]},
} satisfies Record<string, {
  audience: string; accent: string; demoIndustry: string; benefits: string[]; topics: string[];
  faq: [string, string]; comparison: [string, string, string];
}>;
