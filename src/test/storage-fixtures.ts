import type { AuditEvent, Customer, Invoice, Membership, Organization, Payment, PaymentAllocation, Product, SalesOrder, StockMovement, Supplier, User } from '../types';
import { calculateDocumentTotals } from '../lib/money';

const STORAGE_KEYS = {
  ORGS: 'atlas_organizations_v1',
  MEMBERSHIPS: 'atlas_memberships_v1',
  PRODUCTS: 'atlas_products_v1',
  CUSTOMERS: 'atlas_customers_v1',
  SUPPLIERS: 'atlas_suppliers_v1',
  STOCK_MOVEMENTS: 'atlas_stock_movements_v1',
  QUOTATIONS: 'atlas_quotations_v1',
  SALES_ORDERS: 'atlas_sales_orders_v1',
  INVOICES: 'atlas_invoices_v1',
  PAYMENTS: 'atlas_payments_v1',
  PAYMENT_ALLOCATIONS: 'atlas_payment_allocations_v1',
  AUDIT_EVENTS: 'atlas_audit_events_v1',
  GOODS_RECEIPTS: 'atlas_goods_receipts_v1',
  PURCHASE_ORDERS: 'atlas_purchase_orders_v1',
  INVENTORY_ADJ_IDEMPOTENCY: 'atlas_inventory_adj_idempotency_v1',
  CURRENT_ORG_ID: 'atlas_current_org_id_v1',
  CURRENT_USER: 'atlas_current_user_v1',
  IMPORT_BATCHES: 'atlas_import_batches_v1',
};

const DEFAULT_CURRENT_USER: User = {
  id: 'u0000000-0000-0000-0000-000000000001',
  email: 'vijay@srilakshmielectricals.in',
  fullName: 'Vijay Kumar',
  avatarUrl: '',
};

// Initial Seed Data for Demo & Development
const SEED_ORG_1: Organization = {
  id: 'a0000000-0000-0000-0000-000000000001',
  name: 'Sri Lakshmi Electrical Distributors',
  legalName: 'Sri Lakshmi Electricals Pvt Ltd',
  gstin: '29ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  phone: '+91 98450 12345',
  email: 'sales@srilakshmielectricals.in',
  addressLine1: '42, BVK Iyengar Road, Chickpet',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560053',
  currency: 'INR',
  createdAt: '2026-01-15T09:00:00Z',
  updatedAt: '2026-01-15T09:00:00Z',
};

const SEED_ORG_2: Organization = {
  id: 'b0000000-0000-0000-0000-000000000002',
  name: 'Apex Electro Controls',
  legalName: 'Apex Electro Controls LLP',
  gstin: '36AABCA5678H1Z2',
  pan: 'AABCA5678H',
  phone: '+91 94400 98765',
  email: 'accounts@apexelectro.in',
  addressLine1: '15-4-210, Ranigunj',
  city: 'Secunderabad',
  state: 'Telangana',
  pincode: '500003',
  currency: 'INR',
  createdAt: '2026-02-01T10:00:00Z',
  updatedAt: '2026-02-01T10:00:00Z',
};

