import type { Product } from '@/types';

export interface ReceiptWorksheetLine {
  product: Product;
  packageText: string;
  looseUnits: string;
  unitCost: string;
  billedUnits?: string;
  damagedUnits?: string;
}
export interface ReceiptPayloadLine {
  productId: string;
  packageCounts: number[];
  looseUnits: number;
  unitCost: number;
  billedUnits?: number | null;
  damagedUnits?: number;
}
export const MAX_RECEIPT_LINES = 50;
export const MAX_PACKAGES = 200;
export const MAX_UNITS = 1_000_000;

/** Display the common cases × units/case grid without guessing a package size.
 * Mixed carton counts remain in the original explicit representation. */
export function readUniformCartons(packageText: string): {
  isUniform: boolean; cases: string; unitsPerCase: string;
} {
  const trimmed = packageText.trim();
  if (!trimmed) return { isUniform: true, cases: '', unitsPerCase: '' };
  const match = /^(\d*)\s*[x×]\s*(\d*)$/i.exec(trimmed);
  return match
    ? { isUniform: true, cases: match[1], unitsPerCase: match[2] }
    : { isUniform: false, cases: '', unitsPerCase: '' };
}

/** Incomplete input stays in the worksheet until both fields are entered.
 * Existing parsePackageCounts still rejects it before a draft is saved. */
export function writeUniformCartons(cases: string, unitsPerCase: string): string {
  if (!/^\d*$/.test(cases) || !/^\d*$/.test(unitsPerCase)) {
    throw new Error('Cases and units per case must be whole numbers.');
  }
  return !cases && !unitsPerCase ? '' : cases + 'x' + unitsPerCase;
}

/**
 * An explicit package list, NOT an assumed carton size:
 * "12, 10, 11" => three cartons of different counts.
 * "5x12, 1x10" => five cartons of 12 units and one of 10.
 */
export function parsePackageCounts(input: string): number[] {
  if (!input.trim()) return [];
  const parts = input.split(/[,;\n]/).map((x) => x.trim());
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

export function receiptDeliveryCounts(receivedUnits: number, billedUnits: number | null = null, damagedUnits = 0) {
  return {
    billedUnits,
    damagedUnits,
    usableUnits: receivedUnits - damagedUnits,
    missingUnits: billedUnits === null ? 0 : Math.max(0, billedUnits - receivedUnits),
    excessUnits: billedUnits === null ? 0 : Math.max(0, receivedUnits - billedUnits),
  };
}

function readDeliveryCount(value: string, label: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > MAX_UNITS) {
    throw new Error(label + ' must be a whole number from 0 to 1,000,000.');
  }
  return Number(value);
}

export function computeReceiptLine(line: Omit<ReceiptWorksheetLine, 'product'>) {
  const packages = parsePackageCounts(line.packageText);
  if (!/^(0|[1-9]\d*)$/.test(line.looseUnits.trim())) {
    throw new Error('Loose units must be a nonnegative whole number.');
  }
  const loose = Number(line.looseUnits.trim());
  if (!Number.isSafeInteger(loose) || loose > MAX_UNITS) {
    throw new Error('Loose units must be at most 1,000,000.');
  }
  const total = packages.reduce((sum, n) => sum + n, loose);
  const billedText = line.billedUnits?.trim() ?? '';
  const billed = billedText ? readDeliveryCount(billedText, 'Billed units') : null;
  const damaged = readDeliveryCount(line.damagedUnits?.trim() || '0', 'Damaged units');
  if (!Number.isSafeInteger(total) || total > MAX_UNITS || (total === 0 && !(billed && billed > 0))) {
    throw new Error('Each line must total between 1 and 1,000,000 units.');
  }
  if (damaged > total) throw new Error('Damaged units cannot exceed received units.');
  const costText = line.unitCost.trim();
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(costText)) {
    throw new Error('Purchase rate must be a nonnegative amount with at most two decimal places.');
  }
  const unitCost = Number(costText);
  if (!Number.isFinite(unitCost)) throw new Error('Invalid purchase rate.');
  return { packageCounts: packages, looseUnits: loose, totalUnits: total, unitCost,
    ...receiptDeliveryCounts(total, billed, damaged) };
}

