import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from './storage';

describe('Storage Engine Multi-Tenant & Transaction Integrity', () => {
  const orgA = 'test-org-a';
  const orgB = 'test-org-b';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize();
  });

  it('guarantees tenant isolation: Org A cannot view Org B products or orders', () => {
    // Create product in Org A
    const prodA = storage.createProduct(
      orgA,
      {
        sku: 'TEST-A-01',
        name: 'Org A Exclusive Cable',
        category: 'Wires',
        uom: 'Coils',
        purchaseCost: 1000,
        sellingPrice: 1500,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      },
      50
    );

    // Create product in Org B
    const prodB = storage.createProduct(
      orgB,
      {
        sku: 'TEST-B-01',
        name: 'Org B Exclusive Switchgear',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 200,
        sellingPrice: 350,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      },
      20
    );

    expect(prodA.id).toBeDefined();
    expect(prodB.id).toBeDefined();

    const orgAProducts = storage.getProducts(orgA);
    const orgBProducts = storage.getProducts(orgB);

    expect(orgAProducts.some((p) => p.sku === 'TEST-A-01')).toBe(true);
    expect(orgAProducts.some((p) => p.sku === 'TEST-B-01')).toBe(false);

    expect(orgBProducts.some((p) => p.sku === 'TEST-B-01')).toBe(true);
    expect(orgBProducts.some((p) => p.sku === 'TEST-A-01')).toBe(false);
  });

  it('enforces atomic order confirmation and anti-overselling guard', () => {
    // Create product with 10 units in stock
    const product = storage.createProduct(
      orgA,
      {
        sku: 'STOCK-CHECK-01',
        name: 'Stock Check Wire',
        category: 'Wires',
        uom: 'Coils',
        purchaseCost: 500,
        sellingPrice: 800,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      },
      10 // 10 units available
    );

    const customer = storage.createCustomer(orgA, {
      name: 'Test Customer',
      creditLimit: 50000,
      creditDays: 30,
      isActive: true,
    });

    // 1. Order requesting 15 units (exceeds available stock of 10)
    const excessOrder = storage.createSalesOrder(orgA, {
      customerId: customer.id,
      orderDate: '2026-03-01',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 15,
          unitPrice: product.sellingPrice,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    // Attempt confirmation: MUST FAIL
    expect(() => storage.confirmSalesOrder(orgA, excessOrder.id, 'sales')).toThrow(
      /Insufficient stock/
    );

    // Verify order remains in DRAFT and stock did NOT decrease
    const orderAfterFail = storage.getSalesOrders(orgA).find((o) => o.id === excessOrder.id);
    expect(orderAfterFail?.status).toBe('DRAFT');

    const productAfterFail = storage.getProductById(orgA, product.id);
    expect(productAfterFail?.currentStock).toBe(10);

    // 2. Order requesting 6 units (within available stock of 10)
    const validOrder = storage.createSalesOrder(orgA, {
      customerId: customer.id,
      orderDate: '2026-03-01',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 6,
          unitPrice: product.sellingPrice,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    // Attempt confirmation: MUST SUCCEED
    const confirmedOrder = storage.confirmSalesOrder(orgA, validOrder.id, 'owner');
    expect(confirmedOrder.status).toBe('CONFIRMED');

    // Verify stock balance is now 10 - 6 = 4 units
    const productAfterSuccess = storage.getProductById(orgA, product.id);
    expect(productAfterSuccess?.currentStock).toBe(4);

    // Verify movement was created
    const movements = storage.getStockMovements(orgA);
    const dispatchMovement = movements.find(
      (m) => m.referenceId === validOrder.id && m.movementType === 'SALES_DISPATCH'
    );
    expect(dispatchMovement).toBeDefined();
    expect(dispatchMovement?.quantityChange).toBe(-6);
  });

  it('prevents overpaying an invoice beyond its outstanding balance', () => {
    const customer = storage.createCustomer(orgA, {
      name: 'Invoice Test Customer',
      creditLimit: 100000,
      creditDays: 30,
      isActive: true,
    });

    const product = storage.createProduct(
      orgA,
      {
        sku: 'INV-PROD-01',
        name: 'Invoiced MCB',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 200,
        sellingPrice: 300,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      },
      50
    );

    const order = storage.createSalesOrder(orgA, {
      customerId: customer.id,
      orderDate: '2026-03-01',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 10,
          unitPrice: 300,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    storage.confirmSalesOrder(orgA, order.id, 'owner');
    const invoice = storage.createInvoiceFromOrder(orgA, order.id);

    // Invoice total is 300 * 10 = 3000 + 18% tax = 3540
    expect(invoice.totalAmount).toBe(3540);

    // Attempt to pay 5000 against a 3540 invoice -> MUST FAIL
    expect(() =>
      storage.recordPayment(orgA, {
        customerId: customer.id,
        invoiceId: invoice.id,
        amount: 5000,
        paymentMethod: 'UPI',
        paymentDate: '2026-03-02',
      }, 'accounts')
    ).toThrow(/exceeds outstanding invoice balance/);

    // Valid partial payment of 2000 -> MUST SUCCEED
    const payment = storage.recordPayment(orgA, {
      customerId: customer.id,
      invoiceId: invoice.id,
      amount: 2000,
      paymentMethod: 'UPI',
      paymentDate: '2026-03-02',
    }, 'accounts');

    expect(payment.amount).toBe(2000);

    // Check invoice is PARTIALLY_PAID and balance is 1540
    const updatedInvoice = storage.getInvoices(orgA).find((i) => i.id === invoice.id);
    expect(updatedInvoice?.status).toBe('PARTIALLY_PAID');
    expect(updatedInvoice?.totalPaid).toBe(2000);
  });

  describe('DEF-003: Sales Order Invoicing Lifecycle & Storage Parity', () => {
    it('rejects invoicing an unconfirmed DRAFT sales order', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Draft Lifecycle Customer',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const draftOrder = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [],
      });

      expect(draftOrder.status).toBe('DRAFT');
      expect(() => storage.createInvoiceFromOrder(orgA, draftOrder.id)).toThrow(
        /Cannot invoice order in status "DRAFT"\. Order must be CONFIRMED\./
      );
    });

    it('rejects invoicing a CANCELLED sales order', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Cancel Lifecycle Customer',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [],
      });

      // Directly mark CANCELLED in storage
      const orders = (storage as any).getItem('atlas_sales_orders_v1', []);
      const idx = orders.findIndex((o: any) => o.id === order.id);
      orders[idx].status = 'CANCELLED';
      (storage as any).setItem('atlas_sales_orders_v1', orders);

      expect(() => storage.createInvoiceFromOrder(orgA, order.id)).toThrow(
        /Cannot invoice order in status "CANCELLED"\. Order must be CONFIRMED\./
      );
    });

    it('transitions sales order status to FULFILLED upon successful invoice creation', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Fulfillment Customer',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const product = storage.createProduct(
        orgA,
        {
          sku: 'FULFILL-01',
          name: 'Fulfillment Product',
          category: 'Wires',
          uom: 'Coils',
          purchaseCost: 100,
          sellingPrice: 200,
          taxRate: 18,
          reorderThreshold: 1,
          isActive: true,
        },
        10
      );

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: 2,
            unitPrice: 200,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      storage.confirmSalesOrder(orgA, order.id, 'owner');
      expect(storage.getSalesOrders(orgA).find((o) => o.id === order.id)?.status).toBe('CONFIRMED');

      const invoice = storage.createInvoiceFromOrder(orgA, order.id);
      expect(invoice.id).toBeDefined();
      expect(invoice.salesOrderId).toBe(order.id);

      const updatedOrder = storage.getSalesOrders(orgA).find((o) => o.id === order.id);
      expect(updatedOrder?.status).toBe('FULFILLED');
    });

    it('rejects duplicate invoicing attempts for a FULFILLED sales order', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Duplicate Guard Customer',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const product = storage.createProduct(
        orgA,
        {
          sku: 'DUP-GUARD-01',
          name: 'Duplicate Guard Product',
          category: 'Wires',
          uom: 'Coils',
          purchaseCost: 100,
          sellingPrice: 200,
          taxRate: 18,
          reorderThreshold: 1,
          isActive: true,
        },
        10
      );

      const order = storage.createSalesOrder(orgA, {
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            quantity: 1,
            unitPrice: 200,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      storage.confirmSalesOrder(orgA, order.id, 'owner');
      const invoice = storage.createInvoiceFromOrder(orgA, order.id);
      expect(invoice.id).toBeDefined();

      // Second attempt must fail because order is now FULFILLED and already has an active invoice
      expect(() => storage.createInvoiceFromOrder(orgA, order.id)).toThrow(
        /Cannot invoice order in status "FULFILLED"\. Order must be CONFIRMED\./
      );
    });

    it('prevents partial state mutation if storage write fails during invoice creation', () => {
      const customer = storage.createCustomer(orgA, {
        name: 'Rollback Customer',
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

      // Mock setItem to fail on writing orders after writing invoices
      const originalSetItem = (storage as any).setItem.bind(storage);
      let callCount = 0;
      (storage as any).setItem = (key: string, val: any) => {
        callCount++;
        if (key === 'atlas_sales_orders_v1') {
          throw new Error('Disk quota exceeded during order status transition');
        }
        return originalSetItem(key, val);
      };

      expect(() => storage.createInvoiceFromOrder(orgA, order.id)).toThrow(
        /Disk quota exceeded during order status transition/
      );

      (storage as any).setItem = originalSetItem;

      // Ensure order remains CONFIRMED and no orphaned invoice was permanently persisted
      const currentOrder = storage.getSalesOrders(orgA).find((o) => o.id === order.id);
      expect(currentOrder?.status).toBe('CONFIRMED');

      const linkedInvoices = storage.getInvoices(orgA).filter((i) => i.salesOrderId === order.id);
      expect(linkedInvoices.length).toBe(0);
    });
  });
});
