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
import { mapDbProduct } from '@/services/products.service';

function generateBatchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const batchId = generateBatchId();
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
      if (validRows.length > 0) {
        if (!supabase) throw new Error('Cloud backend is not configured.');

        const payload = validRows.map((row) => ({
          sku: row.sku,
          name: row.name,
          brand: row.brand || '',
          category: row.category || 'General',
          uom: row.uom || 'Nos',
          purchase_cost: row.purchaseCost ?? 0,
          selling_price: row.sellingPrice ?? 0,
          tax_rate: row.taxRate ?? 18,
          hsn_code: row.hsnCode?.trim() || '',
          reorder_threshold: row.reorderThreshold ?? 0,
          opening_stock: row.openingStock ?? 0,
          is_active: true,
        }));

        const { data: rpcRes, error: rpcErr } = await supabase.rpc('create_products_batch', {
          p_org_id: orgId,
          p_batch_id: batchId,
          p_products: payload,
        });

        if (rpcErr) {
          issues.push({
            rowIndex: 0,
            field: 'batch',
            message: rpcErr.message || 'Cloud bulk product import failed.',
            severity: 'error',
          });
        } else if (rpcRes && typeof rpcRes === 'object' && Array.isArray((rpcRes as Record<string, unknown>).record_ids)) {
          recordIds.push(...((rpcRes as { record_ids: string[] }).record_ids));
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
      if (!supabase) {
        return {
          batchId,
          success: false,
          undoneCount: 0,
          failedCount: 1,
          message: 'Cloud import batches are not persisted, so this batch cannot be safely rolled back.',
          details: ['No records were changed. Remove imported records through the product or customer workflow after verifying references.'],
        };
      }

      if (!UUID_REGEX.test(batchId)) {
        return {
          batchId,
          success: false,
          undoneCount: 0,
          failedCount: 1,
          message: `Import batch ${batchId} was not found or is not persisted on the cloud.`,
          details: ['Batch ID is not a valid cloud batch identifier.'],
        };
      }

      const { data: rpcRes, error: rpcErr } = await supabase.rpc('undo_product_import_batch', {
        p_org_id: orgId,
        p_batch_id: batchId,
      });

      if (rpcErr) {
        return {
          batchId,
          success: false,
          undoneCount: 0,
          failedCount: 1,
          message: `Failed to undo cloud import batch: ${rpcErr.message}`,
          details: [rpcErr.message],
        };
      }

      if (rpcRes && typeof rpcRes === 'object') {
        const typedRes = rpcRes as {
          batch_id?: string;
          success?: boolean;
          undone_count?: number;
          failed_count?: number;
          message?: string;
          details?: string[];
        };
        const undoneCount = Number(typedRes.undone_count) || 0;
        const failedCount = Number(typedRes.failed_count) || 0;
        const success = Boolean(typedRes.success);
        return {
          batchId: typedRes.batch_id || batchId,
          success,
          undoneCount,
          failedCount,
          message: typedRes.message || `Rollback processed for batch ${batchId}.`,
          details: Array.isArray(typedRes.details) ? typedRes.details : [],
        };
      }

      return {
        batchId,
        success: false,
        undoneCount: 0,
        failedCount: 1,
        message: `Import batch ${batchId} was not found or is not persisted on the cloud.`,
        details: ['No response received from cloud rollback RPC.'],
      };
    }
  },
};
