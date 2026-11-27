import type { IndustrySolution } from '../types';

export const INDUSTRY_SOLUTIONS: IndustrySolution[] = [
  {
    id: 'electrical',
    title: 'Electrical Distributors & Wholesalers',
    badge: 'Core Specialty',
    tagline: 'Engineered specifically for wire, switchgear, lighting, and cable distributors.',
    description: 'Electrical distribution requires managing thousands of technical SKUs, volatile raw-material pricing, coil-to-meter length conversions, and multi-tier trade credit for licensed electrical contractors.',
    commonChallenges: [
      'Managing hundreds of cable sizes, ratings, and color variants with different UOMs (Coils vs Meters).',
      'Tracking contractor payment aging and enforcing credit limits without stalling urgent project deliveries.',
      'Reconciling lump-sum RTGS transfers against 10+ open job-site invoices.',
      'Manual, error-prone generation of GST compliance data for heavy project billings.',
    ],
    howAtlasSolves: [
      'Native physical Unit of Measure (UOM) support including Coils, Bundles, and Meters.',
      'Contractor credit-limit checks during sales order confirmation.',
      'Multi-invoice payment settlement allocation with exact cross-period tracking.',
      'Export recorded invoice tax rates and totals; missing historical component splits remain marked as not stored.',
    ],
    workflowHighlights: [
      {
        step: '1. Fast Order Entry', description: 'Search Polycab, Havells, or Schneider SKUs by rating or brand.',
      },
      {
        step: '2. Credit Pre-Flight', description: 'System checks contractor outstanding balance before confirming delivery.',
      },
      {
        step: '3. Statutory Invoice', description: 'Invoice records with recorded tax totals; review place of supply and any component split before tax reporting.',
      },
      {
        step: '4. RTGS Allocation', description: 'Post customer bank receipt and settle against specific unpaid project invoices.',
      },
    ],
  },
  {
    id: 'electronics',
    title: 'Electronics & Component Wholesalers',
    badge: 'High Precision',
    tagline: 'Streamlined stock, high-velocity order entry, and accurate tax calculation.',
    description: 'Electronics distributors manage high SKU counts, brand-specific distribution authorizations, product variants, and rapid trade discount adjustments.',
    commonChallenges: [
      'Accidental overselling of low-stock microcontrollers, sensors, and power supplies.',
      'Complex mixed trade discounts across different brand product categories.',
      'Fragmented billing records making customer return reconciliations difficult.',
      'Slow legacy ERP screens requiring dozens of keypresses for basic order entry.',
    ],
    howAtlasSolves: [
      'On-hand balances derived from stock movements, with clear manual adjustment records.',
      'Item-level and document-level discount distributions calculated transparently.',
      'Audited stock movements with mandatory reference notes for all inventory adjustments.',
      'Modern, keyboard-accessible command interface for rapid product and customer lookups.',
    ],
    workflowHighlights: [
      {
        step: '1. Active Catalog', description: 'Product search across active component lines.',
      },
      {
        step: '2. Quantity Allocation', description: 'Review recorded on-hand balances while preparing confirmed orders.',
      },
      {
        step: '3. Transparent Invoicing', description: 'Automated discount share calculations per line item.',
      },
      {
        step: '4. Financial Visibility', description: 'Review daily turnover and receivable aging on the dashboard.',
      },
    ],
  },
  {
    id: 'hardware',
    title: 'Hardware & Industrial Suppliers',
    badge: 'Heavy Wholesale',
    tagline: 'Built for fasteners, tools, industrial pipes, fixtures, and builder supplies.',
    description: 'Hardware businesses supply heavy materials, tools, and consumables to construction sites, fabrication units, and retail shops with demanding delivery schedules.',
    commonChallenges: [
      'Tracking inventory sold in mixed packaging units: Boxes, Sets, Rolls, and Pieces.',
      'Monitoring contractor debt across multi-month construction phases.',
      'Missing audit trails for manual yard and warehouse stock adjustments.',
      'Time-consuming end-of-year accounting reconciliation across hundreds of trade ledgers.',
    ],
    howAtlasSolves: [
      'Multi-UOM packaging options with clear label distinctions across product masters.',
      'Comprehensive customer receivables ledger tracking outstanding dues per invoice.',
      'Mandatory stock adjustment reasoning preserving inventory integrity.',
      'Financial-year Excel exports for the records stored in your organization.',
    ],
    workflowHighlights: [
      {
        step: '1. Contractor Quotation', description: 'Issue formal price quotations before material dispatch.',
      },
      {
        step: '2. Dispatch & Invoice', description: 'Generate numbered tax invoices with customer GSTIN format checks and manual review.',
      },
      {
        step: '3. Payment Tracking', description: 'Accept partial cheques or NEFT payments with exact ledger updates.',
      },
      {
        step: '4. Year-End Audit', description: 'Export complete review-ready Excel workbooks with one click.',
      },
    ],
  },
  {
    id: 'retail-wholesale',
    title: 'Retail & Wholesale Trade Counters',
    badge: 'Dual Operations',
    tagline: 'Draft orders at the counter and reconcile collections by payment method.',
    description: 'A shop with a wholesale warehouse and a street-front counter can use the same catalog for counter orders and account sales, with finance roles handling recorded collections.',
    commonChallenges: [
      'Switching between quick cash walk-in sales and formal GST contractor accounts.',
      'Inventory count discrepancies between trade counter displays and backroom godowns.',
      'Restricting trade counter staff from altering financial records or supplier costs.',
      'End-of-day cash and UPI counter collection reconciliations.',
    ],
    howAtlasSolves: [
      'Role-based access permissions restricting counter staff from altering master records.',
      'Fast lookup for existing customer accounts and stock at the counter.',
      'Daily collections grouped by payment method in Payments.',
      'Customer and counter receipt copies on one sheet in Atlas Stride; future Summit scope requires confirmation.',
    ],
    workflowHighlights: [
      {
        step: '1. Select Customer', description: 'Find an existing customer account at the counter.',
      },
      {
        step: '2. Draft the Order', description: 'Check quantities, discounts, and taxes before saving the order.',
      },
      {
        step: '3. Record Collection', description: 'Use Payments to record the money received and print the receipt.',
      },
      {
        step: '4. Reconcile the Day', description: 'Compare cash and UPI totals with the till and bank records.',
      },
    ],
  },
  {
    id: 'agricultural-inputs',
    title: 'Fertilizer & Agri-Input Dealers',
    badge: 'Agri Trade',
    tagline: 'Track supplier rates, stock by bag, and customer payments.',
    description: 'Manage day-to-day trade in fertilizers, seeds, and other agri inputs. Set up your catalog with your own categories and selling units.',
    commonChallenges: [
      'Supplier rates change between deliveries of the same product.',
      'Stock comes in bags, cartons, or units and needs a clear receiving record.',
      'Credit collections can arrive days after the sale.',
    ],
    howAtlasSolves: [
      'Use fertilizer and seed catalog suggestions and a Bags unit when creating products.',
      'Record goods received and review supplier purchase-rate history.',
      'Track customer balances and print receipts when you record payments.',
    ],
    workflowHighlights: [
      {
        step: '1. Add Items', description: 'Set categories, units, and rates for your products.',
      },
      {
        step: '2. Receive Stock', description: 'Post deliveries with the quantity and the supplier rate.',
      },
      {
        step: '3. Bill Customers', description: 'Use your catalog when you prepare orders and invoices.',
      },
      {
        step: '4. Track Collections', description: 'Record cash, UPI, and account payments in Payments.',
      },
    ],
  },
  {
    id: 'small-business',
    title: 'Small Shops & General Trade',
    badge: 'Shop Essentials',
    tagline: 'Start with the stock, sales, billing, and collection tools you use every day.',
    description: 'Set up a grocery, stationery, home supplies, or general retail and wholesale workspace with your own product categories.',
    commonChallenges: [
      'Checking what is in stock while serving a customer.',
      'Finding the right invoice or customer balance quickly.',
      'Counting cash and checking digital collections at closing time.',
    ],
    howAtlasSolves: [
      'Open your everyday tools directly from Shop essentials on the dashboard.',
      'Add products and search by name or SKU to check price and availability.',
      'Print a customer receipt and see daily payment totals with Atlas Sprout.',
    ],
    workflowHighlights: [
      {
        step: '1. Set Up Products', description: 'Add item names, units, prices, and categories.',
      },
      {
        step: '2. Check Stock', description: 'Search the catalog as you build a sale.',
      },
      {
        step: '3. Invoice and Collect', description: 'Issue an invoice and record each payment.',
      },
      {
        step: '4. Close the Day', description: 'Review totals by payment method.',
      },
    ],
  },
  {
    id: 'ecommerce',
    title: 'E-commerce & Online Sellers',
    badge: 'Online sales',
    tagline: 'Track online orders from stock check to payment.',
    description: 'Capture orders from your own website, marketplaces, or chat. Keep the original order reference with the sale while your team uses one stock and billing workflow.',
    commonChallenges: [
      'Entering the same online order twice.',
      'Selling the last unit online while the counter is serving another customer.',
      'Finding the invoice for a marketplace or website order reference.',
    ],
    howAtlasSolves: [
      'Record the channel and external order reference, with duplicate checks.',
      'Confirm orders against available stock before billing.',
      'Create the GST invoice, record carrier tracking, and record verified collections.',
    ],
    workflowHighlights: [
      { step: '1. Record the order', description: 'Select the channel, enter its order reference, and add the customer and SKU.' },
      { step: '2. Confirm stock', description: 'Confirm the order when all items are available.' },
      { step: '3. Create the invoice', description: 'Generate the invoice from the confirmed order for review.' },
      { step: '4. Record payment', description: 'Check the payment against your channel statement and record the collection.' },
    ],
  },
  {
    "id": "banner-print-studio",
    "title": "Banner & Print Studio",
    "badge": "Industry tool",
    "tagline": "Manage quotes, proof approvals and print deadlines.",
    "description": "A studio can quote a banner by square foot and sign boards by piece on one job, then track artwork versions, production and payments.",
    "commonChallenges": [],
    "howAtlasSolves": [
      "Mix square-foot and per-piece lines.",
      "Record the latest artwork reference before approving proof.",
      "Move approved work through printing, ready and delivery."
    ],
    "workflowHighlights": [
      {
        "step": "Prepare a quote",
        "description": "Mix square-foot and per-piece lines.",
      },
      {
        "step": "Approve artwork",
        "description": "Record the latest artwork reference before approving proof.",
      },
      {
        "step": "Schedule production",
        "description": "Move approved work through printing, ready and delivery.",
      }
    ]
  },
  {
    "id": "ice-cream-stalls",
    "title": "Ice Cream Stalls",
    "badge": "Industry tool",
    "tagline": "Track stall stock and daily cash.",
    "description": "Assign a staff member, record incoming stock, and track opening and closing cash at each stall.",
    "commonChallenges": [],
    "howAtlasSolves": [
      "Count packaged items by piece and estimate available scoops.",
      "Track cash and UPI sales separately.",
      "Compare closing cash with opening cash and cash sales."
    ],
    "workflowHighlights": [
      {
        "step": "Open the stall",
        "description": "Enter the stall name, staff member and opening cash.",
      },
      {
        "step": "Receive stock and record sales",
        "description": "Track cash and UPI sales separately.",
      },
      {
        "step": "Close the stall",
        "description": "Compare closing cash with opening cash and cash sales.",
      }
    ]
  },
  {
    "id": "ice-cream-distribution",
    "title": "Ice Cream Distribution",
    "badge": "Industry tool",
    "tagline": "Track bulk cases from factory receipt to return.",
    "description": "A distributor can receive cases into named freezers by factory batch and expiry, track case commitments, and dispatch only available, unexpired stock.",
    "commonChallenges": [],
    "howAtlasSolves": [
      "Record a case quantity under a freezer, product and batch.",
      "Record a customer order reference and dispatch part or all from an available batch.",
      "Link returns to the shipped batch and record the credit allowance."
    ],
    "workflowHighlights": [
      {
        "step": "Receive factory cases",
        "description": "Record a case quantity under a freezer, product and batch.",
      },
      {
        "step": "Commit and dispatch",
        "description": "Record a customer order reference and dispatch part or all from an available batch.",
      },
      {
        "step": "Reconcile returns",
        "description": "Link returns to the shipped batch and record the credit allowance.",
      }
    ]
  },
];