const SEED_PRODUCTS_ORG_1: Product[] = [
  {
    id: 'p0000000-0000-0000-0000-000000000001',
    organizationId: SEED_ORG_1.id,
    sku: 'POL-W-2.5-RD',
    name: 'Polycab 2.5 sq mm FR PVC Insulated Copper Wire (90m Red)',
    brand: 'Polycab',
    category: 'Wires & Cables',
    uom: 'Coils',
    purchaseCost: 1850,
    sellingPrice: 2250,
    taxRate: 18,
    hsnCode: '8544',
    reorderThreshold: 20,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000002',
    organizationId: SEED_ORG_1.id,
    sku: 'POL-W-1.5-BL',
    name: 'Polycab 1.5 sq mm FR PVC Insulated Copper Wire (90m Blue)',
    brand: 'Polycab',
    category: 'Wires & Cables',
    uom: 'Coils',
    purchaseCost: 1220,
    sellingPrice: 1540,
    taxRate: 18,
    hsnCode: '8544',
    reorderThreshold: 25,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000003',
    organizationId: SEED_ORG_1.id,
    sku: 'HAV-MCB-DP-32A',
    name: 'Havells 32A Double Pole C-Curve MCB (10kA)',
    brand: 'Havells',
    category: 'Switchgear',
    uom: 'Nos',
    purchaseCost: 480,
    sellingPrice: 680,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 15,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000004',
    organizationId: SEED_ORG_1.id,
    sku: 'SCH-SW-10A-1W',
    name: 'Schneider Electric Opale 10A 1-Way Modular Switch',
    brand: 'Schneider',
    category: 'Modular Switches',
    uom: 'Nos',
    purchaseCost: 38,
    sellingPrice: 62,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 100,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000005',
    organizationId: SEED_ORG_1.id,
    sku: 'CRM-LED-DL-15W',
    name: 'Crompton 15W Round Slim LED Recessed Downlight 6500K',
    brand: 'Crompton',
    category: 'Lighting',
    uom: 'Nos',
    purchaseCost: 210,
    sellingPrice: 340,
    taxRate: 18,
    hsnCode: '9405',
    reorderThreshold: 30, // currently stock is 8, so will trigger low stock alert!
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000006',
    organizationId: SEED_ORG_1.id,
    sku: 'LEG-DB-8W-SPN',
    name: 'Legrand 8-Way SPN Distribution Board (IP40 Enclosure)',
    brand: 'Legrand',
    category: 'Distribution Boards',
    uom: 'Nos',
    purchaseCost: 950,
    sellingPrice: 1420,
    taxRate: 18,
    hsnCode: '8537',
    reorderThreshold: 8,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000007',
    organizationId: SEED_ORG_1.id,
    sku: 'PRE-CND-25-HD',
    name: 'Precision 25mm Heavy Duty PVC Conduit Pipe (3m Length)',
    brand: 'Precision',
    category: 'Conduits & Pipes',
    uom: 'Bundles',
    purchaseCost: 75,
    sellingPrice: 110,
    taxRate: 18,
    hsnCode: '3917',
    reorderThreshold: 50,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
  {
    id: 'p0000000-0000-0000-0000-000000000008',
    organizationId: SEED_ORG_1.id,
    sku: 'ANC-SK-16A-UNV',
    name: 'Anchor Roma 16A 6-Pin Universal Combined Socket',
    brand: 'Anchor',
    category: 'Modular Switches',
    uom: 'Nos',
    purchaseCost: 95,
    sellingPrice: 145,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 40,
    isActive: true,
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-01-16T10:00:00Z',
  },
];

const SEED_CUSTOMERS_ORG_1: Customer[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    organizationId: SEED_ORG_1.id,
    name: 'Ramesh Kumar',
    companyName: 'Bangalore Electro Enterprises',
    phone: '+91 98860 11223',
    email: 'ramesh@blelectro.com',
    billingAddress: 'Site 48, Peenya Industrial Area 2nd Stage, Bengaluru 560058',
    gstin: '29AAAAA0000A1Z5',
    creditLimit: 300000,
    creditDays: 30,
    isActive: true,
    createdAt: '2026-01-18T11:00:00Z',
    updatedAt: '2026-01-18T11:00:00Z',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    organizationId: SEED_ORG_1.id,
    name: 'Venkatesh Rao',
    companyName: 'Venkateshwara Power Systems',
    phone: '+91 94480 33445',
    email: 'venkat@vpowersys.in',
    billingAddress: 'Plot 12, KIADB Industrial Estate, Hoskote, Bengaluru 562114',
    gstin: '29BBBBB1111B1Z2',
    creditLimit: 500000,
    creditDays: 45,
    isActive: true,
    createdAt: '2026-01-18T11:30:00Z',
    updatedAt: '2026-01-18T11:30:00Z',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    organizationId: SEED_ORG_1.id,
    name: 'Suresh Patel',
    companyName: 'Surya Light House & Electricals',
    phone: '+91 97410 55667',
    email: 'suryalights@gmail.com',
    billingAddress: '88, 10th Cross, Malleshwaram, Bengaluru 560003',
    gstin: '29CCCCC2222C1Z8',
    creditLimit: 150000,
    creditDays: 15,
    isActive: true,
    createdAt: '2026-01-19T09:00:00Z',
    updatedAt: '2026-01-19T09:00:00Z',
  },
];

