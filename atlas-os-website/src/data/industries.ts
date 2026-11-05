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
      'Real-time contractor credit limit checking during sales order confirmation.',
      'Multi-invoice payment settlement allocation with exact cross-period tracking.',
      'One-click statutory GST Excel reporting with immutable tax snapshots.',
    ],
    workflowHighlights: [
      { step: '1. Fast Order Entry', description: 'Search Polycab, Havells, or Schneider SKUs by rating or brand in milliseconds.' },
      { step: '2. Credit Pre-Flight', description: 'System checks contractor outstanding balance before confirming delivery.' },
      { step: '3. Statutory Invoice', description: 'Instant commercial tax invoice with verified Place of Supply and GST breakdown.' },
      { step: '4. RTGS Allocation', description: 'Post customer bank receipt and settle against specific unpaid project invoices.' },
    ],
  },
  {
    id: 'electronics',
    title: 'Electronics & Component Wholesalers',
    badge: 'High Precision',
    tagline: 'Streamlined stock, high-velocity order entry, and accurate tax calculation.',
    description: 'Electronics distributors manage high SKU counts, brand-specific distribution authorizations, delicate inventory batches, and rapid trade discount adjustments.',
    commonChallenges: [
      'Accidental overselling of low-stock microcontrollers, sensors, and power supplies.',
      'Complex mixed trade discounts across different brand product categories.',
      'Fragmented billing records making customer return reconciliations difficult.',
      'Slow legacy ERP screens requiring dozens of keypresses for basic order entry.',
    ],
    howAtlasSolves: [
      'Real-time available vs. committed stock levels updated on every order confirmation.',
      'Item-level and document-level discount distributions calculated transparently.',
      'Audited stock movements with mandatory reference notes for all inventory adjustments.',
      'Modern, keyboard-accessible command interface for rapid product and customer lookups.',
    ],
    workflowHighlights: [
      { step: '1. Live Catalog', description: 'Instant product search across active component lines.' },
      { step: '2. Quantity Allocation', description: 'Reserve stock for confirmed orders to eliminate stock-outs.' },
      { step: '3. Transparent Invoicing', description: 'Automated discount share calculations per line item.' },
      { step: '4. Financial Visibility', description: 'Dashboard updates real-time daily turnover and receivable aging.' },
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
      { step: '1. Contractor Quotation', description: 'Issue formal price quotations before material dispatch.' },
      { step: '2. Dispatch & Invoice', description: 'Generate numbered tax invoices with customer GSTIN validation.' },
      { step: '3. Payment Tracking', description: 'Accept partial cheques or NEFT payments with exact ledger updates.' },
      { step: '4. Year-End Audit', description: 'Export complete audit-ready Excel workbooks with one click.' },
    ],
  },
  {
    id: 'retail-wholesale',
    title: 'Retail & Wholesale Trade Counters',
    badge: 'Dual Operations',
    tagline: 'Manage wholesale contractor accounts and retail walk-in cash billing together.',
    description: 'Many Indian electrical and hardware businesses operate both a wholesale warehouse and a street-front retail trade counter, requiring fast cash sales alongside formal credit billing.',
    commonChallenges: [
      'Switching between quick cash walk-in sales and formal GST contractor accounts.',
      'Inventory count discrepancies between trade counter displays and backroom godowns.',
      'Restricting trade counter staff from altering financial records or supplier costs.',
      'End-of-day cash and UPI counter collection reconciliations.',
    ],
    howAtlasSolves: [
      'Role-based access permissions restricting counter staff from altering master records.',
      'Instant customer selection supporting both walk-in trade and formal accounts.',
      'Separate tracking of cash collections vs. credit sales in the daily dashboard.',
      'Planned desktop application for high-speed offline counter billing.',
    ],
    workflowHighlights: [
      { step: '1. Walk-in or Account', description: 'Choose quick trade counter sale or registered contractor profile.' },
      { step: '2. Instant Billing', description: 'Calculate exact taxes and totals in a single intuitive screen.' },
      { step: '3. Multi-Channel Payment', description: 'Record Cash, UPI, or Credit ledger entries instantly.' },
      { step: '4. Daily Reconciliation', description: 'Review total counter receipts on the executive dashboard.' },
    ],
  },
];
