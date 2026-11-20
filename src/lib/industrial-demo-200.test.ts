import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage, STORAGE_KEYS } from './storage';

/**
 * Explicitly authorized 200-entry industrial Demo Mode load test.
 * Sandbox-only: jsdom localStorage; no Supabase URL, database or user account.
 * Exactly 50 products + 20 customers + 50 orders + 50 invoices + 30 payments.
 */
describe('200-entry Demo Mode industrial load and financial invariants', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reproduce rapid counter submissions occurring within one millisecond.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('posts exactly 200 synthetic business entries without duplicate IDs, negative stock or financial drift', () => {
    const org = storage.getCurrentOrgId();
    expect(org).toBe('local-workspace');
    const productCount = 50;
    const customerCount = 20;
    const orderCount = 50;
    const invoiceCount = 50;
    const paymentCount = 30;
    const started = performance.now();

    const products = Array.from({ length: productCount }, (_, i) => storage.createProduct(org, {
      sku: `ATLAS-LOAD-${String(i + 1).padStart(3, '0')}`,
      name: `Synthetic distributor product ${i + 1}`,
      category: i % 2 ? 'Hardware' : 'Electricals',
      brand: 'Atlas Synthetic',
      uom: 'Nos',
      purchaseCost: 100 + i,
      sellingPrice: 250 + i * 10,
      taxRate: [5, 12, 18][i % 3],
      reorderThreshold: 5,
      isActive: true,
    }, 20));

    const customers = Array.from({ length: customerCount }, (_, i) => storage.createCustomer(org, {
      name: `Synthetic customer ${i + 1}`,
      creditLimit: 100_000,
      creditDays: 30,
      isActive: true,
    }));

    const itemFor = (i: number) => {
      const p = products[i % products.length];
      return {
        productId: p.id,
        productName: p.name,
        productSku: p.sku,
        uom: p.uom,
        quantity: 1,
        unitPrice: p.sellingPrice,
        discountPercent: i % 4 === 0 ? 10 : 0,
        taxRate: p.taxRate,
      };
    };

    const orders = Array.from({ length: orderCount }, (_, i) => storage.createSalesOrder(org, {
      customerId: customers[i % customers.length].id,
      orderDate: '2026-11-20',
      items: [itemFor(i)],
      notes: '200-entry isolated load scenario',
    }));
    expect(orders.every(order => order.status === 'DRAFT')).toBe(true);

    const invoices = Array.from({ length: invoiceCount }, (_, i) => storage.createInvoice(org, {
      customerId: customers[i % customers.length].id,
      invoiceDate: '2026-11-20',
      dueDate: '2026-12-20',
      status: 'ISSUED',
      items: [itemFor(i)],
      notes: '200-entry isolated load scenario',
    }));

    const payments = Array.from({ length: paymentCount }, (_, i) => {
      const invoice = invoices[i];
      const params = {
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        amount: Math.floor(invoice.totalAmount * 100 / 2) / 100,
        paymentDate: '2026-11-20',
        paymentMethod: 'UPI' as const,
        referenceNumber: `DEMO-200-PAY-${i}`,
        notes: '200-entry isolated load scenario',
        idempotencyKey: crypto.randomUUID(),
      };
      const committed = storage.recordPayment(org, params, 'accounts');
      const replay = storage.recordPayment(org, params, 'accounts');
      expect(replay.id).toBe(committed.id);
      expect(() => storage.recordPayment(org, { ...params, amount: params.amount + 1 }, 'accounts'))
        .toThrow(/Idempotency conflict/);
      return committed;
    });

    const all = [...products, ...customers, ...orders, ...invoices, ...payments];
    expect(all).toHaveLength(200);
    expect(new Set(all.map(x => x.id)).size).toBe(200);
    expect(new Set(orders.map(x => x.orderNumber)).size).toBe(50);
    expect(new Set(invoices.map(x => x.invoiceNumber)).size).toBe(50);
    expect(new Set(payments.map(x => x.paymentNumber)).size).toBe(30);

    const movementRows = storage.getStockMovements(org);
    expect(movementRows).toHaveLength(productCount + invoiceCount);
    expect(new Set(movementRows.map(x => x.id)).size).toBe(100);
    const currentProducts = storage.getProducts(org);
    expect(currentProducts).toHaveLength(50);
    expect(currentProducts.every(x => x.currentStock === 19)).toBe(true);

    // Independent paise-level one-line GST verification; does not use
    // the production money calculator for the expected value.
    for (let i = 0; i < invoices.length; i++) {
      const item = itemFor(i);
      const grossPaise = Math.round(item.unitPrice * 100);
      const taxablePaise = Math.round(grossPaise * (100 - item.discountPercent) / 100);
      const taxPaise = Math.round(taxablePaise * item.taxRate / 100);
      expect(Math.round(invoices[i].totalAmount * 100))
        .toBe(taxablePaise + taxPaise);
      expect(invoices[i].items?.[0].invoiceId).toBe(invoices[i].id);
      expect(orders[i].items?.[0].salesOrderId).toBe(orders[i].id);
    }

    const postedInvoices = storage.getInvoices(org);
    const postedPayments = storage.getPayments(org);
    const allocations = storage.getItem<Array<{ invoiceId: string; paymentId: string; amountAllocated: number }>>(
      STORAGE_KEYS.PAYMENT_ALLOCATIONS, []
    );
    expect(postedInvoices).toHaveLength(50);
    expect(postedPayments).toHaveLength(30);
    expect(allocations).toHaveLength(30);
    for (const invoice of postedInvoices) {
      const paidPaise = allocations
        .filter(a => a.invoiceId === invoice.id)
        .reduce((sum, a) => sum + Math.round(a.amountAllocated * 100), 0);
      expect(Math.round(invoice.totalPaid * 100)).toBe(paidPaise);
      expect(invoice.totalPaid).toBeLessThanOrEqual(invoice.totalAmount);
      expect(invoice.totalAmount).toBeGreaterThan(0);
    }
    for (const payment of postedPayments) {
      const totalAllocated = allocations.filter(a => a.paymentId === payment.id)
        .reduce((sum, a) => sum + Math.round(a.amountAllocated * 100), 0);
      expect(totalAllocated).toBe(Math.round(payment.amount * 100));
    }
    const summary = storage.getPaymentsSummary(org);
    const expectedPaidPaise = postedPayments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    const expectedDuePaise = postedInvoices.reduce(
      (sum, invoice) => sum + Math.round((invoice.totalAmount - invoice.totalPaid) * 100), 0
    );
    expect(Math.round(summary.totalCollected * 100)).toBe(expectedPaidPaise);
    expect(Math.round(summary.totalReceivables * 100)).toBe(expectedDuePaise);

    expect(storage.getAuditEvents(org)).toHaveLength(200);
    expect(storage.getProducts('another-tenant')).toHaveLength(0);
    expect(storage.getInvoices('another-tenant')).toHaveLength(0);

    const rowsBefore = storage.getInvoices(org).length;
    const movementsBefore = storage.getStockMovements(org).length;
    const inv = invoices[0];
    expect(() => storage.createInvoice(org, {
      customerId: inv.customerId,
      invoiceDate: '2026-11-20',
      dueDate: '2026-12-20',
      status: 'ISSUED',
      items: [{ ...itemFor(0), quantity: 20 }], // only 19 units available
    })).toThrow(/Insufficient stock/);
    expect(storage.getInvoices(org)).toHaveLength(rowsBefore);
    expect(storage.getStockMovements(org)).toHaveLength(movementsBefore);
    expect(storage.getAuditEvents(org)).toHaveLength(200);

    // Print scenario evidence to the CI log; never persist synthetic records.
    console.info(JSON.stringify({
      scenario: 'industrial-demo-200',
      transactions: 200,
      counts: { products: 50, customers: 20, orders: 50, invoices: 50, payments: 30 },
      stockMovements: movementRows.length,
      allocationRows: allocations.length,
      timeMs: Math.round(performance.now() - started),
      result: 'validated',
    }));
  });
});
