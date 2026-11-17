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
      'One-click statutory GST Excel reporting with immutable tax snapshots.',
    ],
    workflowHighlights: [
      {
        step: '1. Fast Order Entry', description: 'Search Polycab, Havells, or Schneider SKUs by rating or brand.',
        example: [
          'Polycab copper cable · 5 coils',
          '32 A MCB · 2 boxes',
          'Check the selling unit before adding the line',
        ],
      },
      {
        step: '2. Credit Pre-Flight', description: 'System checks contractor outstanding balance before confirming delivery.',
        example: [
          'Contractor credit limit · ₹50,000',
          'Outstanding invoices · ₹36,000',
          'Available credit before this order · ₹14,000',
        ],
      },
      {
        step: '3. Statutory Invoice', description: 'Commercial tax invoice with verified Place of Supply and GST breakdown.',
        example: [
          'Taxable value · ₹10,000',
          'CGST ₹900 + SGST ₹900',
          'Invoice total · ₹11,800',
        ],
      },
      {
        step: '4. RTGS Allocation', description: 'Post customer bank receipt and settle against specific unpaid project invoices.',
        example: [
          'RTGS receipt · ₹8,000',
          'Apply ₹8,000 to the ₹11,800 invoice',
          'Balance after allocation · ₹3,800',
        ],
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
        example: [
          '12 V power supply · PSU-12V',
          'Relay module · REL-05V',
          'USB-C adapter · ADP-USBC',
        ],
      },
      {
        step: '2. Quantity Allocation', description: 'Review recorded on-hand balances while preparing confirmed orders.',
        example: [
          'PSU-12V on hand · 40 units',
          'Already committed · 15 units',
          'Available for the order · 25 units',
        ],
      },
      {
        step: '3. Transparent Invoicing', description: 'Automated discount share calculations per line item.',
        example: [
          '5 power supplies × ₹800 · ₹4,000',
          'Trade discount · ₹400',
          'Taxable value after discount · ₹3,600',
        ],
      },
      {
        step: '4. Financial Visibility', description: 'Review daily turnover and receivable aging on the dashboard.',
        example: [
          'Sales recorded today · ₹18,500',
          'Receivables due up to 30 days · ₹24,000',
          'Receivables due over 30 days · ₹7,500',
        ],
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
      '15-year historical financial year Excel exports with full reconciliation sheets.',
    ],
    workflowHighlights: [
      {
        step: '1. Contractor Quotation', description: 'Issue formal price quotations before material dispatch.',
        example: [
          'M8 hex bolts · 2 boxes',
          'PVC elbows · 10 pieces',
          'Quoted value before tax · ₹5,000',
        ],
      },
      {
        step: '2. Dispatch & Invoice', description: 'Generate numbered tax invoices with customer GSTIN validation.',
        example: [
          'Dispatch · 2 boxes and 10 pieces',
          'Invoice HW-0042 · ₹5,900 with GST',
          'Customer balance before payment · ₹5,900',
        ],
      },
      {
        step: '3. Payment Tracking', description: 'Accept partial cheques or NEFT payments with exact ledger updates.',
        example: [
          'NEFT received · ₹3,000',
          'Allocated to invoice HW-0042',
          'Remaining balance · ₹2,900',
        ],
      },
      {
        step: '4. Year-End Audit', description: 'Export complete audit-ready Excel workbooks with one click.',
        example: [
          'Choose the reporting period',
          'Review stock movements and open invoices',
          'Export supported reports for review',
        ],
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
      'Customer and counter receipt copies on one sheet in Professional and Enterprise Network.',
    ],
    workflowHighlights: [
      {
        step: '1. Select Customer', description: 'Find an existing customer account at the counter.',
        example: [
          'Search by account name or phone',
          'Select City Trade Supplies',
          'Review the customer’s open balance',
        ],
      },
      {
        step: '2. Draft the Order', description: 'Check quantities, discounts, and taxes before saving the order.',
        example: [
          'Trade packs · 2 boxes',
          'Draft taxable value · ₹1,000',
          'Check GST before confirming the order',
        ],
      },
      {
        step: '3. Record Collection', description: 'Use Payments to record the money received and print the receipt.',
        example: [
          'Invoice total · ₹1,180',
          'UPI collected · ₹1,180',
          'Print the customer receipt',
        ],
      },
      {
        step: '4. Reconcile the Day', description: 'Compare cash and UPI totals with the till and bank records.',
        example: [
          'Cash recorded today · ₹2,000',
          'UPI recorded today · ₹1,180',
          'Check the ₹3,180 total against till and bank records',
        ],
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
        example: [
          'Fertilizer blend · bag',
          'Seed pack · unit',
          'Soil amendment · bag',
        ],
      },
      {
        step: '2. Receive Stock', description: 'Post deliveries with the quantity and the supplier rate.',
        example: [
          'Receive 40 bags of fertilizer',
          'Supplier rate · ₹720 per bag',
          'Delivery cost · ₹28,800',
        ],
      },
      {
        step: '3. Bill Customers', description: 'Use your catalog when you prepare orders and invoices.',
        example: [
          'Invoice 4 bags from the catalog',
          'Unit selling price · ₹800',
          'Taxable value before GST · ₹3,200',
        ],
      },
      {
        step: '4. Track Collections', description: 'Record cash, UPI, and account payments in Payments.',
        example: [
          'Invoice amount due · ₹3,360',
          'Cash collected · ₹2,000',
          'Remaining customer balance · ₹1,360',
        ],
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
      'Print a customer receipt and see daily payment totals with Starter.',
    ],
    workflowHighlights: [
      {
        step: '1. Set Up Products', description: 'Add item names, units, prices, and categories.',
        example: [
          'Notebook · piece',
          'Detergent pack · unit',
          'Storage jar · piece',
        ],
      },
      {
        step: '2. Check Stock', description: 'Search the catalog as you build a sale.',
        example: [
          'Notebooks on hand · 18',
          'Customer asks for 3 notebooks',
          'Available quantity covers the sale',
        ],
      },
      {
        step: '3. Invoice and Collect', description: 'Issue an invoice and record each payment.',
        example: [
          '3 notebooks × ₹40 · ₹120',
          'Amount due · ₹120',
          'Record UPI payment and print the receipt',
        ],
      },
      {
        step: '4. Close the Day', description: 'Review totals by payment method.',
        example: [
          'Cash recorded today · ₹2,140',
          'UPI recorded today · ₹1,860',
          'Review total collections of ₹4,000',
        ],
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
      { step: '1. Record the order', description: 'Select the channel, enter its order reference, and add the customer and SKU.',
        example: ['Own website · WEB-1042', 'Desk organisers · 2 pieces', 'Save as a draft'] },
      { step: '2. Confirm stock', description: 'Confirm the order when all items are available.',
        example: ['Desk organisers on hand · 12', 'Confirm 2 pieces', 'Stock remaining · 10 pieces'] },
      { step: '3. Create the invoice', description: 'Generate the invoice from the confirmed order for review.',
        example: ['Open WEB-1042', 'Create the invoice for the two items', 'Review the billing details and taxes before issue'] },
      { step: '4. Record payment', description: 'Check the payment against your channel statement and record the collection.',
        example: ['Match the payment reference', 'Record the amount received', 'Review the remaining balance'] },
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
        "example": [
          "Flex banner · 18 sq ft",
          "Sign boards · 2 pieces"
        ]
      },
      {
        "step": "Approve artwork",
        "description": "Record the latest artwork reference before approving proof.",
        "example": [
          "Version 1 · customer requested a correction",
          "Version 2 · approved for print"
        ]
      },
      {
        "step": "Schedule production",
        "description": "Move approved work through printing, ready and delivery.",
        "example": [
          "Review Due Today",
          "Collect the remaining payment"
        ]
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
        "example": [
          "Market stall · Lakshmi Rao",
          "Opening cash · ₹500"
        ]
      },
      {
        "step": "Receive stock and record sales",
        "description": "Track cash and UPI sales separately.",
        "example": [
          "Vanilla scoop · cone · UPI",
          "Chocolate cups received · 24 pieces"
        ]
      },
      {
        "step": "Close the stall",
        "description": "Compare closing cash with opening cash and cash sales.",
        "example": [
          "Closing cash versus expected cash",
          "UPI is shown separately"
        ]
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
        "example": [
          "Freezer A · batch VAN-24",
          "Factory delivery · 3,000 cases"
        ]
      },
      {
        "step": "Commit and dispatch",
        "description": "Record a customer order reference and dispatch part or all from an available batch.",
        "example": [
          "Outlet order · 1,200 cases committed",
          "600 dispatched · 600 open"
        ]
      },
      {
        "step": "Reconcile returns",
        "description": "Link returns to the shipped batch and record the credit allowance.",
        "example": [
          "Quarantine damaged returns",
          "Restock saleable, unexpired batches"
        ]
      }
    ]
  },
];
