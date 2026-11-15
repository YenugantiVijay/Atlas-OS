import { describe, it, expect, beforeEach } from 'vitest';
import { reconciliationService, METRIC_DEFINITIONS } from './reconciliation.service';
import { storage } from '@/lib/storage';

describe('Area 3: Trustworthy Numbers & Financial/Inventory Reconciliation', () => {
  const orgA = 'org-recon-a';
  const orgB = 'org-recon-b';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
  });

  it('provides statutory and business definitions for all primary metrics', () => {
    expect(METRIC_DEFINITIONS.todaySales).toBeDefined();
    expect(METRIC_DEFINITIONS.todaySales.definition).toContain('confirmed and fulfilled');
    expect(METRIC_DEFINITIONS.totalReceivables.formula).toContain('invoices.total_amount');
    expect(METRIC_DEFINITIONS.totalStockValue.definition).toContain('cost price');
    expect(METRIC_DEFINITIONS.lowStockItems.formula).toContain('reorder_threshold');
  });

  it('verifies financial reconciliation when invoiced equals paid plus outstanding', async () => {
    const customer = storage.createCustomer(orgA, {
      name: 'Rao Hardware',
      phone: '9988112233',
      billingAddress: 'Tirupati, AP',
      creditLimit: 100000,
      creditDays: 30,
      isActive: true,
    });

    const invoice1 = storage.createInvoice(orgA, {
      customerId: customer.id,
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-30',
      items: [
        {
          productId: 'prod-1',
          productName: 'Wire',
          productSku: 'W-01',
          uom: 'Coils',
          quantity: 10,
          unitPrice: 1000,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    // Record partial payment of ₹5,000 against invoice1
    storage.recordPayment(
      orgA,
      {
        customerId: customer.id,
        invoiceId: invoice1.id,
        amount: 5000,
        paymentMethod: 'UPI',
        paymentDate: '2026-11-05',
      },
      'accounts'
    );

    const recon = await reconciliationService.reconcileFinancials(orgA, true);

    expect(recon.varianceAmount).toBe(0);
    expect(recon.totalPaid).toBe(5000);
    expect(recon.totalOutstanding).toBe(invoice1.totalAmount - 5000);
    expect(recon.totalInvoiced).toBe(invoice1.totalAmount);
    expect(recon.discrepancies.length).toBe(0);
    expect(recon.asOf).toBeDefined();
    expect(recon.totalAllocated).toBe(5000);
    expect(recon.receiptIssueCount).toBe(0);
  });

  it('preserves strict tenant isolation: never mixes records across organizations', async () => {
    const custA = storage.createCustomer(orgA, {
      name: 'Customer Org A',
      phone: '9000000001',
      billingAddress: 'City A',
      creditLimit: 10000,
      creditDays: 30,
      isActive: true,
    });

    const custB = storage.createCustomer(orgB, {
      name: 'Customer Org B',
      phone: '9000000002',
      billingAddress: 'City B',
      creditLimit: 20000,
      creditDays: 30,
      isActive: true,
    });

    storage.createInvoice(orgA, {
      customerId: custA.id,
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-30',
      items: [
        {
          productId: 'p-a',
          productName: 'Product A',
          productSku: 'SKU-A',
          uom: 'Nos',
          quantity: 1,
          unitPrice: 500,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    storage.createInvoice(orgB, {
      customerId: custB.id,
      invoiceDate: '2026-11-01',
      dueDate: '2026-11-30',
      items: [
        {
          productId: 'p-b',
          productName: 'Product B',
          productSku: 'SKU-B',
          uom: 'Nos',
          quantity: 2,
          unitPrice: 1000,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    });

    const reconA = await reconciliationService.reconcileFinancials(orgA, true);
    const reconB = await reconciliationService.reconcileFinancials(orgB, true);

    expect(reconA.totalInvoiced).toBe(590); // 500 + 18% GST
    expect(reconB.totalInvoiced).toBe(2360); // 2000 + 18% GST
    expect(reconA.totalInvoiced).not.toBe(reconB.totalInvoiced);
  });

  it('uses the same movement-backed stock as the product catalog', async () => {
    const product = storage.createProduct(
      orgA,
      {
        name: 'Anchor Switch 6A',
        sku: 'ANC-6A',
        category: 'Switches',
        uom: 'Nos',
        purchaseCost: 20,
        sellingPrice: 35,
        taxRate: 18,
        reorderThreshold: 10,
        isActive: true,
      },
      100 // Opening stock: 100
    );

    // Initial state: perfectly balanced
    const recon1 = await reconciliationService.getStockLedgerSummary(orgA, true);
    expect(recon1.productCount).toBe(1);
    expect(recon1.catalogCostValue).toBe(2000);

    // Record legitimate stock adjustment via ledger
    storage.adjustStock(
      orgA,
      product.id,
      -5,
      'Damage during warehouse reorganization',
      'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'
    );

    const recon2 = await reconciliationService.getStockLedgerSummary(orgA, true);
    expect(recon2.catalogCostValue).toBe(1900);
    expect(storage.getProductById(orgA, product.id)?.currentStock).toBe(95);
  });
});
