/**
 * ATLAS OS — Guided Spreadsheet Import & Setup Engine
 *
 * Implements low-friction onboarding, mapping, validation, duplicate detection,
 * local batch tracking and safe demo-mode undo for electrical distribution catalogs.
 * Cloud batches are not persisted and cannot be undone by this service.
 */

import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { Product, UOM } from '@/types';
import { mapDbProduct, productsService } from '@/services/products.service';

export interface ProductImportRow {
  sku: string;
  name: string;
  uom: UOM;
  brand?: string;
  category?: string;
  purchaseCost?: number;
  sellingPrice?: number;
  hsnCode?: string;
  taxRate?: number;
  reorderThreshold?: number;
  openingStock?: number;
}

export interface CustomerImportRow {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  state?: string;
  addressLine1?: string;
  creditLimit?: number;
  creditDays?: number;
}

export interface ImportValidationIssue {
  rowIndex: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ImportBatchSummary {
  batchId: string;
  dataset: 'products' | 'customers';
  totalSubmitted: number;
  importedCount: number;
  skippedDuplicates: number;
  errorsCount: number;
  recordIds: string[];
  issues: ImportValidationIssue[];
}

export interface UndoBatchResult {
  batchId: string;
  success: boolean;
  undoneCount: number;
  failedCount: number;
  message: string;
  details?: string[];
}

export const STARTER_ELECTRICAL_PRODUCTS: Array<Omit<Product, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'> & { openingStock: number }> = [
  {
    sku: 'POL-W-2.5-RD',
    name: 'Polycab 2.5 sq mm FR PVC Insulated Copper Wire (90m Red)',
    brand: 'Polycab',
    category: 'Wires & Cables',
    uom: 'Coils',
    purchaseCost: 1850,
    sellingPrice: 2250,
    taxRate: 18,
    hsnCode: '8544',
    reorderThreshold: 15,
    isActive: true,
    openingStock: 20,
  },
  {
    sku: 'POL-W-1.5-BL',
    name: 'Polycab 1.5 sq mm FR PVC Insulated Copper Wire (90m Blue)',
    brand: 'Polycab',
    category: 'Wires & Cables',
    uom: 'Coils',
    purchaseCost: 1220,
    sellingPrice: 1540,
    taxRate: 18,
    hsnCode: '8544',
    reorderThreshold: 20,
    isActive: true,
    openingStock: 25,
  },
  {
    sku: 'HAV-MCB-SP-16A',
    name: 'Havells 16A Single Pole C-Curve MCB (10kA)',
    brand: 'Havells',
    category: 'Switchgear',
    uom: 'Nos',
    purchaseCost: 140,
    sellingPrice: 185,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 25,
    isActive: true,
    openingStock: 50,
  },
  {
    sku: 'HAV-ISO-DP-32A',
    name: 'Havells 32A Double Pole Isolator Switch',
    brand: 'Havells',
    category: 'Switchgear',
    uom: 'Nos',
    purchaseCost: 320,
    sellingPrice: 420,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 10,
    isActive: true,
    openingStock: 15,
  },
  {
    sku: 'ANC-SW-6A-1W',
    name: 'Anchor Roma 6A 1-Way Modular Switch (White)',
    brand: 'Anchor',
    category: 'Modular Wiring Accessories',
    uom: 'Boxes',
    purchaseCost: 280,
    sellingPrice: 380,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 5,
    isActive: true,
    openingStock: 10,
  },
  {
    sku: 'ANC-SKT-16A-3P',
    name: 'Anchor Roma 16A 3-Pin Modular Power Socket',
    brand: 'Anchor',
    category: 'Modular Wiring Accessories',
    uom: 'Boxes',
    purchaseCost: 520,
    sellingPrice: 690,
    taxRate: 18,
    hsnCode: '8536',
    reorderThreshold: 5,
    isActive: true,
    openingStock: 8,
  },
  {
    sku: 'PHI-LED-9W-CDL',
    name: 'Philips 9W Stellar Bright LED Bulb (Cool Day Light B22, Pack of 10)',
    brand: 'Philips',
    category: 'Lighting',
    uom: 'Boxes',
    purchaseCost: 620,
    sellingPrice: 850,
    taxRate: 12,
    hsnCode: '8539',
    reorderThreshold: 8,
    isActive: true,
    openingStock: 12,
  },
  {
    sku: 'FIN-CON-1IN',
    name: 'Finolex 25mm / 1-inch Heavy Gauge Rigid PVC Conduit Pipe (3m x 10)',
    brand: 'Finolex',
    category: 'Conduits & Fittings',
    uom: 'Bundles',
    purchaseCost: 850,
    sellingPrice: 1100,
    taxRate: 18,
    hsnCode: '3917',
    reorderThreshold: 5,
    isActive: true,
    openingStock: 10,
  },
];

