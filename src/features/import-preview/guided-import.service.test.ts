import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from '@/lib/storage';
import { guidedImportService, ProductImportRow } from './guided-import.service';

describe('Area 4: Low-Friction Onboarding & Guided Spreadsheet Import', () => {
  const orgId = 'org-import-test-01';

  beforeEach(() => {
    localStorage.clear();
  });

  it('validates product rows, flags missing required fields, and detects duplicate SKUs', () => {
    const existingSkus = new Set(['POL-EXISTING-01']);

    const testRows: ProductImportRow[] = [
      { sku: '', name: 'No SKU Item', uom: 'Nos' },
      { sku: 'POL-EXISTING-01', name: 'Duplicate with Org', uom: 'Nos' },
      { sku: 'NEW-01', name: 'Valid Item 1', uom: 'Nos', purchaseCost: 100, sellingPrice: 150 },
      { sku: 'NEW-01', name: 'Repeated in file', uom: 'Nos' },
      { sku: 'NEW-02', name: 'Below Cost Item', uom: 'Nos', purchaseCost: 500, sellingPrice: 400 },
    ];

    const { validRows, duplicateSkus, issues } = guidedImportService.validateProductRows(testRows, existingSkus);

    expect(validRows.length).toBe(2); // NEW-01 (first occurrence) and NEW-02
    expect(duplicateSkus).toContain('POL-EXISTING-01');
    expect(duplicateSkus).toContain('NEW-01');

    const skuError = issues.find((i) => i.field === 'sku' && i.message.includes('mandatory'));
    expect(skuError).toBeDefined();

    const priceWarning = issues.find((i) => i.field === 'sellingPrice');
    expect(priceWarning?.severity).toBe('warning');
  });

  it('rejects invalid numeric import values instead of silently clamping them', () => {
    const result = guidedImportService.validateProductRows([
      { sku: 'BAD-PRICE', name: 'Invalid price', uom: 'Nos', purchaseCost: Number.NaN },
      { sku: 'BAD-STOCK', name: 'Invalid stock', uom: 'Nos', openingStock: 1.5 },
      { sku: 'ZERO-TAX', name: 'Zero rated item', uom: 'Nos', taxRate: 0 },
    ], new Set());

    expect(result.validRows.map((row) => row.sku)).toEqual(['ZERO-TAX']);
    expect(result.validRows[0].taxRate).toBe(0);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(2);
  });

  it('imports a batch with tracking and allows safe undo when records are unreferenced', async () => {
    const rows: ProductImportRow[] = [
      { sku: 'HAV-NEW-101', name: 'Havells Switch 1', uom: 'Nos', purchaseCost: 50, sellingPrice: 80, openingStock: 10 },
      { sku: 'HAV-NEW-102', name: 'Havells Switch 2', uom: 'Nos', purchaseCost: 60, sellingPrice: 90, openingStock: 15 },
    ];

    const summary = await guidedImportService.importProductBatch(orgId, rows, true);
    expect(summary.importedCount).toBe(2);
    expect(summary.batchId).toBeDefined();

    const batches = storage.getImportBatches(orgId);
    expect(batches.length).toBe(1);
    expect(batches[0].batchId).toBe(summary.batchId);

    // Verify products exist in storage
    const products = storage.getProducts(orgId);
    expect(products.some((p) => p.sku === 'HAV-NEW-101')).toBe(true);

    // Undo batch
    const undoRes = await guidedImportService.undoImportBatch(orgId, summary.batchId, true);
    expect(undoRes.success).toBe(true);
    expect(undoRes.undoneCount).toBe(2);

    // Verify products were removed
    const productsAfter = storage.getProducts(orgId);
    expect(productsAfter.some((p) => p.sku === 'HAV-NEW-101')).toBe(false);
  });

  it('prevents batch undo when imported products are referenced in a sales order', async () => {
    const rows: ProductImportRow[] = [
      { sku: 'CABLE-TEST-01', name: 'Test Cable', uom: 'Coils', purchaseCost: 1000, sellingPrice: 1300, openingStock: 10 },
    ];

    const summary = await guidedImportService.importProductBatch(orgId, rows, true);
    const prodId = summary.recordIds[0];

    // Create a customer and sales order referencing this product
    const customer = storage.createCustomer(orgId, {
      name: 'Electrical Contractor A',
      phone: '9876543210',
      isActive: true,
      creditLimit: 0,
      creditDays: 30,
    });

    storage.createSalesOrder(orgId, {
      customerId: customer.id,
      orderDate: new Date().toISOString(),
      items: [
        {
          productId: prodId,
          quantity: 2,
          unitPrice: 1300,
          taxRate: 18,
          discountPercent: 0,
        },
      ],
    });

    // Attempt to undo the batch
    const undoRes = await guidedImportService.undoImportBatch(orgId, summary.batchId, true);
    expect(undoRes.success).toBe(false);
    expect(undoRes.failedCount).toBe(1);
    expect(undoRes.details?.[0]).toMatch(/referenced in existing sales orders/i);

    // Product must still be intact
    const product = storage.getProductById(orgId, prodId);
    expect(product).toBeDefined();
  });

  it('seeds standard fast-moving Indian electrical catalog on demand', async () => {
    const seedRes = await guidedImportService.seedStarterElectricalCatalog(orgId, true);
    expect(seedRes.seededCount).toBeGreaterThanOrEqual(5);

    const products = storage.getProducts(orgId);
    const polycabWire = products.find((p) => p.sku === 'POL-W-2.5-RD');
    expect(polycabWire).toBeDefined();
    expect(polycabWire?.hsnCode).toBe('8544');
    expect(polycabWire?.taxRate).toBe(18);
    expect(polycabWire?.uom).toBe('Coils');
  });

  it('does not claim a cloud import batch was undone when no cloud batch record exists', async () => {
    const result = await guidedImportService.undoImportBatch(orgId, 'cloud-batch-not-tracked');
    expect(result.success).toBe(false);
    expect(result.undoneCount).toBe(0);
    expect(result.message).toMatch(/not persisted/i);
  });
});
