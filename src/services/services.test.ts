import { describe, it, expect, beforeEach } from 'vitest';
import { productsService, mapDbProduct } from './products.service';
import { customersService, mapDbCustomer } from './customers.service';
import { inventoryService, mapDbStockMovement } from './inventory.service';
import { ordersService, mapDbSalesOrder, mapDbQuotation } from './orders.service';
import { invoicesService, mapDbInvoice } from './invoices.service';
import { paymentsService, mapDbPayment } from './payments.service';
import { dashboardService } from './dashboard.service';
import { storage } from '@/lib/storage';

describe('Data-Access Layer Services (Phase C & D)', () => {
  const testOrgId = 'org-test-unit-001';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
  });

  describe('Products Service', () => {
    it('correctly maps snake_case DB row to camelCase Product model', () => {
      const dbRow = {
        id: 'prod-001',
        organization_id: testOrgId,
        sku: 'CBL-FR-1.5',
        name: 'Flame Retardant Wire 1.5 sq mm',
        brand: 'Polycab',
        category: 'Wires & Cables',
        uom: 'Coils',
        purchase_cost: '1450.50',
        selling_price: '1850.00',
        tax_rate: '18',
        hsn_code: '8544',
        reorder_threshold: '15',
        is_active: true,
        created_at: '2026-02-15T10:00:00Z',
        updated_at: '2026-02-15T10:00:00Z',
      };

      const product = mapDbProduct(dbRow, 42);
      expect(product.id).toBe('prod-001');
      expect(product.organizationId).toBe(testOrgId);
      expect(product.sku).toBe('CBL-FR-1.5');
      expect(product.purchaseCost).toBe(1450.5);
      expect(product.sellingPrice).toBe(1850.0);
      expect(product.currentStock).toBe(42);
      expect(product.isActive).toBe(true);
    });

    it('falls back to storage when isMockAuth is true', async () => {
      const orgs = storage.getOrganizations();
      const prods = await productsService.getProducts(orgs[0].id, true);
      expect(Array.isArray(prods)).toBe(true);
      expect(prods.length).toBeGreaterThan(0);
    });
  });

  describe('Customers & Suppliers Services', () => {
    it('maps DB customer row and respects calculated receivables', () => {
      const dbRow = {
        id: 'cust-001',
        organization_id: testOrgId,
        name: 'Rajesh Sharma',
        company_name: 'Sharma Electricals',
        phone: '+91 9876543210',
        credit_limit: '250000',
        credit_days: '45',
        is_active: true,
        created_at: '2026-02-15T10:00:00Z',
        updated_at: '2026-02-15T10:00:00Z',
      };

      const customer = mapDbCustomer(dbRow, 35000);
      expect(customer.name).toBe('Rajesh Sharma');
      expect(customer.creditLimit).toBe(250000);
      expect(customer.creditDays).toBe(45);
      expect(customer.currentReceivable).toBe(35000);
    });

    it('falls back to storage when isMockAuth is true', async () => {
      const orgs = storage.getOrganizations();
      const custs = await customersService.getCustomers(orgs[0].id, true);
      expect(Array.isArray(custs)).toBe(true);
      expect(custs.length).toBeGreaterThan(0);
    });
  });

  describe('Inventory Service', () => {
    it('maps stock movements correctly with audit trail metadata', () => {
      const dbRow = {
        id: 'mov-001',
        organization_id: testOrgId,
        product_id: 'prod-001',
        quantity_change: '-10',
        movement_type: 'SALES_DISPATCH',
        reference_type: 'SALES_ORDER',
        reference_id: 'so-001',
        notes: 'Dispatched for site order SO-2026-0001',
        created_at: '2026-02-15T12:00:00Z',
      };

      const movement = mapDbStockMovement(dbRow);
      expect(movement.id).toBe('mov-001');
      expect(movement.quantityChange).toBe(-10);
      expect(movement.movementType).toBe('SALES_DISPATCH');
      expect(movement.referenceType).toBe('SALES_ORDER');
    });

    it('retrieves stock movements from storage in demo mode', async () => {
      const orgs = storage.getOrganizations();
      const movs = await inventoryService.getStockMovements(orgs[0].id, undefined, true);
      expect(Array.isArray(movs)).toBe(true);
      expect(movs.length).toBeGreaterThan(0);
    });
  });

  describe('Orders & Quotations Services', () => {
    it('maps sales order header and items', () => {
      const header = {
        id: 'so-001',
        organization_id: testOrgId,
        order_number: 'SO-2026-0001',
        customer_id: 'cust-001',
        status: 'CONFIRMED',
        order_date: '2026-02-16',
        subtotal: '10000',
        discount_amount: '500',
        tax_amount: '1710',
        total_amount: '11210',
        created_at: '2026-02-16T10:00:00Z',
        updated_at: '2026-02-16T10:00:00Z',
      };

      const order = mapDbSalesOrder(header, []);
      expect(order.orderNumber).toBe('SO-2026-0001');
      expect(order.status).toBe('CONFIRMED');
      expect(order.totalAmount).toBe(11210);
    });

    it('maps quotation header and items', () => {
      const header = {
        id: 'qt-001',
        organization_id: testOrgId,
        quotation_number: 'QT-2026-0001',
        customer_id: 'cust-001',
        status: 'DRAFT',
        valid_until: '2026-03-01',
        subtotal: '5000',
        discount_amount: '0',
        tax_amount: '900',
        total_amount: '5900',
        created_at: '2026-02-16T10:00:00Z',
        updated_at: '2026-02-16T10:00:00Z',
      };

      const quot = mapDbQuotation(header, []);
      expect(quot.quotationNumber).toBe('QT-2026-0001');
      expect(quot.status).toBe('DRAFT');
      expect(quot.totalAmount).toBe(5900);
    });

    it('retrieves sales orders in demo mode', async () => {
      const orgs = storage.getOrganizations();
      const orders = await ordersService.getSalesOrders(orgs[0].id, true);
      expect(Array.isArray(orders)).toBe(true);
      expect(orders.length).toBeGreaterThan(0);
    });

    it('creates sales order reconciling subtotal - discount + tax = total', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      const newOrder = await ordersService.createSalesOrder(
        orgs[0].id,
        {
          customerId: custs[0].id,
          orderDate: '2026-03-01',
          items: [
            {
              productId: prods[0].id,
              productName: prods[0].name,
              productSku: prods[0].sku,
              uom: prods[0].uom,
              quantity: 10,
              unitPrice: 2250,
              discountPercent: 5,
              taxRate: 18,
            },
            {
              productId: prods[1].id,
              productName: prods[1].name,
              productSku: prods[1].sku,
              uom: prods[1].uom,
              quantity: 4,
              unitPrice: 680,
              discountPercent: 0,
              taxRate: 18,
            },
          ],
        },
        true
      );

      // Gross: 10*2250 + 4*680 = 22500 + 2720 = 25220
      // Discount: 5% of 22500 = 1125
      // Taxable: 25220 - 1125 = 24095
      // Tax: 18% of 21375 + 18% of 2720 = 3847.50 + 489.60 = 4337.10
      // Total: 24095 + 4337.10 = 28432.10
      expect(newOrder.subtotal).toBe(25220);
      expect(newOrder.discountAmount).toBe(1125);
      expect(newOrder.taxAmount).toBe(4337.1);
      expect(newOrder.totalAmount).toBe(28432.1);
      expect(Number((newOrder.subtotal - newOrder.discountAmount + newOrder.taxAmount).toFixed(2))).toBe(newOrder.totalAmount);
    });

    it('creates quotation with 0% tax and line discounts maintaining exact reconciliation', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      const quotation = await ordersService.createQuotation(
        orgs[0].id,
        {
          customerId: custs[0].id,
          validUntil: '2026-03-31',
          items: [
            {
              productId: prods[0].id,
              productName: prods[0].name,
              productSku: prods[0].sku,
              uom: prods[0].uom,
              quantity: 5,
              unitPrice: 1000,
              discountPercent: 10, // 500 discount, 4500 taxable
              taxRate: 0,          // 0% legitimate tax
            },
            {
              productId: prods[1].id,
              productName: prods[1].name,
              productSku: prods[1].sku,
              uom: prods[1].uom,
              quantity: 2,
              unitPrice: 2000,
              discountPercent: 0,
              taxRate: 18,         // 720 tax
            },
          ],
        },
        true
      );

      // Gross: 5000 + 4000 = 9000
      // Discount: 500
      // Taxable: 8500
      // Tax: 0 + 720 = 720
      // Total: 8500 + 720 = 9220
      expect(quotation.subtotal).toBe(9000);
      expect(quotation.discountAmount).toBe(500);
      expect(quotation.taxAmount).toBe(720);
      expect(quotation.totalAmount).toBe(9220);
      expect(Number((quotation.subtotal - quotation.discountAmount + quotation.taxAmount).toFixed(2))).toBe(quotation.totalAmount);
      expect(quotation.totalsVersion).toBe(2);
    });

    it('rejects order creation when line items contain negative quantities, negative prices, or invalid discounts', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      // Negative quantity rejection
      await expect(
        ordersService.createSalesOrder(
          orgs[0].id,
          {
            customerId: custs[0].id,
            orderDate: '2026-03-01',
            items: [
              {
                productId: prods[0].id,
                productName: prods[0].name,
                productSku: prods[0].sku,
                uom: prods[0].uom,
                quantity: -5,
                unitPrice: 1000,
                discountPercent: 0,
                taxRate: 18,
              },
            ],
          },
          true
        )
      ).rejects.toThrow(/Quantity cannot be negative or invalid/);

      // Negative unit price rejection
      await expect(
        ordersService.createSalesOrder(
          orgs[0].id,
          {
            customerId: custs[0].id,
            orderDate: '2026-03-01',
            items: [
              {
                productId: prods[0].id,
                productName: prods[0].name,
                productSku: prods[0].sku,
                uom: prods[0].uom,
                quantity: 5,
                unitPrice: -200,
                discountPercent: 0,
                taxRate: 18,
              },
            ],
          },
          true
        )
      ).rejects.toThrow(/Unit price cannot be negative or invalid/);

      // Line discount > 100% rejection
      await expect(
        ordersService.createSalesOrder(
          orgs[0].id,
          {
            customerId: custs[0].id,
            orderDate: '2026-03-01',
            items: [
              {
                productId: prods[0].id,
                productName: prods[0].name,
                productSku: prods[0].sku,
                uom: prods[0].uom,
                quantity: 5,
                unitPrice: 200,
                discountPercent: 120,
                taxRate: 18,
              },
            ],
          },
          true
        )
      ).rejects.toThrow(/Line discount percentage must be between 0% and 100%/);
    });

    it('converts quotation to sales order preserving totals without applying discounts twice', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      const quotation = await ordersService.createQuotation(
        orgs[0].id,
        {
          customerId: custs[0].id,
          validUntil: '2026-04-15',
          items: [
            {
              productId: prods[0].id,
              productName: prods[0].name,
              productSku: prods[0].sku,
              uom: prods[0].uom,
              quantity: 10,
              unitPrice: 2000,
              discountPercent: 10, // 2000 gross, 200 line discount -> 1800 taxable
              taxRate: 18,
            },
          ],
        },
        true
      );

      const convertedOrder = await ordersService.convertQuotationToOrder(orgs[0].id, quotation.id, true);

      // Verify that converted order matches quotation exactly and does not deduct discount again
      expect(convertedOrder.subtotal).toBe(quotation.subtotal);
      expect(convertedOrder.discountAmount).toBe(quotation.discountAmount);
      expect(convertedOrder.taxAmount).toBe(quotation.taxAmount);
      expect(convertedOrder.totalAmount).toBe(quotation.totalAmount);
      expect(convertedOrder.totalsVersion).toBe(2);
      expect(convertedOrder.items?.[0].unitPrice).toBe(2000); // Unaltered gross unit price
    });
  });

  describe('Invoices & Payments Services', () => {
    it('maps invoice with balance and status', () => {
      const header = {
        id: 'inv-001',
        organization_id: testOrgId,
        invoice_number: 'INV-2026-0001',
        customer_id: 'cust-001',
        status: 'ISSUED',
        invoice_date: '2026-02-16',
        due_date: '2026-03-18',
        subtotal: '25000',
        discount_amount: '0',
        tax_amount: '4500',
        total_amount: '29500',
        total_paid: '10000',
        created_at: '2026-02-16T10:00:00Z',
        updated_at: '2026-02-16T10:00:00Z',
      };

      const inv = mapDbInvoice(header, []);
      expect(inv.invoiceNumber).toBe('INV-2026-0001');
      expect(inv.totalAmount).toBe(29500);
      expect(inv.totalPaid).toBe(10000);
    });

    it('maps payment and allocations', () => {
      const header = {
        id: 'pay-001',
        organization_id: testOrgId,
        payment_number: 'PAY-2026-0001',
        customer_id: 'cust-001',
        amount: '15000',
        payment_method: 'UPI',
        payment_date: '2026-02-16',
        created_at: '2026-02-16T10:00:00Z',
      };

      const pay = mapDbPayment(header, []);
      expect(pay.paymentNumber).toBe('PAY-2026-0001');
      expect(pay.amount).toBe(15000);
      expect(pay.paymentMethod).toBe('UPI');
    });

    it('retrieves invoices and payments in demo mode', async () => {
      const orgs = storage.getOrganizations();
      const invs = await invoicesService.getInvoices(orgs[0].id, true);
      expect(Array.isArray(invs)).toBe(true);
      expect(invs.length).toBeGreaterThan(0);

      const pays = await paymentsService.getPayments(orgs[0].id, true);
      expect(Array.isArray(pays)).toBe(true);
      expect(pays.length).toBeGreaterThan(0);
    });

    it('creates invoice with line discounts reconciling subtotal - discount + tax = total', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      const invoice = await invoicesService.createInvoice(
        orgs[0].id,
        {
          customerId: custs[0].id,
          invoiceDate: '2026-03-01',
          dueDate: '2026-03-31',
          items: [
            {
              productId: prods[0].id,
              productName: prods[0].name,
              productSku: prods[0].sku,
              uom: prods[0].uom,
              quantity: 8,
              unitPrice: 1500,
              discountPercent: 10,
              taxRate: 18,
            },
          ],
        },
        true
      );

      // Gross: 8 * 1500 = 12000
      // Discount: 1200
      // Taxable: 10800
      // Tax: 18% of 10800 = 1944
      // Total: 10800 + 1944 = 12744
      expect(invoice.subtotal).toBe(12000);
      expect(invoice.discountAmount).toBe(1200);
      expect(invoice.taxAmount).toBe(1944);
      expect(invoice.totalAmount).toBe(12744);
      expect(Number((invoice.subtotal - invoice.discountAmount + invoice.taxAmount).toFixed(2))).toBe(invoice.totalAmount);
    });

    it('creates invoice from confirmed order preserving exact financials', async () => {
      const orgs = storage.getOrganizations();
      const orders = storage.getSalesOrders(orgs[0].id);
      const order = orders[0]; // ord-001 seeded with subtotal: 25220, discount: 1125, tax: 4337.10, total: 28432.10

      const invoice = await invoicesService.createInvoiceFromOrder(orgs[0].id, order.id, true);
      expect(invoice.subtotal).toBe(order.subtotal);
      expect(invoice.discountAmount).toBe(order.discountAmount);
      expect(invoice.taxAmount).toBe(order.taxAmount);
      expect(invoice.totalAmount).toBe(order.totalAmount);
      expect(Number((invoice.subtotal - invoice.discountAmount + invoice.taxAmount).toFixed(2))).toBe(invoice.totalAmount);
      expect(invoice.totalsVersion).toBe(2);
    });

    it('rejects invoice creation when line items contain negative quantities or invalid amounts', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      await expect(
        invoicesService.createInvoice(
          orgs[0].id,
          {
            customerId: custs[0].id,
            invoiceDate: '2026-03-01',
            dueDate: '2026-03-31',
            items: [
              {
                productId: prods[0].id,
                productName: prods[0].name,
                productSku: prods[0].sku,
                uom: prods[0].uom,
                quantity: -10,
                unitPrice: 500,
                discountPercent: 0,
                taxRate: 18,
              },
            ],
          },
          true
        )
      ).rejects.toThrow(/Quantity cannot be negative or invalid/);
    });
  });

  describe('Dashboard Service', () => {
    it('aggregates operational metrics in demo mode', async () => {
      const orgs = storage.getOrganizations();
      const metrics = await dashboardService.getDashboardMetrics(orgs[0].id, true);
      expect(metrics).toHaveProperty('todaySales');
      expect(metrics).toHaveProperty('ordersCount');
      expect(metrics).toHaveProperty('totalReceivables');
      expect(metrics).toHaveProperty('lowStockItemsCount');
      expect(metrics).toHaveProperty('totalStockValue');
      expect(Array.isArray(metrics.recentOrders)).toBe(true);
      expect(Array.isArray(metrics.recentPayments)).toBe(true);
      expect(Array.isArray(metrics.lowStockProducts)).toBe(true);
    });
  });
});