export function buildGoodsReceiptPayload(organizationId: string, lines: ReceiptWorksheetLine[]): ReceiptPayloadLine[] {
  if (!organizationId || lines.length < 1 || lines.length > MAX_RECEIPT_LINES) {
    throw new Error('A goods receipt needs between 1 and 50 products.');
  }
  const checksDelivery = lines.some((line) => line.billedUnits !== undefined || line.damagedUnits !== undefined);
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
      const { packageCounts, looseUnits, unitCost, billedUnits, damagedUnits } = computeReceiptLine(line);
      return {
        productId: line.product.id, packageCounts, looseUnits, unitCost,
        ...(checksDelivery && { billedUnits, damagedUnits }),
      };
    } catch (error) {
      throw new Error('Row ' + (index + 1) + ': ' + (error instanceof Error ? error.message : 'Invalid quantities.'));
    }
  });
}

/** Notebook rows can be pasted from Excel or plain text:
 * 4 columns: SKU/name<TAB>mixed cartons<TAB>loose<TAB>rate
 * 5 columns: SKU/name<TAB>cases<TAB>units/case<TAB>loose<TAB>rate.
 * Names are resolved tenant-side by the caller, never automatically created.
 */
export function parseReceivingNotebook(text: string) {
  const rows = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const isHeader = (row: string) => {
    const cells = row.split('\t').map((x) => x.trim().toLowerCase());
    return cells.length >= 4 && ['sku','product','item','product name','item name'].includes(cells[0]) &&
      (cells[1] === 'cartons' || cells[1] === 'carton counts' || cells[1] === 'cases');
  };
  if (rows.length && isHeader(rows[0])) rows.shift();
  if (rows.length < 1 || rows.length > MAX_RECEIPT_LINES) {
    throw new Error('Paste between 1 and 50 product rows.');
  }
  const identifiers = new Set<string>();
  return rows.map((row, idx) => {
    const cells = row.split('\t').map((x) => x.trim());
    if ((cells.length !== 4 && cells.length !== 5) || !cells[0] || cells[0].length > 255) {
      throw new Error('Paste row ' + (idx + 1) + ' needs 4 or 5 TAB-separated columns.');
    }
    const identifier = cells[0].toLocaleUpperCase('en-IN');
    if (identifiers.has(identifier)) throw new Error('Duplicate product in pasted rows: ' + cells[0]);
    identifiers.add(identifier);
    let packageText: string, looseUnits: string, unitCost: string;
    if (cells.length === 4) {
      [packageText, looseUnits, unitCost] = cells.slice(1);
    } else {
      const cases = cells[1];
      const unitsPerCase = cells[2];
      if (!/^(0|[1-9]\d*)$/.test(cases) || !/^(0|[1-9]\d*)$/.test(unitsPerCase)) {
        throw new Error('Row ' + (idx + 1) + ': Cases and units/case must be whole numbers.');
      }
      const caseCount = Number(cases);
      const perCase = Number(unitsPerCase);
      if (!Number.isSafeInteger(caseCount) || caseCount > MAX_PACKAGES ||
          !Number.isSafeInteger(perCase) || perCase > MAX_UNITS ||
          (caseCount === 0 && perCase !== 0) || (caseCount > 0 && perCase === 0)) {
        throw new Error('Row ' + (idx + 1) + ': Enter up to 200 cases with a positive unit count, or 0 cases and 0 units/case.');
      }
      packageText = caseCount === 0 ? '' : writeUniformCartons(cases, unitsPerCase);
      looseUnits = cells[3];
      unitCost = cells[4];
    }
    // All totals are recalculated and validated again by the server on save/post.
    try { computeReceiptLine({ packageText, looseUnits, unitCost }); }
    catch (error) {
      throw new Error('Row ' + (idx + 1) + ': ' +
        (error instanceof Error ? error.message : 'Invalid product quantities.'));
    }
    return { sku: cells[0], packageText, looseUnits, unitCost };
  });
}
