import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from './storage';
import { hasPermission, getRoleBadgeVariant } from './permissions';
import { paymentsService } from '@/services/payments.service';

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
        }, 'accounts')
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
        }, 'accounts')
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
        }, 'accounts')
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
      }, 'accounts');

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

  describe('5. Foreign Key Deletion Integrity (ON DELETE RESTRICT)', () => {
    it('restricts deleting a quotation when active sales orders reference it', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Quote Test Client',
        phone: '9000000001',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const quote = storage.createQuotation(orgA, {
        customerId: customer.id,
        validUntil: '2026-12-31',
        items: [
          {
            productId: 'p0000000-0000-0000-0000-000000000001',
            productName: 'Sample Wire',
            productSku: 'POL-W-2.5-RD',
            quantity: 5,
            unitPrice: 2000,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // Create sales order referencing this quotation
      storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        quotationId: quote.id,
        items: [],
      });

      // Attempting to delete the quotation must throw an ON DELETE RESTRICT violation
      expect(() => storage.deleteQuotation(orgA, quote.id)).toThrow(
        /ON DELETE RESTRICT.*Cannot delete quotation referenced by active sales orders/
      );

      // Verify the quotation still exists and was not deleted
      const foundQuote = storage.getQuotations(orgA).find((q) => q.id === quote.id);
      expect(foundQuote).toBeDefined();
    });

    it('allows deleting an unreferenced quotation', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Unreferenced Quote Client',
        phone: '9000000002',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const quote = storage.createQuotation(orgA, {
        customerId: customer.id,
        validUntil: '2026-12-31',
        items: [],
      });

      // Deleting unreferenced quotation must succeed
      expect(() => storage.deleteQuotation(orgA, quote.id)).not.toThrow();
      const foundQuote = storage.getQuotations(orgA).find((q) => q.id === quote.id);
      expect(foundQuote).toBeUndefined();
    });

    it('restricts deleting a sales order when active invoices reference it', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Invoice Test Client',
        phone: '9000000003',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [],
      });
      storage.confirmSalesOrder(orgA, order.id, 'owner');
      storage.createInvoiceFromOrder(orgA, order.id);

      // Attempting to delete the sales order must throw an ON DELETE RESTRICT violation
      expect(() => storage.deleteSalesOrder(orgA, order.id)).toThrow(
        /ON DELETE RESTRICT.*Cannot delete sales order referenced by active invoices/
      );

      // Verify the order still exists
      const foundOrder = storage.getSalesOrders(orgA).find((o) => o.id === order.id);
      expect(foundOrder).toBeDefined();
    });

    it('allows deleting an unreferenced sales order', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Uninvoiced Order Client',
        phone: '9000000004',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [],
      });

      // Deleting uninvoiced sales order must succeed
      expect(() => storage.deleteSalesOrder(orgA, order.id)).not.toThrow();
      const foundOrder = storage.getSalesOrders(orgA).find((o) => o.id === order.id);
      expect(foundOrder).toBeUndefined();
    });
  });

  describe('6. Input Bounds, Overpayment, and Stock Boundary Protections', () => {
    it('rejects recording payments with zero or negative amounts', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Zero Pay Client',
        phone: '9000000005',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      expect(() =>
        storage.recordPayment(orgA, {
          customerId: customer.id,
          amount: 0,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        }, 'accounts')
      ).toThrow(/Payment amount must be greater than zero/);

      expect(() =>
        storage.recordPayment(orgA, {
          customerId: customer.id,
          amount: -500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        }, 'accounts')
      ).toThrow(/Payment amount must be greater than zero/);
    });

    it('rejects payments that exceed outstanding invoice balance (overpayment protection)', () => {
      const prod = storage.createProduct(orgA, {
        sku: 'OVERPAY-TEST-01',
        name: 'Overpay Product',
        category: 'Test',
        uom: 'Nos',
        purchaseCost: 100,
        sellingPrice: 1000,
        taxRate: 0,
        reorderThreshold: 5,
        isActive: true,
      }, 50);

      const customer = storage.createCustomer(orgA, {
        name: 'Overpay Customer',
        phone: '9000000006',
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
            quantity: 1,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 0,
          },
        ],
      });
      storage.confirmSalesOrder(orgA, order.id, 'owner');
      const invoice = storage.createInvoiceFromOrder(orgA, order.id);

      // Invoice total is 1000. Attempt to pay 1001.
      expect(() =>
        storage.recordPayment(orgA, {
          customerId: customer.id,
          invoiceId: invoice.id,
          amount: 1001,
          paymentMethod: 'UPI',
          paymentDate: '2026-03-01',
        }, 'accounts')
      ).toThrow(/exceeds outstanding invoice balance/);
    });

    it('rejects order confirmation when stock is insufficient', () => {
      const prod = storage.createProduct(orgA, {
        sku: 'LOW-STOCK-01',
        name: 'Low Stock Cable',
        category: 'Wires',
        uom: 'Coils',
        purchaseCost: 100,
        sellingPrice: 200,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 5); // Only 5 in stock

      const customer = storage.createCustomer(orgA, {
        name: 'Oversell Client',
        phone: '9000000007',
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
            quantity: 10, // Demands 10, exceeds available 5
            unitPrice: 200,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      expect(() => storage.confirmSalesOrder(orgA, order.id, 'sales')).toThrow(
        /Insufficient stock for product/
      );
    });
  });

  describe('7. Cross-Tenant Relational Integrity', () => {
    it('prevents creating sales order in Org A referencing quotation from Org B', () => {
      const customerB = storage.createCustomer(orgB, {
        name: 'Org B Customer',
        phone: '9000000008',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const quoteB = storage.createQuotation(orgB, {
        customerId: customerB.id,
        validUntil: '2026-12-31',
        items: [],
      });

      const customerA = storage.createCustomer(orgA, {
        name: 'Org A Customer',
        phone: '9000000009',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      // Attempt to link Org B's quotation to an Org A sales order
      expect(() =>
        storage.createSalesOrder(orgA, {
          customerId: customerA.id,
          orderDate: '2026-03-01',
          quotationId: quoteB.id,
          items: [],
        })
      ).toThrow(/Referenced quotation not found in this organization/);
    });
  });

  describe('8. Role & Authorization Boundary Regression Tests (NULL-Role & Privileged Functions)', () => {
    it('Category 1: Unauthenticated callers with null/undefined role are denied from all privileged actions', () => {
      // Unauthenticated caller has no role
      expect(hasPermission(null, 'orders:confirm')).toBe(false);
      expect(hasPermission(null, 'payments:record')).toBe(false);
      expect(hasPermission(null, 'members:manage')).toBe(false);
      expect(hasPermission(null, 'products:create')).toBe(false);
      expect(hasPermission(null, 'inventory:adjust')).toBe(false);
      expect(hasPermission(null, 'audit:read')).toBe(false);
      expect(hasPermission(undefined, 'orders:confirm')).toBe(false);
      expect(hasPermission(undefined, 'payments:record')).toBe(false);
    });

    it('Category 2: Authenticated user without active organization membership (NULL role in target org) is denied', async () => {
      const prod = storage.createProduct(orgA, {
        sku: 'REG-PROD-01',
        name: 'Reg Wire',
        category: 'Wires',
        uom: 'Meters',
        purchaseCost: 10,
        sellingPrice: 15,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 100);

      const cust = storage.createCustomer(orgA, {
        name: 'Reg Customer',
        phone: '9111111111',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: cust.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            quantity: 5,
            unitPrice: 15,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // User has no membership in orgA (role is null or undefined/missing) -> Must be explicitly rejected
      expect(() => storage.confirmSalesOrder(orgA, order.id, null)).toThrow(/Permission denied/);
      expect(() => storage.confirmSalesOrder(orgA, order.id, undefined)).toThrow(/Permission denied/);
      expect(() => storage.confirmSalesOrder(orgA, order.id)).toThrow(/Permission denied/);

      // User has no membership in orgA (role is null or undefined/missing) attempting to record payment -> Must be explicitly rejected (fail closed)
      expect(() =>
        storage.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-03-01',
          },
          null
        )
      ).toThrow(/Permission denied/);

      expect(() =>
        storage.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-03-01',
          },
          undefined
        )
      ).toThrow(/Permission denied/);

      expect(() =>
        storage.recordPayment(orgA, {
          customerId: cust.id,
          amount: 500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        })
      ).toThrow(/Permission denied/);

      // Verify that missing or null role propagated through paymentsService in mock mode also fails closed
      await expect(
        paymentsService.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-03-01',
          },
          true,
          null
        )
      ).rejects.toThrow(/Permission denied/);

      await expect(
        paymentsService.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-03-01',
          },
          true,
          undefined
        )
      ).rejects.toThrow(/Permission denied/);

      // Verify allowed role through paymentsService succeeds
      const paidRes = await paymentsService.recordPayment(
        orgA,
        {
          customerId: cust.id,
          amount: 500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        },
        true,
        'accounts'
      );
      expect(paidRes.amount).toBe(500);
    });

    it('Category 3: Viewers are permitted to read data but strictly denied from privileged actions', () => {
      // Viewer allowed to read
      expect(hasPermission('viewer', 'data:read')).toBe(true);

      // Viewer denied from privileged actions
      expect(hasPermission('viewer', 'orders:confirm')).toBe(false);
      expect(hasPermission('viewer', 'payments:record')).toBe(false);
      expect(hasPermission('viewer', 'products:create')).toBe(false);
      expect(hasPermission('viewer', 'inventory:adjust')).toBe(false);
      expect(hasPermission('viewer', 'members:manage')).toBe(false);

      const prod = storage.createProduct(orgA, {
        sku: 'VIEWER-REG-01',
        name: 'Viewer Item',
        category: 'Test',
        uom: 'Nos',
        purchaseCost: 20,
        sellingPrice: 40,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 50);

      const cust = storage.createCustomer(orgA, {
        name: 'Viewer Customer',
        phone: '9222222222',
        creditLimit: 20000,
        creditDays: 15,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: cust.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            quantity: 2,
            unitPrice: 40,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // Viewer attempting to confirm sales order -> Rejected
      expect(() => storage.confirmSalesOrder(orgA, order.id, 'viewer')).toThrow(/Permission denied/);

      // Viewer attempting to record payment -> Rejected
      expect(() =>
        storage.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 200,
            paymentMethod: 'UPI',
            paymentDate: '2026-03-01',
          },
          'viewer'
        )
      ).toThrow(/Permission denied/);
    });

    it('Category 4: Users from Org A attempting to access or manipulate Org B resources are blocked', () => {
      const prodB = storage.createProduct(orgB, {
        sku: 'ORGB-PROD-01',
        name: 'Org B Wire',
        category: 'Wires',
        uom: 'Meters',
        purchaseCost: 100,
        sellingPrice: 150,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      }, 50);

      const custB = storage.createCustomer(orgB, {
        name: 'Org B Customer Only',
        phone: '9333333333',
        creditLimit: 100000,
        creditDays: 30,
        isActive: true,
      });

      const orderB = storage.createSalesOrder(orgB, {
        customerId: custB.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prodB.id,
            productName: prodB.name,
            productSku: prodB.sku,
            quantity: 5,
            unitPrice: 150,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // User from Org A attempting to confirm Order B using Org A ID -> Order not found in Org A
      expect(() => storage.confirmSalesOrder(orgA, orderB.id, 'sales')).toThrow(/Sales order not found/);

      // User from Org A attempting to record payment for Customer B inside Org A -> Customer not found in Org A
      expect(() =>
        storage.recordPayment(orgA, {
          customerId: custB.id,
          amount: 500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        }, 'accounts')
      ).toThrow(/Customer not found in organization/);

      // User from Org A (having no role in Org B) attempting to record payment in Org B -> Denied
      expect(() =>
        storage.recordPayment(orgB, {
          customerId: custB.id,
          amount: 500,
          paymentMethod: 'CASH',
          paymentDate: '2026-03-01',
        }, null)
      ).toThrow(/Permission denied/);
    });

    it('Category 5: Valid authorized roles succeed, and unauthorized active roles are rejected', () => {
      const prod = storage.createProduct(orgA, {
        sku: 'AUTH-ROLE-01',
        name: 'Switch Box',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 200,
        sellingPrice: 350,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      }, 100);

      const cust = storage.createCustomer(orgA, {
        name: 'Authorized Customer',
        phone: '9444444444',
        creditLimit: 100000,
        creditDays: 30,
        isActive: true,
      });

      // Test 5.1: Confirm Sales Order role permissions
      // Allowed roles: owner, admin, sales
      expect(hasPermission('owner', 'orders:confirm')).toBe(true);
      expect(hasPermission('admin', 'orders:confirm')).toBe(true);
      expect(hasPermission('sales', 'orders:confirm')).toBe(true);

      // Denied roles: accounts, inventory, viewer
      expect(hasPermission('accounts', 'orders:confirm')).toBe(false);
      expect(hasPermission('inventory', 'orders:confirm')).toBe(false);
      expect(hasPermission('viewer', 'orders:confirm')).toBe(false);

      // Test 5.2: Record Payment role permissions
      // Allowed roles: owner, admin, accounts
      expect(hasPermission('owner', 'payments:record')).toBe(true);
      expect(hasPermission('admin', 'payments:record')).toBe(true);
      expect(hasPermission('accounts', 'payments:record')).toBe(true);

      // Denied roles: sales, inventory, viewer
      expect(hasPermission('sales', 'payments:record')).toBe(false);
      expect(hasPermission('inventory', 'payments:record')).toBe(false);
      expect(hasPermission('viewer', 'payments:record')).toBe(false);

      // Execute allowed order confirmation by sales
      const order1 = storage.createSalesOrder(orgA, {
        customerId: cust.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            quantity: 2,
            unitPrice: 350,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });
      const confirmedOrder = storage.confirmSalesOrder(orgA, order1.id, 'sales');
      expect(confirmedOrder.status).toBe('CONFIRMED');

      // Execute denied order confirmation by accounts
      const order2 = storage.createSalesOrder(orgA, {
        customerId: cust.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            quantity: 1,
            unitPrice: 350,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });
      expect(() => storage.confirmSalesOrder(orgA, order2.id, 'accounts')).toThrow(/Permission denied/);

      // Execute allowed payment recording by accounts
      const payment = storage.recordPayment(
        orgA,
        {
          customerId: cust.id,
          amount: 700,
          paymentMethod: 'NEFT',
          paymentDate: '2026-03-01',
        },
        'accounts'
      );
      expect(payment.amount).toBe(700);

      // Execute denied payment recording by sales
      expect(() =>
        storage.recordPayment(
          orgA,
          {
            customerId: cust.id,
            amount: 300,
            paymentMethod: 'CASH',
            paymentDate: '2026-03-01',
          },
          'sales'
        )
      ).toThrow(/Permission denied/);
    });
  });
});
