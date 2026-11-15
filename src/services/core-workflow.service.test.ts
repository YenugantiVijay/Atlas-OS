import { describe, it, expect, beforeEach } from 'vitest';
import { coreWorkflowService } from './core-workflow.service';
import { storage } from '@/lib/storage';
import { calculateInvoiceBalance } from '@/lib/money';

describe('Area 1: Seamless Core Workflows & Financial Lifecycle', () => {
  const testOrgId = 'org-workflow-test-01';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
  });

  it('executes seamless lifecycle: quotation -> order -> confirm -> invoice -> payment', async () => {
    // 1. Create Customer and Product
    const customer = storage.createCustomer(testOrgId, {
      name: 'Ramesh Electricals',
      companyName: 'Ramesh Enterprises',
      phone: '9848012345',
      billingAddress: 'Main Road, Vijayawada',
      creditLimit: 100000,
      creditDays: 30,
      isActive: true,
    });

    const product = storage.createProduct(
      testOrgId,
      {
        name: 'Polycab 2.5 sq mm Wire',
        sku: 'POL-2.5-RD',
        brand: 'Polycab',
        category: 'Wires',
        uom: 'Coils',
        purchaseCost: 1200,
        sellingPrice: 1500,
        taxRate: 18,
        reorderThreshold: 5,
        isActive: true,
      },
      50 // Opening stock: 50 coils
    );

    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(50);

    // 2. Create Quotation
    const quote = storage.createQuotation(testOrgId, {
      customerId: customer.id,
      validUntil: '2026-12-31',
      notes: 'Standard distributor quote',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 10,
          unitPrice: 1500,
          discountPercent: 5, // 5% line discount
          taxRate: 18,
        },
      ],
    });

    expect(quote.status).toBe('DRAFT');
    expect(quote.totalAmount).toBeGreaterThan(0);

    // 3. Convert Quotation -> Sales Order
    const order = await coreWorkflowService.convertQuotationToSalesOrder(
      testOrgId,
      quote.id,
      true
    );

    expect(order.status).toBe('DRAFT');
    expect(order.quotationId).toBe(quote.id);
    expect(order.totalAmount).toBe(quote.totalAmount);

    // Quotation status is now CONVERTED
    const updatedQuote = storage.getQuotations(testOrgId).find((q) => q.id === quote.id);
    expect(updatedQuote?.status).toBe('CONVERTED');

    // 4. Confirm Sales Order (atomic stock deduction)
    const confirmResult = await coreWorkflowService.confirmSalesOrder(
      testOrgId,
      order.id,
      'sales',
      true
    );
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.status).toBe('CONFIRMED');

    // Verify inventory deducted by 10 coils: 50 - 10 = 40
    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(40);

    // 5. Create Tax Invoice from Sales Order
    const invoice = await coreWorkflowService.createInvoiceFromSalesOrder(
      testOrgId,
      order.id,
      true
    );

    expect(invoice.status).toBe('ISSUED');
    expect(invoice.salesOrderId).toBe(order.id);
    expect(invoice.totalAmount).toBe(order.totalAmount);
    expect(invoice.totalPaid).toBe(0);

    // Order status is now FULFILLED
    const fulfilledOrder = storage.getSalesOrders(testOrgId).find((o) => o.id === order.id);
    expect(fulfilledOrder?.status).toBe('FULFILLED');

    // 6. Record Partial Payment
    const partialPayment = await coreWorkflowService.recordInvoicePayment(
      testOrgId,
      {
        customerId: customer.id,
        invoiceId: invoice.id,
        amount: 5000,
        paymentMethod: 'UPI',
        referenceNumber: 'UPI-TEST-12345',
        paymentDate: '2026-11-14',
      },
      'accounts',
      true
    );

    expect(partialPayment.amount).toBe(5000);
    const partiallyPaidInvoice = await storage.getInvoices(testOrgId).find((i) => i.id === invoice.id);
    expect(partiallyPaidInvoice?.status).toBe('PARTIALLY_PAID');
    expect(partiallyPaidInvoice?.totalPaid).toBe(5000);

    // 7. Record Settle Balance Payment
    const remainingBalance = calculateInvoiceBalance(
      partiallyPaidInvoice!.totalAmount,
      partiallyPaidInvoice!.totalPaid
    );

    const settlePayment = await coreWorkflowService.recordInvoicePayment(
      testOrgId,
      {
        customerId: customer.id,
        invoiceId: invoice.id,
        amount: remainingBalance,
        paymentMethod: 'NEFT',
        referenceNumber: 'NEFT-TEST-9988',
        paymentDate: '2026-11-14',
      },
      'accounts',
      true
    );

    expect(settlePayment.amount).toBe(remainingBalance);
    const fullyPaidInvoice = storage.getInvoices(testOrgId).find((i) => i.id === invoice.id);
    expect(fullyPaidInvoice?.status).toBe('PAID');
    expect(fullyPaidInvoice?.totalPaid).toBe(fullyPaidInvoice?.totalAmount);

    // 8. Trace Full Workflow Lineage
    const lineage = await coreWorkflowService.getWorkflowLineage(
      testOrgId,
      'INVOICE',
      invoice.id,
      true
    );

    expect(lineage.quotation?.id).toBe(quote.id);
    expect(lineage.salesOrder?.id).toBe(order.id);
    expect(lineage.invoice?.id).toBe(invoice.id);
    expect(lineage.payments.length).toBe(2);
    expect(lineage.stockMovements.length).toBeGreaterThan(0);
    expect(lineage.stockMovements[0].movementType).toBe('SALES_DISPATCH');
  });

  it('restores deducted inventory upon sales order cancellation and blocks cancellation if invoiced', async () => {
    const customer = storage.createCustomer(testOrgId, {
      name: 'Krishna Traders',
      phone: '9988776655',
      billingAddress: 'Guntur, AP',
      creditLimit: 50000,
      creditDays: 15,
      isActive: true,
    });

    const product = storage.createProduct(
      testOrgId,
      {
        name: 'Havells 32A MCB',
        sku: 'HVL-MCB-32A',
        brand: 'Havells',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 200,
        sellingPrice: 300,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      },
      25 // Opening stock: 25
    );

    const order = storage.createSalesOrder(testOrgId, {
      customerId: customer.id,
      orderDate: '2026-11-14',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 5,
          unitPrice: 300,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    // Confirm order -> stock decreases from 25 to 20
    await coreWorkflowService.confirmSalesOrder(testOrgId, order.id, 'sales', true);
    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(20);

    // Cancel order -> stock is restored from 20 back to 25 via RETURN_INWARD
    const cancelledOrder = await coreWorkflowService.cancelSalesOrder(
      testOrgId,
      order.id,
      'Customer rejected quotation price on delivery',
      'sales',
      true
    );

    expect(cancelledOrder.status).toBe('CANCELLED');
    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(25);

    // Verify stock movements logged RETURN_INWARD
    const movements = storage.getStockMovements(testOrgId);
    const returnMovement = movements.find(
      (m) => m.referenceId === order.id && m.movementType === 'RETURN_INWARD'
    );
    expect(returnMovement).toBeDefined();
    expect(returnMovement?.quantityChange).toBe(5);
  });

  it('rejects invalid state transitions and prevents overpayment', async () => {
    const customer = storage.createCustomer(testOrgId, {
      name: 'Amar Agencies',
      phone: '9123456780',
      billingAddress: 'Nellore, AP',
      creditLimit: 50000,
      creditDays: 30,
      isActive: true,
    });

    const product = storage.createProduct(
      testOrgId,
      {
        name: 'Anchor Roma Switch',
        sku: 'ANC-ROMA-1M',
        brand: 'Anchor',
        category: 'Wiring Devices',
        uom: 'Nos',
        purchaseCost: 25,
        sellingPrice: 40,
        taxRate: 18,
        reorderThreshold: 100,
        isActive: true,
      },
      10 // Available stock: only 10
    );

    const order = storage.createSalesOrder(testOrgId, {
      customerId: customer.id,
      orderDate: '2026-11-14',
      items: [
        {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          uom: product.uom,
          quantity: 50, // Demands 50 units
          unitPrice: 40,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    // Insufficient stock must reject confirmation
    await expect(
      coreWorkflowService.confirmSalesOrder(testOrgId, order.id, 'sales', true)
    ).rejects.toThrow(/Insufficient stock/);

    // Invoicing a DRAFT order must be rejected
    await expect(
      coreWorkflowService.createInvoiceFromSalesOrder(testOrgId, order.id, true)
    ).rejects.toThrow(/Order must be CONFIRMED/i);
  });

  it('supports receiving goods into stock ledger with idempotent posting', async () => {
    const supplier = storage.createSupplier(testOrgId, {
      name: 'Havells India Ltd (Depot)',
      isActive: true,
    });

    const product = storage.createProduct(
      testOrgId,
      {
        name: 'Havells 16A Single Pole MCB',
        sku: 'HVL-MCB-16A',
        brand: 'Havells',
        category: 'Switchgear',
        uom: 'Nos',
        purchaseCost: 150,
        sellingPrice: 220,
        taxRate: 18,
        reorderThreshold: 20,
        isActive: true,
      },
      10 // Initial stock: 10
    );

    const receiptId = 'grn-test-001';
    const result = await coreWorkflowService.receiveAndPostGoods(
      testOrgId,
      {
        receiptId,
        supplierId: supplier.id,
        supplierInvoiceNumber: 'INV-HVL-8899',
        receivedOn: '2026-11-14',
        notes: 'Delivery received at warehouse dock 1',
        lines: [
          {
            productId: product.id,
            packageCounts: [50],
            looseUnits: 0,
            unitCost: 150,
          },
        ],
      },
      true
    );

    expect(result.status).toBe('POSTED');
    expect(result.total_units).toBe(50);

    // Stock must increase from 10 to 60 (10 + 50)
    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(60);

    // Idempotent reposting: should return status POSTED without doubling stock
    const repostResult = await coreWorkflowService.receiveAndPostGoods(
      testOrgId,
      {
        receiptId,
        supplierId: supplier.id,
        supplierInvoiceNumber: 'INV-HVL-8899',
        receivedOn: '2026-11-14',
        notes: 'Delivery received at warehouse dock 1',
        lines: [
          {
            productId: product.id,
            packageCounts: [50],
            looseUnits: 0,
            unitCost: 150,
          },
        ],
      },
      true
    );

    expect(repostResult.status).toBe('POSTED');
    expect(storage.getProductById(testOrgId, product.id)?.currentStock).toBe(60);
  });
});
