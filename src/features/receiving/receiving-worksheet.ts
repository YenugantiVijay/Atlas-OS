import type { Product } from '@/types';

export interface ReceiptWorksheetLine {
  product: Product;
  packageText: string;
  looseUnits: string;
  unitCost: string;
}
export interface ReceiptPayloadLine {
  productId: string;
  packageCounts: number[];
  looseUnits: number;
  unitCost: number;
}
export const MAX_RECEIPT_LINES = 50;
export const MAX_PACKAGES = 200;
export const MAX_UNITS = 1_000_000;

/**
 * An explicit package list, NOT an assumed carton size:
 * "12, 10, 11" => three cartons of different counts.
 * "5x12, 1x10" => five cartons of 12 units and one of 10.
 */
export function parsePackageCounts(input: string): number[] {
  if (!input.trim()) return [];
  const parts = input.split(/[,;\n]+/).map((x) => x.trim());
  if (parts.some((x) => !x)) throw new Error('Remove empty entries between carton counts.');
  const counts: number[] = [];
  for (const part of parts) {
    const repeated = /^([1-9]\d*)\s*[x×]\s*([1-9]\d*)$/i.exec(part);
    const single = /^[1-9]\d*$/.test(part);
    if (!single && !repeated) {
      throw new Error('Carton counts must be positive integers: e.g. 12,10,11 or 5x12.');
    }
    const repetitions = repeated ? Number(repeated[1]) : 1;
    const units = Number(repeated ? repeated[2] : part);
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 ||
        !Number.isSafeInteger(units) || units < 1 || units > MAX_UNITS ||
        counts.length + repetitions > MAX_PACKAGES) {
      throw new Error('A receipt line supports up to 200 cartons of at most 1,000,000 units each.');
    }
    for (let i = 0; i < repetitions; i++) counts.push(units);
  }
  return counts;
}

export function computeReceiptLine(line: ReceiptWorksheetLine) {
  const packages = parsePackageCounts(line.packageText);
  if (!/^(0|[1-9]\d*)$/.test(line.looseUnits.trim())) {
    throw new Error('Loose units must be a nonnegative whole number.');
  }
  const loose = Number(line.looseUnits.trim());
  if (!Number.isSafeInteger(loose) || loose > MAX_UNITS) {
    throw new Error('Loose units must be at most 1,000,000.');
  }
  const total = packages.reduce((sum, n) => sum + n, loose);
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_UNITS) {
    throw new Error('Each line must total between 1 and 1,000,000 units.');
  }
  const costText = line.unitCost.trim();
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(costText)) {
    throw new Error('Purchase rate must be a nonnegative amount with at most two decimal places.');
  }
  const unitCost = Number(costText);
  if (!Number.isFinite(unitCost)) throw new Error('Invalid purchase rate.');
  return { packageCounts: packages, looseUnits: loose, totalUnits: total, unitCost };
}

export function buildGoodsReceiptPayload(organizationId: string, lines: ReceiptWorksheetLine[]): ReceiptPayloadLine[] {
  if (!organizationId || lines.length < 1 || lines.length > MAX_RECEIPT_LINES) {
    throw new Error('A goods receipt needs between 1 and 50 products.');
  }
  const unique = new Set<string>();
  return lines.map((line, index) => {
    if (line.product.organizationId !== organizationId || !line.product.isActive) {
      throw new Error('All products must be active and belong to the current business.');
    }
    if (unique.has(line.product.id)) {
      throw new Error('A product may appear only once per receipt; combine its cartons.');
    }
    unique.add(line.product.id);
    try {
      const { packageCounts, looseUnits, unitCost } = computeReceiptLine(line);
      return { productId: line.product.id, packageCounts, looseUnits, unitCost };
    } catch (error) {
      throw new Error('Row ' + (index + 1) + ': ' + (error instanceof Error ? error.message : 'Invalid quantities.'));
    }
  });
}

/** Notebook rows: exact SKU<TAB>carton counts<TAB>loose units<TAB>purchase rate */
export function parseReceivingNotebook(text: string) {
  const rows = text.trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (rows.length < 1 || rows.length > 20) throw new Error('Paste between 1 and 20 rows.');
  const skus = new Set<string>();
  return rows.map((row, idx) => {
    const cells = row.split('\t').map((x) => x.trim());
    if (cells.length !== 4 || !cells[0] || cells[0].length > 100) {
      throw new Error('Paste row ' + (idx + 1) + ' must have exactly four TAB-separated columns.');
    }
    const sku = cells[0].toUpperCase();
    if (skus.has(sku)) throw new Error('Duplicate SKU in pasted rows: ' + sku);
    skus.add(sku);
    // The same validation runs again before the RPC. Do not trust spreadsheet totals.
    const previewLine = { packageText: cells[1], looseUnits: cells[2], unitCost: cells[3] };
    computeReceiptLine(previewLine as ReceiptWorksheetLine);
    return { sku: cells[0], ...previewLine };
  });
}