const SEED_SUPPLIERS_ORG_1: Supplier[] = [
  {
    id: 's0000000-0000-0000-0000-000000000001',
    organizationId: SEED_ORG_1.id,
    name: 'Polycab Regional Depot',
    companyName: 'Polycab Wires & Cables Ltd',
    contactPerson: 'Ashok Hegde',
    phone: '+91 80 2234 5678',
    email: 'depot.blr@polycab.com',
    address: 'Warehouse Complex, Tumkur Road, Bengaluru 560022',
    gstin: '29AADCP1234D1Z9',
    paymentTerms: '30 Days Net',
    isActive: true,
    createdAt: '2026-01-17T10:00:00Z',
    updatedAt: '2026-01-17T10:00:00Z',
  },
  {
    id: 's0000000-0000-0000-0000-000000000002',
    organizationId: SEED_ORG_1.id,
    name: 'Havells India Central Hub',
    companyName: 'Havells India Super Stockist',
    contactPerson: 'Deepak Joshi',
    phone: '+91 80 2345 6789',
    email: 'hub.blr@havells.com',
    address: 'Ring Road Industrial Layout, Rajajinagar, Bengaluru 560010',
    gstin: '29AAACH4567J1Z3',
    paymentTerms: '21 Days Net',
    isActive: true,
    createdAt: '2026-01-17T10:30:00Z',
    updatedAt: '2026-01-17T10:30:00Z',
  },
];

