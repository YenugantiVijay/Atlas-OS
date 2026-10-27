import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from './storage';
import { hasPermission, getRoleBadgeVariant } from './permissions';

describe('Security & Multi-Tenant Authorization Audit Tests', () => {
  const orgA = 'sec-org-001';
  const orgB = 'sec-org-002';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize();

    // Setup two completely isolated organizations
    storage.createOrganization({
      name: 'Alpha Electricals Ltd',
      legalName: 'Alpha Electricals Pvt Ltd',
      gstin: '29AAAAA1111A1Z1',
      pan: 'AAAAA1111A',
      phone: '+91 98450 00001',
      email: 'sales@alphaelec.com',
      addressLine1: 'Alpha Industrial Estate',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      currency: 'INR',
    });

    storage.createOrganization({
      name: 'Beta Power Systems',
      legalName: 'Beta Power Systems LLP',
      gstin: '36BBBBB2222B1Z2',
      pan: 'BBBBB2222B',
      phone: '+91 94400 00002',
      email: 'sales@betapower.com',
      addressLine1: 'Beta Tech Zone',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500001',
      currency: 'INR',
    });
  });

  describe('1. Unauthorized Users & Role Validation', () => {
    it('rejects all permissions when user has null or undefined role', () => {
      expect(hasPermission(null, 'org:manage')).toBe(false);
      expect(hasPermission(null, 'orders:confirm')).toBe(false);
      expect(hasPermission(null, 'payments:record')).toBe(false);
      expect(hasPermission(null, 'data:read')).toBe(false);

      expect(hasPermission(undefined, 'audit:read')).toBe(false);
      expect(hasPermission(undefined, 'products:create')).toBe(false);
    });

    it('rejects order confirmation when role is null or unassigned', () => {
      // Seed product and order in orgA
      const product = storage.createProduct(
        orgA,
        {
          sku: 'TEST-SKU-01',
          name: 'Test Wire',
          category: 'Wires',
          uom: 'Coils',
          purchaseCost: 100,
          sellingPrice: 150,
          taxRate: 18,
          reorderThreshold: 5,
          isActive: true,
        },
        50
      );

      const customer = storage.createCustomer(orgA, {
        name: 'Test Customer',
        phone: '9999999999',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: 5,
            unitPrice: 150,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // Role is null: must throw Permission Denied
      expect(() => storage.confirmSalesOrder(orgA, order.id, null)).toThrow(/Permission denied/);
    });

    it('rejects order confirmation when role is viewer or unauthorized', () => {
      const product = storage.createProduct(
        orgA,
        {
          sku: 'TEST-SKU-02',
          name: 'Test Conduit',
          category: 'Pipes',
          uom: 'Nos',
          purchaseCost: 50,
          sellingPrice: 80,
          taxRate: 18,
          reorderThreshold: 10,
          isActive: true,
        },
        30
      );

      const customer = storage.createCustomer(orgA, {
        name: 'Viewer Test Customer',
        phone: '9888888888',
        creditLimit: 20000,
        creditDays: 15,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: 2,
            unitPrice: 80,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      expect(() => storage.confirmSalesOrder(orgA, order.id, 'viewer')).toThrow(/Permission denied/);
      expect(() => storage.confirmSalesOrder(orgA, order.id, 'accounts')).toThrow(/Permission denied/);
      expect(() => storage.confirmSalesOrder(orgA, order.id, 'inventory')).toThrow(/Permission denied/);
    });

    it('returns default badge for null or undefined role', () => {
      expect(getRoleBadgeVariant(null)).toBe('default');
      expect(getRoleBadgeVariant(undefined)).toBe('default');
      expect(getRoleBadgeVariant('owner')).toBe('violet');
      expect(getRoleBadgeVariant('admin')).toBe('info');
      expect(getRoleBadgeVariant('sales')).toBe('success');
      expect(getRoleBadgeVariant('accounts')).toBe('warning');
    });
  });

  describe('2. Cross-Organization Tenant Isolation', () => {
    it('prevents recording payments for a customer belonging to another organization', () => {
      // Customer in Org B
      const customerB = storage.createCustomer(orgB, {
        name: 'Beta Exclusive Client',
        phone: '9777777777',
        creditLimit: 100000,
        creditDays: 30,
        isActive: true,
      });

      // Attempt to record payment for Customer B inside Org A
      expect(() =>
        storage.recordPayment(orgA, {
          customerId: customerB.id,
          amount: 5000,
          paymentMethod: 'UPI',
          paymentDate: '2026-03-01',
        })
      ).toThrow(/Customer not found in organization/);
    });

    it('prevents allocating payments to an invoice belonging to another organization', () => {
      // Product & customer in Org B
      const prodB = storage.createProduct(orgB, {
        sku: 'BETA-SKU-01',
        name: 'Beta Goods',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 500,
        sellingPrice: 1000,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 50);

      const customerB = storage.createCustomer(orgB, {
        name: 'Customer Beta',
        phone: '9666666666',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const orderB = storage.createSalesOrder(orgB, {
        customerId: customerB.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prodB.id,
            productName: prodB.name,
            productSku: prodB.sku,
            quantity: 1,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });
      storage.confirmSalesOrder(orgB, orderB.id, 'owner');
      const invB = storage.createInvoiceFromOrder(orgB, orderB.id);

      // Customer in Org A
      const customerA = storage.createCustomer(orgA, {
        name: 'Customer Alpha',
        phone: '9555555555',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      // Attempt to allocate Org A payment to Org B invoice
      expect(() =>
        storage.recordPayment(orgA, {
          customerId: customerA.id,
          invoiceId: invB.id,
          amount: 500,
          paymentMethod: 'NEFT',
          paymentDate: '2026-03-01',
        })
      ).toThrow(/Target invoice not found in this organization/);
    });

    it('prevents allocating payments to an invoice belonging to a different customer in the same organization', () => {
      const prodA = storage.createProduct(orgA, {
        sku: 'ALPHA-SKU-01',
        name: 'Alpha Fixture',
        category: 'Lighting',
        uom: 'Nos',
        purchaseCost: 200,
        sellingPrice: 500,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 50);

      const cust1 = storage.createCustomer(orgA, {
        name: 'Alpha Client 1',
        phone: '9444444441',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const cust2 = storage.createCustomer(orgA, {
        name: 'Alpha Client 2',
        phone: '9444444442',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const orderCust2 = storage.createSalesOrder(orgA, {
        customerId: cust2.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prodA.id,
            productName: prodA.name,
            productSku: prodA.sku,
            quantity: 2,
            unitPrice: 500,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });
      storage.confirmSalesOrder(orgA, orderCust2.id, 'owner');
      const invCust2 = storage.createInvoiceFromOrder(orgA, orderCust2.id);

      // Attempt to allocate Cust1 payment to Cust2 invoice
      expect(() =>
        storage.recordPayment(orgA, {
          customerId: cust1.id,
          invoiceId: invCust2.id,
          amount: 500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        })
      ).toThrow(/Customer mismatch/);
    });

    it('prevents confirming sales orders belonging to another organization', () => {
      const customerB = storage.createCustomer(orgB, {
        name: 'Org B Customer',
        phone: '9333333333',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const orderB = storage.createSalesOrder(orgB, {
        customerId: customerB.id,
        orderDate: '2026-03-01',
        items: [],
      });

      // Calling confirmSalesOrder with orgA for orderB.id
      expect(() => storage.confirmSalesOrder(orgA, orderB.id, 'owner')).toThrow(/Sales order not found/);
    });
  });

  describe('3. Valid Organization Members & Privileged Operations', () => {
    it('allows valid authorized role to confirm sales order with stock check and ledger write', () => {
      const product = storage.createProduct(orgA, {
        sku: 'POLYCAB-2.5-RED',
        name: 'Polycab 2.5sqmm Red Wire',
        category: 'Wires',
        uom: 'Coils',
        purchaseCost: 1500,
        sellingPrice: 1950,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      }, 100);

      const customer = storage.createCustomer(orgA, {
        name: 'Authorized Contractor',
        phone: '9222222222',
        creditLimit: 100000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: 15,
            unitPrice: 1950,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      const confirmed = storage.confirmSalesOrder(orgA, order.id, 'sales');
      expect(confirmed.status).toBe('CONFIRMED');

      // Check stock deduction
      const updatedProduct = storage.getProducts(orgA).find((p) => p.id === product.id);
      expect(updatedProduct?.currentStock).toBe(85);
    });

    it('allows valid payment and allocation matching organization and customer', () => {
      const prod = storage.createProduct(orgA, {
        sku: 'MOD-SW-01',
        name: 'Modular Switches',
        category: 'Modular Switches',
        uom: 'Nos',
        purchaseCost: 50,
        sellingPrice: 100,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      }, 50);

      const customer = storage.createCustomer(orgA, {
        name: 'Legit Customer',
        phone: '9111111111',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            quantity: 10,
            unitPrice: 100,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });
      storage.confirmSalesOrder(orgA, order.id, 'owner');
      const invoice = storage.createInvoiceFromOrder(orgA, order.id);

      const payment = storage.recordPayment(orgA, {
        customerId: customer.id,
        invoiceId: invoice.id,
        amount: 500,
        paymentMethod: 'UPI',
        referenceNumber: 'UPI1234567890',
        paymentDate: '2026-03-01',
      });

      expect(payment.amount).toBe(500);
      expect(payment.customerId).toBe(customer.id);
      expect(payment.organizationId).toBe(orgA);

      const updatedInv = storage.getInvoices(orgA).find((i) => i.id === invoice.id);
      expect(updatedInv?.totalPaid).toBe(500);
      expect(updatedInv?.status).toBe('PARTIALLY_PAID');
    });
  });

  describe('4. RBAC Separation of Concerns', () => {
    it('verifies that inventory role cannot confirm sales orders or manage customers', () => {
      expect(hasPermission('inventory', 'orders:confirm')).toBe(false);
      expect(hasPermission('inventory', 'customers:manage')).toBe(false);
      expect(hasPermission('inventory', 'invoices:create')).toBe(false);
      expect(hasPermission('inventory', 'inventory:adjust')).toBe(true);
      expect(hasPermission('inventory', 'products:create')).toBe(true);
    });

    it('verifies that sales role cannot adjust inventory directly or issue invoices', () => {
      expect(hasPermission('sales', 'inventory:adjust')).toBe(false);
      expect(hasPermission('sales', 'invoices:create')).toBe(false);
      expect(hasPermission('sales', 'payments:record')).toBe(false);
      expect(hasPermission('sales', 'orders:confirm')).toBe(true);
      expect(hasPermission('sales', 'quotations:create')).toBe(true);
    });

    it('verifies that accounts role cannot create products or confirm sales orders', () => {
      expect(hasPermission('accounts', 'products:create')).toBe(false);
      expect(hasPermission('accounts', 'orders:confirm')).toBe(false);
      expect(hasPermission('accounts', 'payments:record')).toBe(true);
      expect(hasPermission('accounts', 'invoices:create')).toBe(true);
    });
  });
});