export const guidedImportService = {
  /**
   * Previews and validates product rows with duplicate detection.
   */
  validateProductRows(
    rows: ProductImportRow[],
    existingSkus: Set<string>
  ): { validRows: ProductImportRow[]; duplicateSkus: string[]; issues: ImportValidationIssue[] } {
    const validRows: ProductImportRow[] = [];
    const duplicateSkus: string[] = [];
    const issues: ImportValidationIssue[] = [];
    const seenInFile = new Set<string>();

    rows.forEach((row, idx) => {
      const rowNum = idx + 1;
      const skuNorm = (row.sku || '').trim().toUpperCase();
      const name = (row.name || '').trim();

      if (!skuNorm) {
        issues.push({ rowIndex: rowNum, field: 'sku', message: 'SKU is mandatory.', severity: 'error' });
        return;
      }

      if (!name) {
        issues.push({ rowIndex: rowNum, field: 'name', message: 'Product name is mandatory.', severity: 'error' });
        return;
      }

      if (existingSkus.has(skuNorm)) {
        duplicateSkus.push(skuNorm);
        issues.push({ rowIndex: rowNum, field: 'sku', message: `SKU "${skuNorm}" already exists in organization catalog.`, severity: 'error' });
        return;
      }

      if (seenInFile.has(skuNorm)) {
        duplicateSkus.push(skuNorm);
        issues.push({ rowIndex: rowNum, field: 'sku', message: `Duplicate SKU "${skuNorm}" repeated in import file.`, severity: 'error' });
        return;
      }

      seenInFile.add(skuNorm);

      const numericFields: Array<{ field: string; value: number | undefined; integer?: boolean; max?: number }> = [
        { field: 'purchaseCost', value: row.purchaseCost },
        { field: 'sellingPrice', value: row.sellingPrice },
        { field: 'taxRate', value: row.taxRate, max: 40 },
        { field: 'reorderThreshold', value: row.reorderThreshold, integer: true },
        { field: 'openingStock', value: row.openingStock, integer: true },
      ];
      let hasInvalidNumber = false;
      for (const field of numericFields) {
        if (field.value === undefined) continue;
        if (!Number.isFinite(field.value) || field.value < 0 ||
          (field.max !== undefined && field.value > field.max) ||
          (field.integer && !Number.isInteger(field.value))) {
          issues.push({
            rowIndex: rowNum,
            field: field.field,
            message: `${field.field} must be a finite, non-negative${field.max !== undefined ? ` value no greater than ${field.max}` : ''}${field.integer ? ' whole number' : ''}.`,
            severity: 'error',
          });
          hasInvalidNumber = true;
        }
      }
      if (hasInvalidNumber) return;

      if (row.purchaseCost !== undefined && row.sellingPrice !== undefined && row.purchaseCost > row.sellingPrice) {
        issues.push({
          rowIndex: rowNum,
          field: 'sellingPrice',
          message: `Selling price (₹${row.sellingPrice}) is below purchase cost (₹${row.purchaseCost}).`,
          severity: 'warning',
        });
      }

      validRows.push({
        ...row,
        sku: skuNorm,
        name,
        uom: row.uom || 'Nos',
        purchaseCost: row.purchaseCost ?? 0,
        sellingPrice: row.sellingPrice ?? 0,
        taxRate: row.taxRate ?? 18,
        reorderThreshold: row.reorderThreshold ?? 0,
        openingStock: row.openingStock ?? 0,
      });
    });

    return { validRows, duplicateSkus, issues };
  },

  /**
   * Imports a batch of products with batch tracking.
   */
  async importProductBatch(
    orgId: string,
    rows: ProductImportRow[],
    isMockAuth: boolean = false
  ): Promise<ImportBatchSummary> {
    if (!orgId) throw new Error('Organization ID is required.');

    const batchId = `batch_prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let existingProducts: Product[] = [];

    if (isMockAuth) {
      existingProducts = storage.getProducts(orgId);
    } else {
      if (!supabase) throw new Error('Cloud backend is not configured.');
      const res = await supabase.from('products').select('*').eq('organization_id', orgId);
      if (res.error) throw new Error(`Failed to inspect catalog: ${res.error.message}`);
      existingProducts = (res.data || []).map((row) => mapDbProduct(row));
    }

    const existingSkus = new Set(existingProducts.map((p) => p.sku.trim().toUpperCase()));
    const { validRows, duplicateSkus, issues } = this.validateProductRows(rows, existingSkus);

    const recordIds: string[] = [];

    if (isMockAuth) {
      for (const row of validRows) {
        const prod = storage.createProduct(
          orgId,
          {
            sku: row.sku,
            name: row.name,
            uom: row.uom,
            brand: row.brand || '',
            category: row.category || 'General',
            purchaseCost: row.purchaseCost || 0,
            sellingPrice: row.sellingPrice || 0,
            taxRate: row.taxRate || 18,
            hsnCode: row.hsnCode?.trim() || '',
            reorderThreshold: row.reorderThreshold || 0,
            isActive: true,
          },
          row.openingStock || 0
        );
        recordIds.push(prod.id);
      }

      storage.saveImportBatch(orgId, {
        batchId,
        dataset: 'products',
        count: recordIds.length,
        recordIds,
      });
    } else {
      for (const row of validRows) {
        try {
          const product = await productsService.createProduct(
            orgId,
            {
              sku: row.sku,
              name: row.name,
              uom: row.uom || 'Nos',
              brand: row.brand || '',
              category: row.category || 'General',
              purchaseCost: row.purchaseCost ?? 0,
              sellingPrice: row.sellingPrice ?? 0,
              taxRate: row.taxRate ?? 18,
              hsnCode: row.hsnCode?.trim() || '',
              reorderThreshold: row.reorderThreshold ?? 0,
              isActive: true,
            },
            false,
            row.openingStock ?? 0
          );
          recordIds.push(product.id);
        } catch (error) {
          const rowIndex = rows.findIndex((candidate) =>
            (candidate.sku || '').trim().toUpperCase() === row.sku
          ) + 1;
          issues.push({
            rowIndex,
            field: 'product',
            message: error instanceof Error ? error.message : 'Cloud product creation failed.',
            severity: 'error',
          });
        }
      }
    }

    return {
      batchId,
      dataset: 'products',
      totalSubmitted: rows.length,
      importedCount: recordIds.length,
      skippedDuplicates: duplicateSkus.length,
      errorsCount: issues.filter((i) => i.severity === 'error').length,
      recordIds,
      issues,
    };
  },

  /**
   * Safely undoes an imported batch if the records are unreferenced.
   */
  async undoImportBatch(
    orgId: string,
    batchId: string,
    isMockAuth: boolean = false
  ): Promise<UndoBatchResult> {
    if (!orgId || !batchId) throw new Error('Organization ID and Batch ID are required.');

    if (isMockAuth) {
      const batches = storage.getImportBatches(orgId);
      const batch = batches.find((b) => b.batchId === batchId);
      if (!batch) {
        return {
          batchId,
          success: false,
          undoneCount: 0,
          failedCount: 0,
          message: `Import batch ${batchId} was not found.`,
        };
      }

      let undoneCount = 0;
      let failedCount = 0;
      const details: string[] = [];

      if (batch.dataset === 'products') {
        for (const prodId of batch.recordIds) {
          const res = storage.removeUnreferencedProduct(orgId, prodId);
          if (res.success) {
            undoneCount++;
          } else {
            failedCount++;
            details.push(res.reason || `Product ${prodId} could not be removed.`);
          }
        }
      } else {
        for (const custId of batch.recordIds) {
          const res = storage.removeUnreferencedCustomer(orgId, custId);
          if (res.success) {
            undoneCount++;
          } else {
            failedCount++;
            details.push(res.reason || `Customer ${custId} could not be removed.`);
          }
        }
      }

      if (failedCount === 0) {
        storage.removeImportBatchRecord(orgId, batchId);
        return {
          batchId,
          success: true,
          undoneCount,
          failedCount: 0,
          message: `Successfully rolled back batch ${batchId}. ${undoneCount} record(s) safely removed.`,
        };
      }

      return {
        batchId,
        success: false,
        undoneCount,
        failedCount,
        message: `Partial undo: ${undoneCount} record(s) removed, but ${failedCount} could not be removed due to transaction references.`,
        details,
      };
    } else {
      return {
        batchId,
        success: false,
        undoneCount: 0,
        failedCount: 1,
        message: 'Cloud import batches are not persisted, so this batch cannot be safely rolled back.',
        details: ['No records were changed. Remove imported records through the product or customer workflow after verifying references.'],
      };
    }
  },

  /**
   * Seeds standard fast-moving Indian electrical SKUs so new businesses can start invoicing instantly.
   */
  async seedStarterElectricalCatalog(
    orgId: string,
    isMockAuth: boolean = false
  ): Promise<{ seededCount: number; batchId: string }> {
    const rows: ProductImportRow[] = STARTER_ELECTRICAL_PRODUCTS.map((p) => ({
      sku: p.sku,
      name: p.name,
      uom: p.uom,
      brand: p.brand,
      category: p.category,
      purchaseCost: p.purchaseCost,
      sellingPrice: p.sellingPrice,
      hsnCode: p.hsnCode,
      taxRate: p.taxRate,
      reorderThreshold: p.reorderThreshold,
      openingStock: p.openingStock,
    }));

    const result = await this.importProductBatch(orgId, rows, isMockAuth);
    return {
      seededCount: result.importedCount,
      batchId: result.batchId,
    };
  },
};
