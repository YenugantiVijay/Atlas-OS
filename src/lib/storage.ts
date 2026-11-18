import { validateOnlineReference, type OnlineOrderReference, type OrderDispatch } from '@/lib/online-orders';
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
  UOM,
} from '@/types';
import { calculateInvoiceBalance, calculateDocumentTotals, parseTaxRate, roundMoney } from './money';

/**
 * Calculates Indian Financial Year string (e.g. '25-26', '26-27') from date or year.
 * Under Indian GST Rule 46, FY runs April 1 to March 31.
 */
export function getIndianFinancialYear(dateOrYear?: Date | string | number): string {
  if (dateOrYear instanceof Date) {
    const month = dateOrYear.getMonth(); // 0 to 11
    const year = dateOrYear.getFullYear();
    const startYear = month < 3 ? year - 1 : year;
    const endYear = startYear + 1;
    return `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  }

  if (typeof dateOrYear === 'string') {
    if (/^\d{2}-\d{2}$/.test(dateOrYear)) {
      return dateOrYear;
    }
    const parsed = new Date(dateOrYear);
    if (!isNaN(parsed.getTime())) {
      return getIndianFinancialYear(parsed);
    }
  }

  if (typeof dateOrYear === 'number') {
    const now = new Date();
    if (dateOrYear === now.getFullYear()) {
      return getIndianFinancialYear(now);
    }
    const startYear = dateOrYear;
    const endYear = startYear + 1;
    return `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  }

  return getIndianFinancialYear(new Date());
}

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
  GOODS_RECEIPTS: 'atlas_goods_receipts_v1',
  PURCHASE_ORDERS: 'atlas_purchase_orders_v1',
  INVENTORY_ADJ_IDEMPOTENCY: 'atlas_inventory_adj_idempotency_v1',
  CURRENT_ORG_ID: 'atlas_current_org_id_v1',
  CURRENT_USER: 'atlas_current_user_v1',
  IMPORT_BATCHES: 'atlas_import_batches_v1',
};

const LOCAL_OWNER: User = {
  id: 'u0000000-0000-0000-0000-000000000001',
  email: '',
  fullName: 'Local owner',
};

const WORKSPACE_UPGRADE_KEY = 'atlas_empty_workspace_upgrade_v1';
const LEGACY_ORGS = new Set([
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000002',
]);
const LEGACY_ROWS = /^(?:[pcsm]0000000-0000-0000-0000-00000000000[1-8]|m-0[1-8]|(?:ord|inv|pay|alloc|audit)-001)$/;
const WORKSPACE_STORAGE_KEYS = new Set<string>(Object.values(STORAGE_KEYS));
const FIRST_LEGACY_ORG = 'a0000000-0000-0000-0000-000000000001';

type LegacyRow = Partial<{
  id: string;
  organizationId: string;
  entityId: string;
  paymentId: string;
  invoiceId: string;
  archivedAt: string;
}>;