const SEED_MOVEMENTS_ORG_1: StockMovement[] = [
  {
    id: 'm-01',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000001',
    quantityChange: 85,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-02',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000002',
    quantityChange: 120,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-03',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000003',
    quantityChange: 45,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-04',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000004',
    quantityChange: 350,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-05',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000005',
    quantityChange: 8, // below reorder threshold of 30!
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory (Below threshold alert)',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-06',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000006',
    quantityChange: 14,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-07',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000007',
    quantityChange: 200,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
  {
    id: 'm-08',
    organizationId: SEED_ORG_1.id,
    productId: 'p0000000-0000-0000-0000-000000000008',
    quantityChange: 90,
    movementType: 'OPENING_STOCK',
    notes: 'Initial audit inventory',
    createdAt: '2026-01-16T12:00:00Z',
  },
];

function createInitialOrder(orgId: string): SalesOrder {
  const docTotals = calculateDocumentTotals([
    { quantity: 10, unitPrice: 2250, discountPercent: 5, taxRate: 18 },
    { quantity: 4, unitPrice: 680, discountPercent: 0, taxRate: 18 },
  ]);

  return {
    id: 'ord-001',
    organizationId: orgId,
    orderNumber: 'SO-2026-0001',
    customerId: SEED_CUSTOMERS_ORG_1[0].id,
    status: 'CONFIRMED',
    orderDate: '2026-02-15',
    subtotal: docTotals.grossSubtotal,
    discountAmount: docTotals.discountTotal,
    taxAmount: docTotals.taxAmount,
    totalAmount: docTotals.totalAmount,
    totalsVersion: 2,
    notes: 'Urgent commercial wiring contract order',
    createdAt: '2026-02-15T11:00:00Z',
    updatedAt: '2026-02-15T11:30:00Z',
    confirmedAt: '2026-02-15T11:30:00Z',
    items: [
      {
        id: 'item-01',
        salesOrderId: 'ord-001',
        productId: SEED_PRODUCTS_ORG_1[0].id,
        productName: SEED_PRODUCTS_ORG_1[0].name,
        productSku: SEED_PRODUCTS_ORG_1[0].sku,
        uom: 'Coils',
        quantity: 10,
        unitPrice: 2250,
        discountPercent: 5,
        taxRate: 18,
        lineSubtotal: docTotals.items[0].taxableAmount,
        lineTax: docTotals.items[0].taxAmount,
        lineTotal: docTotals.items[0].totalAmount,
      },
      {
        id: 'item-02',
        salesOrderId: 'ord-001',
        productId: SEED_PRODUCTS_ORG_1[2].id,
        productName: SEED_PRODUCTS_ORG_1[2].name,
        productSku: SEED_PRODUCTS_ORG_1[2].sku,
        uom: 'Nos',
        quantity: 4,
        unitPrice: 680,
        discountPercent: 0,
        taxRate: 18,
        lineSubtotal: docTotals.items[1].taxableAmount,
        lineTax: docTotals.items[1].taxAmount,
        lineTotal: docTotals.items[1].totalAmount,
      },
    ],
  };
}

function createInitialInvoice(orgId: string, order: SalesOrder): Invoice {
  return {
    id: 'inv-001',
    organizationId: orgId,
    invoiceNumber: 'ATL/25-26/0001',
    customerId: order.customerId,
    status: 'PARTIALLY_PAID',
    invoiceDate: '2026-02-16',
    dueDate: '2026-03-18',
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    totalPaid: 25000,
    totalsVersion: 2,
    notes: 'Direct Tax Invoice ATL/25-26/0001',
    createdAt: '2026-02-16T10:00:00Z',
    updatedAt: '2026-02-20T14:30:00Z',
    items: order.items?.map((item) => ({
      id: 'inv-item-' + item.id,
      invoiceId: 'inv-001',
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      uom: item.uom,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent,
      taxRate: item.taxRate,
      lineSubtotal: item.lineSubtotal,
      lineTax: item.lineTax,
      lineTotal: item.lineTotal,
    })),
  };
}


export function testStorageEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  const write = (key: string, value: unknown) => { entries[key] = JSON.stringify(value); };
  write('atlas_empty_workspace_upgrade_v1', true);
  write(STORAGE_KEYS.CURRENT_USER, DEFAULT_CURRENT_USER);
  // Seed default data
  write(STORAGE_KEYS.ORGS, [SEED_ORG_1, SEED_ORG_2]);
  write(STORAGE_KEYS.CURRENT_ORG_ID, SEED_ORG_1.id);

  const demoUser = {
    id: 'u0000000-0000-0000-0000-000000000001',
    email: 'vijay@srilakshmielectricals.in',
    fullName: 'Vijay Kumar (Distributor Admin)',
  };

  const memberships: Membership[] = [
    {
      id: 'm0000000-0000-0000-0000-000000000001',
      organizationId: SEED_ORG_1.id,
      userId: demoUser.id,
      role: 'owner',
      isActive: true,
      createdAt: new Date().toISOString(),
      user: demoUser,
    },
    {
      id: 'm0000000-0000-0000-0000-000000000002',
      organizationId: SEED_ORG_2.id,
      userId: demoUser.id,
      role: 'owner',
      isActive: true,
      createdAt: new Date().toISOString(),
      user: demoUser,
    },
  ];
  write(STORAGE_KEYS.MEMBERSHIPS, memberships);
  write(STORAGE_KEYS.PRODUCTS, SEED_PRODUCTS_ORG_1);
  write(STORAGE_KEYS.CUSTOMERS, SEED_CUSTOMERS_ORG_1);
  write(STORAGE_KEYS.SUPPLIERS, SEED_SUPPLIERS_ORG_1);
  write(STORAGE_KEYS.STOCK_MOVEMENTS, SEED_MOVEMENTS_ORG_1);

  // Seed initial sales order and invoice
  const initialOrder = createInitialOrder(SEED_ORG_1.id);
  write(STORAGE_KEYS.SALES_ORDERS, [initialOrder]);

  const initialInvoice = createInitialInvoice(SEED_ORG_1.id, initialOrder);
  write(STORAGE_KEYS.INVOICES, [initialInvoice]);

  // Seed initial payment
  const initialPayment: Payment = {
    id: 'pay-001',
    organizationId: SEED_ORG_1.id,
    paymentNumber: 'PAY-20260220-001',
    customerId: initialInvoice.customerId,
    amount: 25000,
    paymentMethod: 'NEFT',
    referenceNumber: 'UTR98234871234',
    paymentDate: '2026-02-20',
    notes: 'Partial payment against invoice ' + initialInvoice.invoiceNumber,
    createdAt: '2026-02-20T14:30:00Z',
  };
  write(STORAGE_KEYS.PAYMENTS, [initialPayment]);

  const initialAlloc: PaymentAllocation = {
    id: 'alloc-001',
    paymentId: initialPayment.id,
    invoiceId: initialInvoice.id,
    amountAllocated: 25000,
    createdAt: '2026-02-20T14:30:00Z',
  };
  write(STORAGE_KEYS.PAYMENT_ALLOCATIONS, [initialAlloc]);

  // Seed audit event
  const auditLog: AuditEvent = {
    id: 'audit-001',
    organizationId: SEED_ORG_1.id,
    actorId: demoUser.id,
    actorEmail: demoUser.email,
    action: 'SYSTEM_INITIALIZATION',
    entityType: 'ORGANIZATION',
    entityId: SEED_ORG_1.id,
    details: { message: 'Initialized Sri Lakshmi Electrical Distributors test ledger.' },
    createdAt: new Date().toISOString(),
  };
  write(STORAGE_KEYS.AUDIT_EVENTS, [auditLog]);
  return entries;
}

export function seedTestStorage() {
  for (const [key, value] of Object.entries(testStorageEntries())) localStorage.setItem(key, value);
}
