import {
  User,
  Organization,
  Membership,
  Product,
  Customer,
  Supplier,
  StockMovement,
  Quotation,
  SalesOrder,
  Invoice,
  Payment,
  PaymentAllocation,
  AuditEvent,
  DashboardMetrics,
  Role,
} from '@/types';
import { calculateLineItem, calculateInvoiceBalance } from './money';

// Storage keys
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
  CURRENT_ORG_ID: 'atlas_current_org_id_v1',
  CURRENT_USER: 'atlas_current_user_v1',
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

class StorageEngine {
  private initialized = false;

  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`StorageEngine error saving ${key}`, e);
    }
  }

  public initialize(): void {
    if (this.initialized) return;

    // Check if organizations exist
    const orgs = this.getItem<Organization[]>(STORAGE_KEYS.ORGS, []);
    if (orgs.length === 0) {
      // Seed default data
      this.setItem(STORAGE_KEYS.ORGS, [SEED_ORG_1, SEED_ORG_2]);
      this.setItem(STORAGE_KEYS.CURRENT_ORG_ID, SEED_ORG_1.id);

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
      this.setItem(STORAGE_KEYS.MEMBERSHIPS, memberships);
      this.setItem(STORAGE_KEYS.PRODUCTS, SEED_PRODUCTS_ORG_1);
      this.setItem(STORAGE_KEYS.CUSTOMERS, SEED_CUSTOMERS_ORG_1);
      this.setItem(STORAGE_KEYS.SUPPLIERS, SEED_SUPPLIERS_ORG_1);
      this.setItem(STORAGE_KEYS.STOCK_MOVEMENTS, SEED_MOVEMENTS_ORG_1);

      // Seed initial sales order and invoice
      const initialOrder = this.createInitialOrder(SEED_ORG_1.id);
      this.setItem(STORAGE_KEYS.SALES_ORDERS, [initialOrder]);

      const initialInvoice = this.createInitialInvoice(SEED_ORG_1.id, initialOrder);
      this.setItem(STORAGE_KEYS.INVOICES, [initialInvoice]);

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
      this.setItem(STORAGE_KEYS.PAYMENTS, [initialPayment]);

      const initialAlloc: PaymentAllocation = {
        id: 'alloc-001',
        paymentId: initialPayment.id,
        invoiceId: initialInvoice.id,
        amountAllocated: 25000,
        createdAt: '2026-02-20T14:30:00Z',
      };
      this.setItem(STORAGE_KEYS.PAYMENT_ALLOCATIONS, [initialAlloc]);

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
      this.setItem(STORAGE_KEYS.AUDIT_EVENTS, [auditLog]);
    }

    // Ensure currentUser is always initialized
    const user = this.getItem<User | null>(STORAGE_KEYS.CURRENT_USER, null);
    if (!user) {
      this.setItem(STORAGE_KEYS.CURRENT_USER, DEFAULT_CURRENT_USER);
    }

    this.initialized = true;
  }

  private createInitialOrder(orgId: string): SalesOrder {
    const item1 = calculateLineItem(10, 2250, 5, 18);
    const item2 = calculateLineItem(4, 680, 0, 18);

    const subtotal = item1.taxableAmount + item2.taxableAmount;
    const tax = item1.taxAmount + item2.taxAmount;
    const discount = item1.discountAmount + item2.discountAmount;
    const total = item1.totalAmount + item2.totalAmount;

    return {
      id: 'ord-001',
      organizationId: orgId,
      orderNumber: 'SO-2026-0001',
      customerId: SEED_CUSTOMERS_ORG_1[0].id,
      status: 'CONFIRMED',
      orderDate: '2026-02-15',
      subtotal,
      discountAmount: discount,
      taxAmount: tax,
      totalAmount: total,
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
          lineSubtotal: item1.taxableAmount,
          lineTax: item1.taxAmount,
          lineTotal: item1.totalAmount,
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
          lineSubtotal: item2.taxableAmount,
          lineTax: item2.taxAmount,
          lineTotal: item2.totalAmount,
        },
      ],
    };
  }

  private createInitialInvoice(orgId: string, order: SalesOrder): Invoice {
    return {
      id: 'inv-001',
      organizationId: orgId,
      invoiceNumber: 'INV-2026-0001',
      customerId: order.customerId,
      salesOrderId: order.id,
      status: 'PARTIALLY_PAID',
      invoiceDate: '2026-02-16',
      dueDate: '2026-03-18',
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      totalPaid: 25000,
      notes: 'Generated from Sales Order SO-2026-0001',
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

  // --- Multi-tenant context ---
  public getCurrentOrgId(): string {
    this.initialize();
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_ORG_ID);
    if (stored) return stored;
    const orgs = this.getOrganizations();
    return orgs[0]?.id || '';
  }

  public setCurrentOrgId(orgId: string): void {
    localStorage.setItem(STORAGE_KEYS.CURRENT_ORG_ID, orgId);
  }

  public getOrganizations(): Organization[] {
    this.initialize();
    return this.getItem<Organization[]>(STORAGE_KEYS.ORGS, []);
  }

  public getOrganizationById(id: string): Organization | undefined {
    return this.getOrganizations().find((o) => o.id === id);
  }

  public createOrganization(data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>): Organization {
    this.initialize();
    const orgs = this.getOrganizations();
    const newOrg: Organization = {
      ...data,
      id: 'org-' + Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    orgs.push(newOrg);
    this.setItem(STORAGE_KEYS.ORGS, orgs);

    // Create owner membership
    const memberships = this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []);
    memberships.push({
      id: 'mem-' + Date.now(),
      organizationId: newOrg.id,
      userId: 'u0000000-0000-0000-0000-000000000001',
      role: 'owner',
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    this.setItem(STORAGE_KEYS.MEMBERSHIPS, memberships);

    this.setCurrentOrgId(newOrg.id);
    return newOrg;
  }

  public updateOrganization(orgId: string, updates: Partial<Organization>): Organization {
    this.initialize();
    const orgs = this.getOrganizations();
    const index = orgs.findIndex((o) => o.id === orgId);
    if (index === -1) throw new Error('Organization not found');

    const updated: Organization = {
      ...orgs[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    orgs[index] = updated;
    this.setItem(STORAGE_KEYS.ORGS, orgs);
    this.logAuditEvent(orgId, 'UPDATE_ORGANIZATION_SETTINGS', 'ORGANIZATION', orgId, updates);
    return updated;
  }

  // --- Current User & Profile ---
  public getCurrentUser(): User {
    this.initialize();
    return this.getItem<User>(STORAGE_KEYS.CURRENT_USER, DEFAULT_CURRENT_USER);
  }

  public updateCurrentUser(updates: Partial<User>): User {
    this.initialize();
    const current = this.getCurrentUser();
    const updated: User = {
      ...current,
      ...updates,
    };
    this.setItem(STORAGE_KEYS.CURRENT_USER, updated);

    // Update memberships where user matches
    const memberships = this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []);
    let modified = false;
    for (const m of memberships) {
      if (m.userId === updated.id && m.user) {
        m.user = {
          ...m.user,
          ...updates,
        };
        modified = true;
      }
    }
    if (modified) {
      this.setItem(STORAGE_KEYS.MEMBERSHIPS, memberships);
    }

    return updated;
  }

  // --- Memberships ---
  public getMemberships(orgId: string): Membership[] {
    this.initialize();
    return this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []).filter(
      (m) => m.organizationId === orgId
    );
  }

  // --- Products ---
  public getProducts(orgId: string): Product[] {
    this.initialize();
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []).filter(
      (p) => p.organizationId === orgId
    );
    const movements = this.getItem<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, []).filter(
      (m) => m.organizationId === orgId
    );

    // Map current stock from movements
    return products.map((p) => {
      const stock = movements
        .filter((m) => m.productId === p.id)
        .reduce((sum, m) => sum + m.quantityChange, 0);
      return { ...p, currentStock: stock };
    });
  }

  public getProductById(orgId: string, id: string): Product | undefined {
    return this.getProducts(orgId).find((p) => p.id === id);
  }

  public createProduct(orgId: string, data: Omit<Product, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>, openingStock?: number): Product {
    this.initialize();
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []);

    // Check SKU uniqueness within organization
    const exists = products.some((p) => p.organizationId === orgId && p.sku.toLowerCase() === data.sku.toLowerCase());
    if (exists) {
      throw new Error(`Product with SKU "${data.sku}" already exists in this organization.`);
    }

    const newProduct: Product = {
      ...data,
      id: 'prod-' + Date.now(),
      organizationId: orgId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    products.push(newProduct);
    this.setItem(STORAGE_KEYS.PRODUCTS, products);

    // Record opening stock movement if specified
    if (openingStock && openingStock > 0) {
      this.recordStockMovement({
        organizationId: orgId,
        productId: newProduct.id,
        quantityChange: openingStock,
        movementType: 'OPENING_STOCK',
        notes: 'Initial opening stock',
      });
    }

    this.logAuditEvent(orgId, 'CREATE_PRODUCT', 'PRODUCT', newProduct.id, { sku: newProduct.sku, name: newProduct.name });
    return { ...newProduct, currentStock: openingStock || 0 };
  }

  public updateProduct(orgId: string, id: string, updates: Partial<Product>): Product {
    this.initialize();
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    const index = products.findIndex((p) => p.id === id && p.organizationId === orgId);
    if (index === -1) throw new Error('Product not found in this organization');

    const updated: Product = {
      ...products[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    products[index] = updated;
    this.setItem(STORAGE_KEYS.PRODUCTS, products);
    this.logAuditEvent(orgId, 'UPDATE_PRODUCT', 'PRODUCT', id, updates);
    return updated;
  }

  // --- Customers ---
  public getCustomers(orgId: string): Customer[] {
    this.initialize();
    const customers = this.getItem<Customer[]>(STORAGE_KEYS.CUSTOMERS, []).filter(
      (c) => c.organizationId === orgId
    );
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter(
      (inv) => inv.organizationId === orgId
    );

    // Calculate customer current receivable balance
    return customers.map((c) => {
      const custInvoices = invoices.filter((inv) => inv.customerId === c.id && inv.status !== 'CANCELLED');
      const receivable = custInvoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.totalPaid), 0);
      return { ...c, currentReceivable: Math.max(0, receivable) };
    });
  }

  public getCustomerById(orgId: string, id: string): Customer | undefined {
    return this.getCustomers(orgId).find((c) => c.id === id);
  }

  public createCustomer(orgId: string, data: Omit<Customer, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Customer {
    this.initialize();
    const customers = this.getItem<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const newCust: Customer = {
      ...data,
      id: 'cust-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8),
      organizationId: orgId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    customers.push(newCust);
    this.setItem(STORAGE_KEYS.CUSTOMERS, customers);
    this.logAuditEvent(orgId, 'CREATE_CUSTOMER', 'CUSTOMER', newCust.id, { name: newCust.name });
    return newCust;
  }

  public updateCustomer(orgId: string, id: string, updates: Partial<Customer>): Customer {
    this.initialize();
    const customers = this.getItem<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const index = customers.findIndex((c) => c.id === id && c.organizationId === orgId);
    if (index === -1) throw new Error('Customer not found in this organization');

    const updated: Customer = {
      ...customers[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    customers[index] = updated;
    this.setItem(STORAGE_KEYS.CUSTOMERS, customers);
    this.logAuditEvent(orgId, 'UPDATE_CUSTOMER', 'CUSTOMER', id, updates);
    return updated;
  }

  // --- Suppliers ---
  public getSuppliers(orgId: string): Supplier[] {
    this.initialize();
    return this.getItem<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []).filter(
      (s) => s.organizationId === orgId
    );
  }

  public createSupplier(orgId: string, data: Omit<Supplier, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Supplier {
    this.initialize();
    const suppliers = this.getItem<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []);
    const newSup: Supplier = {
      ...data,
      id: 'sup-' + Date.now(),
      organizationId: orgId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    suppliers.push(newSup);
    this.setItem(STORAGE_KEYS.SUPPLIERS, suppliers);
    this.logAuditEvent(orgId, 'CREATE_SUPPLIER', 'SUPPLIER', newSup.id, { name: newSup.name });
    return newSup;
  }

  // --- Inventory & Stock Movements ---
  public getStockMovements(orgId: string): StockMovement[] {
    this.initialize();
    const movements = this.getItem<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, []).filter(
      (m) => m.organizationId === orgId
    );
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []).filter(
      (p) => p.organizationId === orgId
    );

    return movements
      .map((m) => ({
        ...m,
        product: products.find((p) => p.id === m.productId),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public recordStockMovement(data: Omit<StockMovement, 'id' | 'createdAt'>): StockMovement {
    this.initialize();
    const movements = this.getItem<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, []);
    const newMovement: StockMovement = {
      ...data,
      id: 'mov-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      createdAt: new Date().toISOString(),
    };
    movements.push(newMovement);
    this.setItem(STORAGE_KEYS.STOCK_MOVEMENTS, movements);
    return newMovement;
  }

  public adjustStock(orgId: string, productId: string, quantityChange: number, notes: string): StockMovement {
    this.initialize();
    const product = this.getProductById(orgId, productId);
    if (!product) throw new Error('Product not found in this organization');

    const currentStock = product.currentStock || 0;
    if (quantityChange < 0 && Math.abs(quantityChange) > currentStock) {
      throw new Error(`Negative stock adjustment (${quantityChange}) exceeds available balance (${currentStock}).`);
    }

    const movement = this.recordStockMovement({
      organizationId: orgId,
      productId,
      quantityChange,
      movementType: 'ADJUSTMENT',
      notes,
    });

    this.logAuditEvent(orgId, 'ADJUST_INVENTORY', 'PRODUCT', productId, {
      quantityChange,
      previousStock: currentStock,
      newStock: currentStock + quantityChange,
      notes,
    });

    return movement;
  }

  // --- Quotations ---
  public getQuotations(orgId: string): Quotation[] {
    this.initialize();
    const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []).filter(
      (q) => q.organizationId === orgId
    );
    const customers = this.getCustomers(orgId);

    return quotations
      .map((q) => ({
        ...q,
        customer: customers.find((c) => c.id === q.customerId),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public createQuotation(orgId: string, data: { customerId: string; validUntil: string; notes?: string; items: any[] }): Quotation {
    this.initialize();
    const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []);
    const num = 'QT-' + new Date().getFullYear() + '-' + String(quotations.length + 1).padStart(4, '0');

    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    const items = data.items.map((it, idx) => {
      const calc = calculateLineItem(it.quantity, it.unitPrice, it.discountPercent, it.taxRate);
      subtotal += calc.taxableAmount;
      discountAmount += calc.discountAmount;
      taxAmount += calc.taxAmount;
      totalAmount += calc.totalAmount;

      return {
        id: 'qt-item-' + Date.now() + '-' + idx,
        quotationId: '',
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
        lineSubtotal: calc.taxableAmount,
        lineTax: calc.taxAmount,
        lineTotal: calc.totalAmount,
      };
    });

    const newQuotation: Quotation = {
      id: 'qt-' + Date.now(),
      organizationId: orgId,
      quotationNumber: num,
      customerId: data.customerId,
      status: 'DRAFT',
      validUntil: data.validUntil,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    };

    quotations.push(newQuotation);
    this.setItem(STORAGE_KEYS.QUOTATIONS, quotations);
    this.logAuditEvent(orgId, 'CREATE_QUOTATION', 'QUOTATION', newQuotation.id, { quotationNumber: num, totalAmount });
    return newQuotation;
  }

  public convertQuotationToOrder(orgId: string, quotationId: string): SalesOrder {
    this.initialize();
    const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []);
    const qIndex = quotations.findIndex((q) => q.id === quotationId && q.organizationId === orgId);
    if (qIndex === -1) throw new Error('Quotation not found');

    const quotation = quotations[qIndex];
    if (quotation.status === 'CONVERTED') throw new Error('Quotation has already been converted to an order');

    // Create Sales Order from quotation
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const orderNum = 'SO-' + new Date().getFullYear() + '-' + String(orders.length + 1).padStart(4, '0');

    const newOrder: SalesOrder = {
      id: 'ord-' + Date.now(),
      organizationId: orgId,
      orderNumber: orderNum,
      customerId: quotation.customerId,
      quotationId: quotation.id,
      status: 'DRAFT',
      orderDate: new Date().toISOString().split('T')[0],
      subtotal: quotation.subtotal,
      discountAmount: quotation.discountAmount,
      taxAmount: quotation.taxAmount,
      totalAmount: quotation.totalAmount,
      notes: `Converted from quotation ${quotation.quotationNumber}. ${quotation.notes || ''}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: quotation.items?.map((it) => ({
        ...it,
        id: 'so-item-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        salesOrderId: '',
      })),
    };

    orders.push(newOrder);
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);

    // Mark quotation CONVERTED
    quotations[qIndex].status = 'CONVERTED';
    quotations[qIndex].updatedAt = new Date().toISOString();
    this.setItem(STORAGE_KEYS.QUOTATIONS, quotations);

    this.logAuditEvent(orgId, 'CONVERT_QUOTATION', 'SALES_ORDER', newOrder.id, {
      quotationId,
      orderNumber: orderNum,
    });

    return newOrder;
  }

  // --- Sales Orders & Atomic Confirmation ---
  public getSalesOrders(orgId: string): SalesOrder[] {
    this.initialize();
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []).filter(
      (o) => o.organizationId === orgId
    );
    const customers = this.getCustomers(orgId);

    return orders
      .map((o) => ({
        ...o,
        customer: customers.find((c) => c.id === o.customerId),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public createSalesOrder(orgId: string, data: { customerId: string; orderDate: string; quotationId?: string; notes?: string; items: any[] }): SalesOrder {
    this.initialize();
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const num = 'SO-' + new Date().getFullYear() + '-' + String(orders.length + 1).padStart(4, '0');

    let subtotal = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let totalAmount = 0;

    const items = data.items.map((it, idx) => {
      const calc = calculateLineItem(it.quantity, it.unitPrice, it.discountPercent, it.taxRate);
      subtotal += calc.taxableAmount;
      discountAmount += calc.discountAmount;
      taxAmount += calc.taxAmount;
      totalAmount += calc.totalAmount;

      return {
        id: 'so-item-' + Date.now() + '-' + idx,
        salesOrderId: '',
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
        lineSubtotal: calc.taxableAmount,
        lineTax: calc.taxAmount,
        lineTotal: calc.totalAmount,
      };
    });

    const newOrder: SalesOrder = {
      id: 'ord-' + Date.now(),
      organizationId: orgId,
      orderNumber: num,
      customerId: data.customerId,
      quotationId: data.quotationId,
      status: 'DRAFT',
      orderDate: data.orderDate,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    };

    orders.push(newOrder);
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
    this.logAuditEvent(orgId, 'CREATE_ORDER', 'SALES_ORDER', newOrder.id, { orderNumber: num, totalAmount });
    return newOrder;
  }

  /**
   * ATOMIC ORDER CONFIRMATION
   * Validates available stock for each line item.
   * If any item is insufficient, rejects confirmation and rolls back.
   * Otherwise deducts stock through ledger movements and sets status to CONFIRMED.
   */
  public confirmSalesOrder(orgId: string, orderId: string, userRole?: Role | null): SalesOrder {
    this.initialize();
    if (!userRole || !['owner', 'admin', 'sales'].includes(userRole)) {
      throw new Error(`Permission denied: Role "${userRole || 'unassigned'}" cannot confirm sales orders.`);
    }

    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const index = orders.findIndex((o) => o.id === orderId && o.organizationId === orgId);
    if (index === -1) throw new Error('Sales order not found');

    const order = orders[index];
    if (order.status !== 'DRAFT') {
      throw new Error(`Order ${order.orderNumber} cannot be confirmed because status is ${order.status}`);
    }

    // Check available stock for each item
    const products = this.getProducts(orgId);
    for (const item of order.items || []) {
      const prod = products.find((p) => p.id === item.productId);
      const available = prod?.currentStock || 0;
      if (available < item.quantity) {
        throw new Error(
          `Insufficient stock for product "${item.productName}" (SKU: ${item.productSku}). Available: ${available}, Required: ${item.quantity}`
        );
      }
    }

    // All items available: record stock deductions
    for (const item of order.items || []) {
      this.recordStockMovement({
        organizationId: orgId,
        productId: item.productId,
        quantityChange: -item.quantity,
        movementType: 'SALES_DISPATCH',
        referenceType: 'SALES_ORDER',
        referenceId: order.id,
        notes: `Order confirmation dispatch for ${order.orderNumber}`,
      });
    }

    // Update status to CONFIRMED
    const updated: SalesOrder = {
      ...order,
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    orders[index] = updated;
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);

    this.logAuditEvent(orgId, 'CONFIRM_ORDER', 'SALES_ORDER', order.id, {
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
    });

    return updated;
  }

  // --- Invoices ---
  public getInvoices(orgId: string): Invoice[] {
    this.initialize();
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter(
      (inv) => inv.organizationId === orgId
    );
    const customers = this.getCustomers(orgId);

    return invoices
      .map((inv) => ({
        ...inv,
        customer: customers.find((c) => c.id === inv.customerId),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public createInvoiceFromOrder(orgId: string, orderId: string): Invoice {
    this.initialize();
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const order = orders.find((o) => o.id === orderId && o.organizationId === orgId);
    if (!order) throw new Error('Sales order not found');

    if (order.status !== 'CONFIRMED' && order.status !== 'FULFILLED') {
      throw new Error(`Cannot invoice order in status "${order.status}". Order must be CONFIRMED.`);
    }

    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const invNum = 'INV-' + new Date().getFullYear() + '-' + String(invoices.length + 1).padStart(4, '0');

    // Due date = today + 30 days default
    const due = new Date();
    due.setDate(due.getDate() + 30);

    const newInvoice: Invoice = {
      id: 'inv-' + Date.now(),
      organizationId: orgId,
      invoiceNumber: invNum,
      customerId: order.customerId,
      salesOrderId: order.id,
      status: 'ISSUED',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: due.toISOString().split('T')[0],
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      taxAmount: order.taxAmount,
      totalAmount: order.totalAmount,
      totalPaid: 0,
      notes: `Issued for confirmed Sales Order ${order.orderNumber}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: order.items?.map((it) => ({
        id: 'inv-item-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        invoiceId: '',
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
        lineSubtotal: it.lineSubtotal,
        lineTax: it.lineTax,
        lineTotal: it.lineTotal,
      })),
    };

    invoices.push(newInvoice);
    this.setItem(STORAGE_KEYS.INVOICES, invoices);

    this.logAuditEvent(orgId, 'ISSUE_INVOICE', 'INVOICE', newInvoice.id, {
      invoiceNumber: invNum,
      orderNumber: order.orderNumber,
      totalAmount: newInvoice.totalAmount,
    });

    return newInvoice;
  }

  // --- Payments & Atomic Allocation ---
  public getPayments(orgId: string): Payment[] {
    this.initialize();
    const payments = this.getItem<Payment[]>(STORAGE_KEYS.PAYMENTS, []).filter(
      (p) => p.organizationId === orgId
    );
    const customers = this.getCustomers(orgId);
    const allocations = this.getItem<PaymentAllocation[]>(STORAGE_KEYS.PAYMENT_ALLOCATIONS, []);

    return payments
      .map((p) => ({
        ...p,
        customer: customers.find((c) => c.id === p.customerId),
        allocations: allocations.filter((a) => a.paymentId === p.id),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public recordPayment(
    orgId: string,
    data: {
      customerId: string;
      invoiceId?: string;
      amount: number;
      paymentMethod: any;
      referenceNumber?: string;
      paymentDate: string;
      notes?: string;
    }
  ): Payment {
    this.initialize();
    if (data.amount <= 0) throw new Error('Payment amount must be greater than zero.');

    const customers = this.getCustomers(orgId);
    const customer = customers.find((c) => c.id === data.customerId);
    if (!customer) {
      throw new Error(`Customer not found in organization ${orgId}`);
    }

    const payments = this.getItem<Payment[]>(STORAGE_KEYS.PAYMENTS, []);
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const allocations = this.getItem<PaymentAllocation[]>(STORAGE_KEYS.PAYMENT_ALLOCATIONS, []);

    const payNum = 'PAY-' + new Date().getFullYear() + '-' + String(payments.length + 1).padStart(4, '0');

    const newPayment: Payment = {
      id: 'pay-' + Date.now(),
      organizationId: orgId,
      paymentNumber: payNum,
      customerId: data.customerId,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      paymentDate: data.paymentDate,
      notes: data.notes,
      createdAt: new Date().toISOString(),
    };

    // If an invoice is targeted for allocation
    if (data.invoiceId) {
      const invIndex = invoices.findIndex((i) => i.id === data.invoiceId && i.organizationId === orgId);
      if (invIndex === -1) throw new Error('Target invoice not found in this organization');

      const inv = invoices[invIndex];
      if (inv.customerId !== data.customerId) {
        throw new Error(
          `Customer mismatch: Payment customer (${data.customerId}) does not match invoice customer (${inv.customerId})`
        );
      }
      const remainingBalance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);

      if (data.amount > remainingBalance) {
        throw new Error(
          `Payment amount (₹ ${data.amount}) exceeds outstanding invoice balance (₹ ${remainingBalance}). Overpayment policy prevents excess credit without customer advance authorization.`
        );
      }

      const newPaid = inv.totalPaid + data.amount;
      const isPaidFull = newPaid >= inv.totalAmount;

      invoices[invIndex] = {
        ...inv,
        totalPaid: newPaid,
        status: isPaidFull ? 'PAID' : 'PARTIALLY_PAID',
        updatedAt: new Date().toISOString(),
      };
      this.setItem(STORAGE_KEYS.INVOICES, invoices);

      // Record allocation
      const newAlloc: PaymentAllocation = {
        id: 'alloc-' + Date.now(),
        paymentId: newPayment.id,
        invoiceId: inv.id,
        amountAllocated: data.amount,
        createdAt: new Date().toISOString(),
      };
      allocations.push(newAlloc);
      this.setItem(STORAGE_KEYS.PAYMENT_ALLOCATIONS, allocations);
    }

    payments.push(newPayment);
    this.setItem(STORAGE_KEYS.PAYMENTS, payments);

    this.logAuditEvent(orgId, 'RECORD_PAYMENT', 'PAYMENT', newPayment.id, {
      paymentNumber: payNum,
      amount: data.amount,
      invoiceId: data.invoiceId,
    });

    return newPayment;
  }

  // --- Audit Logs ---
  public getAuditEvents(orgId: string): AuditEvent[] {
    this.initialize();
    return this.getItem<AuditEvent[]>(STORAGE_KEYS.AUDIT_EVENTS, [])
      .filter((a) => a.organizationId === orgId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public logAuditEvent(
    orgId: string,
    action: string,
    entityType: string,
    entityId?: string,
    details?: Record<string, unknown>
  ): void {
    const events = this.getItem<AuditEvent[]>(STORAGE_KEYS.AUDIT_EVENTS, []);
    events.push({
      id: 'aud-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      organizationId: orgId,
      actorId: 'u0000000-0000-0000-0000-000000000001',
      actorEmail: 'admin@atlas-os.local',
      action,
      entityType,
      entityId,
      details,
      createdAt: new Date().toISOString(),
    });
    this.setItem(STORAGE_KEYS.AUDIT_EVENTS, events);
  }

  // --- Dashboard Real-time Metrics ---
  public getDashboardMetrics(orgId: string): DashboardMetrics {
    this.initialize();
    const orders = this.getSalesOrders(orgId);
    const invoices = this.getInvoices(orgId);
    const payments = this.getPayments(orgId);
    const products = this.getProducts(orgId);

    const todayStr = new Date().toISOString().split('T')[0];

    // Today's sales (confirmed/fulfilled orders placed today)
    const todaySales = orders
      .filter((o) => o.orderDate === todayStr && o.status !== 'CANCELLED')
      .reduce((sum, o) => sum + o.totalAmount, 0);

    // Total outstanding receivables
    const totalReceivables = invoices
      .filter((i) => i.status !== 'CANCELLED' && i.status !== 'PAID')
      .reduce((sum, i) => sum + (i.totalAmount - i.totalPaid), 0);

    // Overdue invoices
    const overdueInvoicesCount = invoices.filter(
      (i) => i.status !== 'CANCELLED' && i.status !== 'PAID' && i.dueDate < todayStr
    ).length;

    // Low stock items (stock <= reorderThreshold)
    const lowStockProducts = products.filter(
      (p) => (p.currentStock || 0) <= p.reorderThreshold && p.isActive
    );

    // Total inventory valuation
    const totalStockValue = products.reduce(
      (sum, p) => sum + (p.currentStock || 0) * p.purchaseCost,
      0
    );

    return {
      todaySales,
      ordersCount: orders.length,
      totalReceivables,
      overdueInvoicesCount,
      lowStockItemsCount: lowStockProducts.length,
      totalStockValue,
      recentOrders: orders.slice(0, 5),
      recentPayments: payments.slice(0, 5),
      lowStockProducts,
    };
  }
}

export const storage = new StorageEngine();