function belongsToLegacyOrg(row: LegacyRow, key: string, orgId: string) {
  return row.organizationId === orgId || row.entityId === orgId ||
    (key === STORAGE_KEYS.PAYMENT_ALLOCATIONS && orgId === FIRST_LEGACY_ORG &&
      (row.paymentId === 'pay-001' || row.invoiceId === 'inv-001'));
}

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
    this.removeUnusedLegacyWorkspaces();
    const orgs = this.getItem<Organization[]>(STORAGE_KEYS.ORGS, []);
    if (this.initialized && orgs.length > 0) return;
    if (orgs.length === 0) {
      const now = new Date().toISOString();
      const owner = this.getItem<User>(STORAGE_KEYS.CURRENT_USER, LOCAL_OWNER);
      const workspace: Organization = {
        id: 'local-workspace',
        name: 'Local workspace',
        currency: 'INR',
        createdAt: now,
        updatedAt: now,
      };
      this.setItem(STORAGE_KEYS.ORGS, [workspace]);
      this.setCurrentOrgId(workspace.id);
      const members = this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []);
      this.setItem(STORAGE_KEYS.MEMBERSHIPS, [...members, {
        id: 'local-workspace-owner',
        organizationId: workspace.id,
        userId: owner.id,
        role: 'owner',
        isActive: true,
        createdAt: now,
        user: owner,
      }]);
    }
    this.initialized = true;
  }

  private removeUnusedLegacyWorkspaces(): void {
    if (localStorage.getItem(WORKSPACE_UPGRADE_KEY)) return;
    const orgs = this.getItem<Organization[]>(STORAGE_KEYS.ORGS, []);
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null);
    const stored = keys.map((key) => ({
      key,
      raw: localStorage.getItem(key) ?? '',
    }));
    const rawActiveOrg = localStorage.getItem(STORAGE_KEYS.CURRENT_ORG_ID);
    const activeOrg = this.getItem(STORAGE_KEYS.CURRENT_ORG_ID, rawActiveOrg);
    const removable = orgs.filter((org) => {
      if (!LEGACY_ORGS.has(org.id) || org.createdAt !== org.updatedAt) return false;
      return stored.every(({ key, raw }) => {
        if (key === STORAGE_KEYS.ORGS || key === STORAGE_KEYS.CURRENT_ORG_ID) return true;
        if (key.includes(org.id)) return false;
        if (!raw.includes(org.id) &&
          !(key === STORAGE_KEYS.PAYMENT_ALLOCATIONS && org.id === FIRST_LEGACY_ORG && /pay-001|inv-001/.test(raw))) return true;
        if (!WORKSPACE_STORAGE_KEYS.has(key)) return false;
        const rows = this.getItem<LegacyRow[] | null>(key, null);
        if (!Array.isArray(rows)) return false;
        return rows.every((row) => !row || typeof row !== 'object' ||
          !belongsToLegacyOrg(row, key, org.id) ||
          (LEGACY_ROWS.test(row.id ?? '') && !row.archivedAt));
      });
    });
    if (removable.length) {
      const removedIds = new Set(removable.map(({ id }) => id));
      for (const key of WORKSPACE_STORAGE_KEYS) {
        if (key === STORAGE_KEYS.ORGS) continue;
        const rows = this.getItem<LegacyRow[] | null>(key, null);
        if (!Array.isArray(rows)) continue;
        const remaining = rows.filter((row) => !row || typeof row !== 'object' ||
          !removable.some(({ id }) => belongsToLegacyOrg(row, key, id)));
        if (remaining.length !== rows.length) this.setItem(key, remaining);
      }
      this.setItem(STORAGE_KEYS.ORGS, orgs.filter(({ id }) => !removedIds.has(id)));
      if (activeOrg && removedIds.has(activeOrg)) localStorage.removeItem(STORAGE_KEYS.CURRENT_ORG_ID);
      const user = this.getItem<User>(STORAGE_KEYS.CURRENT_USER, LOCAL_OWNER);
      if (user.id === LOCAL_OWNER.id && user.email === 'vijay@srilakshmielectricals.in' &&
        ['Vijay Kumar', 'Vijay Kumar (Distributor Admin)'].includes(user.fullName) && !user.avatarUrl) {
        this.setItem(STORAGE_KEYS.CURRENT_USER, LOCAL_OWNER);
      }
      this.initialized = false;
    }
    this.setItem(WORKSPACE_UPGRADE_KEY, true);
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
      userId: this.getCurrentUser().id,
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
    return this.getItem<User>(STORAGE_KEYS.CURRENT_USER, LOCAL_OWNER);
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

  public addMembership(membership: Membership): void {
    this.initialize();
    const mems = this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []);
    mems.push(membership);
    this.setItem(STORAGE_KEYS.MEMBERSHIPS, mems);
  }

  public updateMembership(id: string, updates: Partial<Membership>): void {
    this.initialize();
    const mems = this.getItem<Membership[]>(STORAGE_KEYS.MEMBERSHIPS, []);
    const idx = mems.findIndex((m) => m.id === id);
    if (idx !== -1) {
      mems[idx] = { ...mems[idx], ...updates };
      this.setItem(STORAGE_KEYS.MEMBERSHIPS, mems);
    }
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
    if (openingStock !== undefined && openingStock < 0) {
      throw new Error(`Opening stock cannot be negative (got ${openingStock})`);
    }
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []);

    // Check SKU uniqueness within organization
    const exists = products.some((p) => p.organizationId === orgId && p.sku.toLowerCase() === data.sku.toLowerCase());
    if (exists) {
      throw new Error(`Product with SKU "${data.sku}" already exists in this organization.`);
    }

    const newProduct: Product = {
      ...data,
      id: 'prod-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
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

  public removeUnreferencedProduct(orgId: string, productId: string): { success: boolean; reason?: string } {
    this.initialize();
    const products = this.getItem<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    const prod = products.find((p) => p.id === productId && p.organizationId === orgId);
    if (!prod) return { success: false, reason: 'Product not found.' };

    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []).filter((o) => o.organizationId === orgId);
    const hasOrder = orders.some((o) => o.items?.some((i) => i.productId === productId));
    if (hasOrder) return { success: false, reason: `Product ${prod.sku} is referenced in existing sales orders.` };

    const quotes = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []).filter((q) => q.organizationId === orgId);
    const hasQuote = quotes.some((q) => q.items?.some((i) => i.productId === productId));
    if (hasQuote) return { success: false, reason: `Product ${prod.sku} is referenced in existing quotations.` };

    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter((inv) => inv.organizationId === orgId);
    const hasInvoice = invoices.some((inv) => inv.items?.some((i) => i.productId === productId));
    if (hasInvoice) return { success: false, reason: `Product ${prod.sku} is referenced in existing invoices.` };

    const movements = this.getItem<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, []).filter((m) => m.organizationId === orgId);
    const hasDispatches = movements.some((m) => m.productId === productId && m.movementType !== 'OPENING_STOCK');
    if (hasDispatches) return { success: false, reason: `Product ${prod.sku} has operational stock movement history.` };

    // Unreferenced - safely remove product and opening stock movement
    this.setItem(STORAGE_KEYS.PRODUCTS, products.filter((p) => p.id !== productId));
    this.setItem(STORAGE_KEYS.STOCK_MOVEMENTS, movements.filter((m) => m.productId !== productId));
    this.logAuditEvent(orgId, 'UNDO_IMPORT_PRODUCT', 'PRODUCT', productId, { sku: prod.sku, name: prod.name });
    return { success: true };
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

  public removeUnreferencedCustomer(orgId: string, customerId: string): { success: boolean; reason?: string } {
    this.initialize();
    const customers = this.getItem<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const cust = customers.find((c) => c.id === customerId && c.organizationId === orgId);
    if (!cust) return { success: false, reason: 'Customer not found.' };

    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []).filter((o) => o.organizationId === orgId);
    if (orders.some((o) => o.customerId === customerId)) {
      return { success: false, reason: `Customer ${cust.name} has existing sales orders.` };
    }

    const quotes = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []).filter((q) => q.organizationId === orgId);
    if (quotes.some((q) => q.customerId === customerId)) {
      return { success: false, reason: `Customer ${cust.name} has existing quotations.` };
    }

    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter((inv) => inv.organizationId === orgId);
    if (invoices.some((inv) => inv.customerId === customerId)) {
      return { success: false, reason: `Customer ${cust.name} has existing invoices.` };
    }

    const payments = this.getItem<Payment[]>(STORAGE_KEYS.PAYMENTS, []).filter((p) => p.organizationId === orgId);
    if (payments.some((p) => p.customerId === customerId)) {
      return { success: false, reason: `Customer ${cust.name} has recorded payment ledger entries.` };
    }

    this.setItem(STORAGE_KEYS.CUSTOMERS, customers.filter((c) => c.id !== customerId));
    this.logAuditEvent(orgId, 'UNDO_IMPORT_CUSTOMER', 'CUSTOMER', customerId, { name: cust.name });
    return { success: true };
  }

  // --- Import Batches ---
  public getImportBatches(orgId: string): Array<{
    batchId: string;
    organizationId: string;
    dataset: 'products' | 'customers';
    createdAt: string;
    count: number;
    recordIds: string[];
  }> {
    this.initialize();
    const batches = this.getItem<any[]>(STORAGE_KEYS.IMPORT_BATCHES, []);
    return batches.filter((b) => b.organizationId === orgId);
  }

  public saveImportBatch(orgId: string, batch: {
    batchId: string;
    dataset: 'products' | 'customers';
    count: number;
    recordIds: string[];
  }): void {
    this.initialize();
    const batches = this.getItem<any[]>(STORAGE_KEYS.IMPORT_BATCHES, []);
    batches.unshift({
      ...batch,
      organizationId: orgId,
      createdAt: new Date().toISOString(),
    });
    this.setItem(STORAGE_KEYS.IMPORT_BATCHES, batches);
  }

  public removeImportBatchRecord(orgId: string, batchId: string): void {
    this.initialize();
    const batches = this.getItem<any[]>(STORAGE_KEYS.IMPORT_BATCHES, []);
    this.setItem(
      STORAGE_KEYS.IMPORT_BATCHES,
      batches.filter((b) => !(b.batchId === batchId && b.organizationId === orgId))
    );
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

  public updateSupplier(orgId: string, id: string, updates: Partial<Supplier>): Supplier {
    this.initialize();
    const suppliers = this.getItem<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []);
    const index = suppliers.findIndex((s) => s.id === id && s.organizationId === orgId);
    if (index === -1) throw new Error('Supplier not found in this organization');

    const updated: Supplier = {
      ...suppliers[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    suppliers[index] = updated;
    this.setItem(STORAGE_KEYS.SUPPLIERS, suppliers);
    this.logAuditEvent(orgId, 'UPDATE_SUPPLIER', 'SUPPLIER', id, updates);
    return updated;
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
      id: 'mov-' + (globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${movements.length}`),
      createdAt: new Date().toISOString(),
    };
    movements.push(newMovement);
    this.setItem(STORAGE_KEYS.STOCK_MOVEMENTS, movements);
    return newMovement;
  }

  public adjustStock(
    orgId: string,
    productId: string,
    quantityChange: number,
    notes: string,
    idempotencyKey: string
  ): StockMovement {
    this.initialize();
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey.trim())) {
      throw new Error(`A valid UUID idempotency key is required for inventory adjustments (got: "${idempotencyKey}")`);
    }
    const trimmedKey = idempotencyKey.trim();

    if (quantityChange === 0) {
      throw new Error('Adjustment quantity cannot be 0.');
    }
    if (!notes || !notes.trim()) {
      throw new Error('An audit note is required for all manual inventory adjustments.');
    }

    // Idempotency replay check
    const idempotencyMap = this.getItem<Record<string, { movementId: string; requestHash: string }>>(
      STORAGE_KEYS.INVENTORY_ADJ_IDEMPOTENCY,
      {}
    );
    const compositeKey = `${orgId}:${trimmedKey}`;
    const requestHash = `${orgId}|${productId}|${quantityChange}|${notes.trim()}`;
    if (idempotencyMap[compositeKey]) {
      const existing = idempotencyMap[compositeKey];
      if (existing.requestHash === requestHash) {
        const movements = this.getStockMovements(orgId);
        const found = movements.find((m) => m.id === existing.movementId);
        if (found) return found;
      } else {
        throw new Error(
          `Idempotency conflict: Key ${trimmedKey} was already used with a different request payload in organization ${orgId}`
        );
      }
    }

    const product = this.getProductById(orgId, productId);
    if (!product) throw new Error('Product not found in this organization');

    const currentStock = product.currentStock || 0;
    const resultingStock = currentStock + quantityChange;
    if (resultingStock < 0) {
      throw new Error(
        `Insufficient stock for product "${product.name}" (SKU: ${product.sku}). Available: ${currentStock}, Requested change: ${quantityChange}, Resulting balance: ${resultingStock} (Negative stock is not permitted).`
      );
    }

    const movement = this.recordStockMovement({
      organizationId: orgId,
      productId,
      quantityChange,
      movementType: 'ADJUSTMENT',
      referenceType: 'MANUAL_ADJUSTMENT',
      notes: notes.trim(),
    });

    const idempotencyMapAfter = this.getItem<Record<string, { movementId: string; requestHash: string }>>(
      STORAGE_KEYS.INVENTORY_ADJ_IDEMPOTENCY,
      {}
    );
    idempotencyMapAfter[compositeKey] = { movementId: movement.id, requestHash };
    this.setItem(STORAGE_KEYS.INVENTORY_ADJ_IDEMPOTENCY, idempotencyMapAfter);

    this.logAuditEvent(orgId, 'ADJUST_INVENTORY', 'PRODUCT', productId, {
      movementId: movement.id,
      quantityChange,
      previousStock: currentStock,
      newStock: resultingStock,
      notes: notes.trim(),
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

  public allocateDocumentNumber(
    orgId: string,
    docType: 'QUOTATION' | 'SALES_ORDER' | 'INVOICE' | 'RECEIPT',
    yearOrDate: number | string | Date = new Date()
  ): string {
    let prefix = 'QT';
    let existingNumbers: string[] = [];

    const fy = getIndianFinancialYear(yearOrDate);
    let calendarYear: number;
    if (typeof yearOrDate === 'number') {
      calendarYear = yearOrDate;
    } else if (yearOrDate instanceof Date) {
      calendarYear = yearOrDate.getFullYear();
    } else if (typeof yearOrDate === 'string') {
      const parsed = new Date(yearOrDate);
      calendarYear = !isNaN(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
    } else {
      calendarYear = new Date().getFullYear();
    }

    if (docType === 'QUOTATION') {
      prefix = 'QT';
      const items = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []).filter((q) => q.organizationId === orgId);
      existingNumbers = items.map((q) => q.quotationNumber);
    } else if (docType === 'SALES_ORDER') {
      prefix = 'SO';
      const items = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []).filter((o) => o.organizationId === orgId);
      existingNumbers = items.map((o) => o.orderNumber);
    } else if (docType === 'INVOICE') {
      prefix = 'ATL';
      const items = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter((i) => i.organizationId === orgId);
      existingNumbers = items.map((i) => i.invoiceNumber);
    } else if (docType === 'RECEIPT') {
      prefix = 'RCP';
      const items = this.getItem<Payment[]>(STORAGE_KEYS.PAYMENTS, []).filter((p) => p.organizationId === orgId);
      existingNumbers = items.map((p) => p.paymentNumber);
    }

    // Specific Indian GST Financial Year logic for INVOICE (Rule 46 compliant)
    if (docType === 'INVOICE') {
      const pattern = new RegExp(`^ATL[/\\\\]${fy}[/\\\\](\\d+)$`);
      let maxSeq = 0;
      for (const num of existingNumbers) {
        const match = num ? num.match(pattern) : null;
        if (match) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxSeq) {
            maxSeq = val;
          }
        }
      }

      let nextSeq = maxSeq + 1;
      const formatCandidate = (seq: number) =>
        `ATL/${fy}/${seq < 10000 ? String(seq).padStart(4, '0') : String(seq)}`;

      let candidate = formatCandidate(nextSeq);
      while (existingNumbers.includes(candidate)) {
        nextSeq++;
        candidate = formatCandidate(nextSeq);
      }

      return candidate;
    }

    // Default sequential format for QUOTATION, SALES_ORDER, RECEIPT
    const pattern = new RegExp(`^${prefix}-${calendarYear}-(\\d+)$`);
    let maxSeq = 0;
    for (const num of existingNumbers) {
      const match = num ? num.match(pattern) : null;
      if (match) {
        const val = parseInt(match[1], 10);
        if (!isNaN(val) && val > maxSeq) {
          maxSeq = val;
        }
      }
    }

    // Advance candidate until guaranteed unique within organization (no truncation >9999)
    let nextSeq = maxSeq + 1;
    const formatCandidate = (seq: number) =>
      `${prefix}-${calendarYear}-${seq < 10000 ? String(seq).padStart(4, '0') : String(seq)}`;

    let candidate = formatCandidate(nextSeq);
    while (existingNumbers.includes(candidate)) {
      nextSeq++;
      candidate = formatCandidate(nextSeq);
    }

    return candidate;
  }

  public createQuotation(orgId: string, data: { customerId: string; validUntil: string; notes?: string; items: any[] }): Quotation {
    this.initialize();
    const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []);
    const num = this.allocateDocumentNumber(orgId, 'QUOTATION');

    const docTotals = calculateDocumentTotals(
      data.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      }))
    );

    const items = data.items.map((it, idx) => {
      const calc = docTotals.items[idx];
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
        taxRate: parseTaxRate(it.taxRate, 18),
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
      subtotal: docTotals.grossSubtotal,
      discountAmount: docTotals.discountTotal,
      taxAmount: docTotals.taxAmount,
      totalAmount: docTotals.totalAmount,
      totalsVersion: 2,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    };

    quotations.push(newQuotation);
    this.setItem(STORAGE_KEYS.QUOTATIONS, quotations);
    this.logAuditEvent(orgId, 'CREATE_QUOTATION', 'QUOTATION', newQuotation.id, { quotationNumber: num, totalAmount: newQuotation.totalAmount });
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
    const orderNum = this.allocateDocumentNumber(orgId, 'SALES_ORDER');

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
      totalsVersion: quotation.totalsVersion || 2,
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

  public deleteQuotation(orgId: string, quotationId: string): void {
    this.initialize();
    const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []);
    const index = quotations.findIndex((q) => q.id === quotationId && q.organizationId === orgId);
    if (index === -1) {
      throw new Error('Quotation not found in this organization');
    }

    // ON DELETE RESTRICT: Check if any sales orders reference this quotation
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const hasLinkedOrder = orders.some((o) => o.quotationId === quotationId && o.organizationId === orgId);
    if (hasLinkedOrder) {
      throw new Error(
        'Integrity constraint violation (ON DELETE RESTRICT): Cannot delete quotation referenced by active sales orders.'
      );
    }

    quotations.splice(index, 1);
    this.setItem(STORAGE_KEYS.QUOTATIONS, quotations);
    this.logAuditEvent(orgId, 'DELETE_QUOTATION', 'QUOTATION', quotationId);
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

  public createSalesOrder(orgId: string, data: { customerId: string; orderDate: string; quotationId?: string; notes?: string; onlineOrder?: OnlineOrderReference; items: any[] }): SalesOrder {
    this.initialize();

    if (data.quotationId) {
      const quotations = this.getItem<Quotation[]>(STORAGE_KEYS.QUOTATIONS, []);
      const quote = quotations.find((q) => q.id === data.quotationId && q.organizationId === orgId);
      if (!quote) {
        throw new Error('Referenced quotation not found in this organization');
      }
    }

    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const onlineOrder = data.onlineOrder && validateOnlineReference(data.onlineOrder);
    if (onlineOrder && orders.some(order => order.organizationId === orgId
      && order.onlineOrder?.channel === onlineOrder.channel
      && order.onlineOrder.reference.toLowerCase() === onlineOrder.reference.toLowerCase())) {
      throw new Error('An order with this sales channel and reference already exists.');
    }
    const num = this.allocateDocumentNumber(orgId, 'SALES_ORDER');

    const docTotals = calculateDocumentTotals(
      data.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      }))
    );

    const items = data.items.map((it, idx) => {
      const calc = docTotals.items[idx];
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
        taxRate: parseTaxRate(it.taxRate, 18),
        lineSubtotal: calc.taxableAmount,
        lineTax: calc.taxAmount,
        lineTotal: calc.totalAmount,
      };
    });

    const newOrder: SalesOrder = {
      id: 'ord-' + crypto.randomUUID(),
      organizationId: orgId,
      orderNumber: num,
      customerId: data.customerId,
      quotationId: data.quotationId,
      status: 'DRAFT',
      orderDate: data.orderDate,
      subtotal: docTotals.grossSubtotal,
      discountAmount: docTotals.discountTotal,
      taxAmount: docTotals.taxAmount,
      totalAmount: docTotals.totalAmount,
      totalsVersion: 2,
      notes: data.notes,
      ...(onlineOrder && { onlineOrder }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    };

    orders.push(newOrder);
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
    this.logAuditEvent(orgId, 'CREATE_ORDER', 'SALES_ORDER', newOrder.id, { orderNumber: num, totalAmount: newOrder.totalAmount });
    return newOrder;
  }

  public recordOnlineDispatch(orgId: string, orderId: string, carrier: string, tracking: string, expected: string | null): OrderDispatch {
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const order = orders.find(item => item.id === orderId && item.organizationId === orgId);
    if (!order?.onlineOrder || !['CONFIRMED', 'FULFILLED'].includes(order.status)) {
      throw new Error('Dispatch requires a confirmed online order.');
    }
    if (order.dispatch?.carrier === carrier && order.dispatch?.tracking === tracking) return order.dispatch;
    if ((order.dispatch?.recordedAt ?? null) !== expected) {
      throw new Error('Dispatch details changed. Reopen the order to review the latest details.');
    }
    const dispatch = { carrier, tracking, recordedAt: new Date().toISOString() };
    order.dispatch = dispatch;
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
    this.logAuditEvent(orgId, 'ONLINE_ORDER_DISPATCH_RECORDED', 'SALES_ORDER', orderId, { carrier });
    return dispatch;
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
    if (order.status === 'CONFIRMED') {
      return order;
    }
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

  public deleteSalesOrder(orgId: string, orderId: string): void {
    this.initialize();
    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const index = orders.findIndex((o) => o.id === orderId && o.organizationId === orgId);
    if (index === -1) {
      throw new Error('Sales order not found in this organization');
    }

    // ON DELETE RESTRICT: Check if any invoices reference this sales order
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const hasLinkedInvoice = invoices.some((i) => i.salesOrderId === orderId && i.organizationId === orgId);
    if (hasLinkedInvoice) {
      throw new Error(
        'Integrity constraint violation (ON DELETE RESTRICT): Cannot delete sales order referenced by active invoices.'
      );
    }

    orders.splice(index, 1);
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
    this.logAuditEvent(orgId, 'DELETE_SALES_ORDER', 'SALES_ORDER', orderId);
  }

  public cancelSalesOrder(
    orgId: string,
    orderId: string,
    reason: string = 'Cancelled by user',
    userRole?: Role | null
  ): SalesOrder {
    this.initialize();
    if (!userRole || !['owner', 'admin', 'sales'].includes(userRole)) {
      throw new Error(`Permission denied: Role "${userRole || 'unassigned'}" cannot cancel sales orders.`);
    }

    const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
    const index = orders.findIndex((o) => o.id === orderId && o.organizationId === orgId);
    if (index === -1) throw new Error('Sales order not found');

    const order = orders[index];
    if (order.status === 'CANCELLED') {
      return order;
    }

    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const hasActiveInvoice = invoices.some(
      (i) => i.salesOrderId === orderId && i.organizationId === orgId && i.status !== 'CANCELLED'
    );
    if (hasActiveInvoice) {
      throw new Error('Cannot cancel sales order with active invoices. Cancel or void linked invoices first.');
    }

    if (order.status === 'CONFIRMED' || order.status === 'FULFILLED') {
      for (const item of order.items || []) {
        this.recordStockMovement({
          organizationId: orgId,
          productId: item.productId,
          quantityChange: item.quantity,
          movementType: 'RETURN_INWARD',
          referenceType: 'SALES_ORDER_CANCELLATION',
          referenceId: order.id,
          notes: `Stock restored upon cancellation of ${order.orderNumber}: ${reason}`,
        });
      }
    }

    const updated: SalesOrder = {
      ...order,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    };
    orders[index] = updated;
    this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);

    this.logAuditEvent(orgId, 'CANCEL_ORDER', 'SALES_ORDER', order.id, {
      orderNumber: order.orderNumber,
      previousStatus: order.status,
      reason,
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
    const orderIndex = orders.findIndex((o) => o.id === orderId && o.organizationId === orgId);
    if (orderIndex === -1) throw new Error('Sales order not found');
    const order = orders[orderIndex];

    if (order.status !== 'CONFIRMED') {
      throw new Error(`Cannot invoice order in status "${order.status}". Order must be CONFIRMED.`);
    }

    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const existing = invoices.find(
      (inv) => inv.organizationId === orgId && inv.salesOrderId === order.id && inv.status !== 'CANCELLED'
    );
    if (existing) {
      throw new Error(`Sales order ${order.orderNumber} has already been invoiced under invoice ${existing.invoiceNumber}.`);
    }

    const invNum = this.allocateDocumentNumber(orgId, 'INVOICE');

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
      totalsVersion: order.totalsVersion || 2,
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

    // Atomic storage mutation with rollback protection
    const originalOrders = [...orders];
    const originalInvoices = [...invoices];

    try {
      orders[orderIndex] = {
        ...order,
        status: 'FULFILLED',
        updatedAt: new Date().toISOString(),
      };
      invoices.push(newInvoice);

      this.setItem(STORAGE_KEYS.INVOICES, invoices);
      this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
    } catch (err) {
      this.setItem(STORAGE_KEYS.INVOICES, originalInvoices);
      this.setItem(STORAGE_KEYS.SALES_ORDERS, originalOrders);
      throw err;
    }

    this.logAuditEvent(orgId, 'ISSUE_INVOICE', 'INVOICE', newInvoice.id, {
      invoiceNumber: invNum,
      orderNumber: order.orderNumber,
      totalAmount: newInvoice.totalAmount,
    });

    return newInvoice;
  }

  public createInvoice(
    orgId: string,
    data: {
      customerId: string;
      salesOrderId?: string;
      invoiceDate: string;
      dueDate: string;
      notes?: string;
      items: Array<{
        productId: string;
        productName: string;
        productSku: string;
        uom: UOM;
        quantity: number;
        unitPrice: number;
        discountPercent: number;
        taxRate: number;
      }>;
    }
  ): Invoice {
    this.initialize();
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const invNum = this.allocateDocumentNumber(orgId, 'INVOICE', data.invoiceDate);

    const docTotals = calculateDocumentTotals(
      data.items.map((it) => ({
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: it.taxRate,
      }))
    );

    const items = data.items.map((it, idx) => {
      const calc = docTotals.items[idx];
      return {
        id: 'inv-item-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        invoiceId: '',
        productId: it.productId,
        productName: it.productName,
        productSku: it.productSku,
        uom: it.uom,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountPercent: it.discountPercent,
        taxRate: parseTaxRate(it.taxRate, 18),
        lineSubtotal: calc.taxableAmount,
        lineTax: calc.taxAmount,
        lineTotal: calc.totalAmount,
      };
    });

    const newInvoice: Invoice = {
      id: 'inv-' + Date.now(),
      organizationId: orgId,
      invoiceNumber: invNum,
      customerId: data.customerId,
      salesOrderId: data.salesOrderId,
      status: (data as any).status || 'ISSUED',
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      subtotal: docTotals.grossSubtotal,
      discountAmount: docTotals.discountTotal,
      taxAmount: docTotals.taxAmount,
      totalAmount: docTotals.totalAmount,
      totalPaid: 0,
      totalsVersion: 2,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items,
    };

    invoices.push(newInvoice);
    this.setItem(STORAGE_KEYS.INVOICES, invoices);
    this.logAuditEvent(orgId, 'ISSUE_INVOICE', 'INVOICE', newInvoice.id, {
      invoiceNumber: invNum,
      totalAmount: newInvoice.totalAmount,
    });

    return newInvoice;
  }

  public cancelInvoice(orgId: string, invoiceId: string, reason: string = 'Cancelled by user'): Invoice {
    this.initialize();
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const index = invoices.findIndex((i) => i.id === invoiceId && i.organizationId === orgId);
    if (index === -1) throw new Error('Invoice not found');

    const invoice = invoices[index];
    if (invoice.status === 'CANCELLED') {
      return invoice;
    }

    if (invoice.totalPaid > 0) {
      throw new Error(
        `Cannot cancel invoice ${invoice.invoiceNumber} with recorded payments (₹${invoice.totalPaid} paid). Reallocate or refund payments first.`
      );
    }

    const updated: Invoice = {
      ...invoice,
      status: 'CANCELLED',
      updatedAt: new Date().toISOString(),
    };
    invoices[index] = updated;
    this.setItem(STORAGE_KEYS.INVOICES, invoices);

    if (invoice.salesOrderId) {
      const orders = this.getItem<SalesOrder[]>(STORAGE_KEYS.SALES_ORDERS, []);
      const orderIdx = orders.findIndex((o) => o.id === invoice.salesOrderId && o.organizationId === orgId);
      if (orderIdx !== -1 && orders[orderIdx].status === 'FULFILLED') {
        orders[orderIdx] = {
          ...orders[orderIdx],
          status: 'CONFIRMED',
          updatedAt: new Date().toISOString(),
        };
        this.setItem(STORAGE_KEYS.SALES_ORDERS, orders);
      }
    }

    this.logAuditEvent(orgId, 'CANCEL_INVOICE', 'INVOICE', invoice.id, {
      invoiceNumber: invoice.invoiceNumber,
      reason,
    });

    return updated;
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
      idempotencyKey?: string;
    },
    userRole?: Role | null
  ): Payment {
    this.initialize();
    if (!userRole || !['owner', 'admin', 'accounts'].includes(userRole)) {
      throw new Error(`Permission denied: Role "${userRole || 'unassigned'}" cannot record payments.`);
    }
    if (data.amount <= 0) throw new Error('Payment amount must be greater than zero.');

    const customers = this.getCustomers(orgId);
    const customer = customers.find((c) => c.id === data.customerId);
    if (!customer) {
      throw new Error(`Customer not found in organization ${orgId}`);
    }

    const payments = this.getItem<Payment[]>(STORAGE_KEYS.PAYMENTS, []);
    const invoices = this.getItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const allocations = this.getItem<PaymentAllocation[]>(STORAGE_KEYS.PAYMENT_ALLOCATIONS, []);

    // Idempotent replay check in mock storage
    if (data.idempotencyKey) {
      const existing = payments.find(
        (p) =>
          p.organizationId === orgId &&
          p.idempotencyKey === data.idempotencyKey &&
          p.customerId === data.customerId &&
          p.amount === data.amount
      );
      if (existing) {
        return existing;
      }
    }

    const payNum = this.allocateDocumentNumber(orgId, 'RECEIPT');

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
      idempotencyKey: data.idempotencyKey,
      createdAt: new Date().toISOString(),
    };

    // If an invoice is targeted for allocation
    if (data.invoiceId) {
      const invIndex = invoices.findIndex((i) => i.id === data.invoiceId && i.organizationId === orgId);
      if (invIndex === -1) throw new Error('Target invoice not found in this organization');

      const inv = invoices[invIndex];
      if (inv.status === 'CANCELLED') {
        throw new Error('Cannot allocate payment to cancelled invoice');
      }
      if (inv.status === 'DRAFT') {
        throw new Error('Cannot allocate payment to draft invoice. Invoice must be issued before recording payments.');
      }
      if (inv.status !== 'ISSUED' && inv.status !== 'PARTIALLY_PAID') {
        throw new Error(
          `Cannot allocate payment to invoice with status "${inv.status}". Only ISSUED or PARTIALLY_PAID invoices can receive payments.`
        );
      }
      if (inv.customerId !== data.customerId) {
        throw new Error(
          `Customer mismatch: Payment customer (${data.customerId}) does not match invoice customer (${inv.customerId})`
        );
      }
      const remainingBalance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);

      if (remainingBalance <= 0) {
        throw new Error(`Invoice ${inv.invoiceNumber} is already fully paid or has no outstanding balance.`);
      }

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

  public getPaymentsSummary(orgId: string): {
    totalCollected: number;
    paymentCount: number;
    totalReceivables: number;
    openInvoicesCount: number;
  } {
    this.initialize();
    const payments = this.getPayments(orgId);
    const invoices = this.getInvoices(orgId);

    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    const paymentCount = payments.length;

    const openInvoices = invoices.filter(
      (i) =>
        (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') &&
        calculateInvoiceBalance(i.totalAmount, i.totalPaid) > 0
    );

    const totalReceivables = openInvoices.reduce(
      (sum, i) => sum + calculateInvoiceBalance(i.totalAmount, i.totalPaid),
      0
    );

    return {
      totalCollected: roundMoney(totalCollected),
      paymentCount,
      totalReceivables: roundMoney(totalReceivables),
      openInvoicesCount: openInvoices.length,
    };
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
    this.initialize();
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

  // --- Goods Receipts (Deterministic Local Storage) ---
  public getGoodsReceipts(orgId: string): any[] {
    this.initialize();
    return this.getItem<any[]>(STORAGE_KEYS.GOODS_RECEIPTS, []).filter(
      (r) => r.organizationId === orgId
    );
  }

  public saveGoodsReceiptDraft(command: any): { receipt_id: string; status: 'DRAFT' } {
    this.initialize();
    const receipts = this.getItem<any[]>(STORAGE_KEYS.GOODS_RECEIPTS, []);
    const existingIdx = receipts.findIndex(
      (r) => r.id === command.receiptId && r.organizationId === command.organizationId
    );

    if (existingIdx >= 0 && receipts[existingIdx].status === 'POSTED') {
      return { receipt_id: command.receiptId, status: 'POSTED' as any };
    }

    const products = this.getProducts(command.organizationId);

    const enrichedLines = (command.lines || []).map((line: any) => {
      const prod = products.find((p) => p.id === line.productId);
      const packageTotal = (line.packageCounts || []).reduce((sum: number, c: number) => sum + (Number(c) || 0), 0);
      const totalUnits = line.totalUnits ?? (packageTotal + (Number(line.looseUnits) || 0));
      return {
        ...line,
        productName: prod?.name || line.productName || 'Received Item',
        sku: prod?.sku || line.sku || 'SKU',
        uom: prod?.uom || line.uom || 'Nos',
        totalUnits,
        usableUnits: line.usableUnits ?? totalUnits,
        damagedUnits: line.damagedUnits ?? 0,
      };
    });

    const record = {
      id: command.receiptId,
      organizationId: command.organizationId,
      supplierId: command.supplierId,
      supplierInvoiceNumber: command.supplierInvoiceNumber ? String(command.supplierInvoiceNumber).trim() : '',
      receivedOn: command.receivedOn,
      notes: command.notes ? String(command.notes).trim() : '',
      lines: enrichedLines,
      status: 'DRAFT',
      createdAt: existingIdx >= 0 ? receipts[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      receipts[existingIdx] = record;
    } else {
      receipts.push(record);
    }
    this.setItem(STORAGE_KEYS.GOODS_RECEIPTS, receipts);
    return { receipt_id: command.receiptId, status: 'DRAFT' };
  }

  public postGoodsReceipt(orgId: string, receiptId: string): {
    receipt_id: string;
    status: 'POSTED';
    idempotent_replay: boolean;
    total_units?: number;
  } {
    this.initialize();
    const receipts = this.getItem<any[]>(STORAGE_KEYS.GOODS_RECEIPTS, []);
    const idx = receipts.findIndex((r) => r.id === receiptId && r.organizationId === orgId);
    if (idx === -1) throw new Error('Goods receipt not found');

    const receipt = receipts[idx];
    if (receipt.status === 'POSTED') {
      return { receipt_id: receiptId, status: 'POSTED', idempotent_replay: true };
    }

    let totalUnits = 0;
    // Record stock movements for received goods in local stock movement ledger
    for (const line of receipt.lines || []) {
      const units = Number(line.usableUnits ?? line.totalUnits) || 0;
      totalUnits += units;
      if (units > 0 && line.productId) {
        this.recordStockMovement({
          organizationId: orgId,
          productId: line.productId,
          quantityChange: units,
          movementType: 'GOODS_RECEIVED',
          referenceType: 'GOODS_RECEIPT',
          referenceId: receipt.id,
          ...(line.batch && { receivedBatch: line.batch }),
          notes: `Goods received via supplier invoice ${receipt.supplierInvoiceNumber}`,
        });
      }
    }

    receipts[idx] = {
      ...receipt,
      status: 'POSTED',
      postedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.setItem(STORAGE_KEYS.GOODS_RECEIPTS, receipts);

    this.logAuditEvent(orgId, 'POST_GOODS_RECEIPT', 'GOODS_RECEIPT', receiptId, {
      supplierInvoiceNumber: receipt.supplierInvoiceNumber,
      totalUnits,
    });

    return { receipt_id: receiptId, status: 'POSTED', idempotent_replay: false, total_units: totalUnits };
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
      .filter((o) => o.orderDate === todayStr && (o.status === 'CONFIRMED' || o.status === 'FULFILLED'))
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
      (sum, p) => sum + Math.max(p.currentStock ?? 0, 0) * p.purchaseCost,
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
