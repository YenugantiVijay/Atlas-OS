import { normalizeHeader, normalizeKey, normalizeUnit, numericText, type ProductIdentity } from '@/features/import-preview/import-preview';
import type { SourceSheet } from '@/features/import-preview/import-file';
import { parseStrictNumber } from '@/lib/validation';

export const countFields = [
  { key: 'sku', label: 'SKU', aliases: ['sku', 'item code', 'product code', 'code'] },
  { key: 'name', label: 'Item name', aliases: ['item name', 'product name', 'item', 'product', 'name'] },
  { key: 'batch', label: 'Batch number', aliases: ['batch number', 'batch no', 'batch', 'lot number', 'lot no', 'lot'] },
  { key: 'expiry', label: 'Expiry date', aliases: ['expiry date', 'expiration date', 'exp date', 'expiry', 'expires on', 'exp'] },
  { key: 'quantity', label: 'Counted quantity', aliases: ['counted quantity', 'physical quantity', 'physical stock', 'counted qty', 'quantity', 'qty'] },
  { key: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'main unit', 'unit of measure'] },
  { key: 'godown', label: 'Godown', aliases: ['godown', 'godown name', 'warehouse', 'warehouse name', 'location', 'current godown'] },
] as const;

type CountField = typeof countFields[number]['key'];
export type CountValues = Record<CountField, string>;
export type CountMapping = Partial<Record<CountField, number>>;
export type DateOrder = 'dmy' | 'mdy';
export const countStatuses = ['Expired', 'Usable', 'Needs review'] as const;
export type CountStatus = typeof countStatuses[number];

export interface CountSource {
  number: number;
  values: CountValues;
  issues: Partial<Record<CountField, string>>;
}

export interface ReviewRow extends CountSource {
  status: CountStatus;
  problems: string[];
  matchedProduct?: ProductIdentity;
  countedQuantity?: number;
  expiryText: string;
}

export function suggestCountMapping(cells: string[]): CountMapping {
  const headings = Array.from(cells, (cell) => normalizeHeader(cell ?? ''));
  const mapping: CountMapping = {};
  for (const field of countFields) {
    const matches = headings.flatMap((heading, index) =>
      (field.aliases as readonly string[]).includes(heading) ? [index] : []);
    if (matches.length === 1) mapping[field.key] = matches[0];
  }
  return mapping;
}

export function suggestCountSetup(sheet: SourceSheet) {
  let best = { header: sheet.rows[0].number, mapping: {} as CountMapping, score: -1 };
  for (const row of sheet.rows.slice(0, 50)) {
    const mapping = suggestCountMapping(row.cells);
    const score = Object.keys(mapping).length + (mapping.quantity === undefined ? 0 : 2);
    if (score > best.score) best = { header: row.number, mapping, score };
  }
  return best;
}

export function readCountRows(sheet: SourceSheet, header: number, mapping: CountMapping, defaultGodown: string): CountSource[] {
  const headings = sheet.rows.find((row) => row.number === header)?.cells ?? [];
  const indices = Object.values(mapping);
  return sheet.rows.filter((row) => row.number > header).flatMap((row) => {
    if (!indices.some((index) => row.cells[index] || row.cellIssues?.[index])) return [];
    if (indices.every((index) => normalizeHeader(row.cells[index] ?? '') === normalizeHeader(headings[index] ?? '')) &&
        !indices.some((index) => row.cellIssues?.[index])) return [];
    const values = {} as CountValues;
    const issues: CountSource['issues'] = {};
    for (const field of countFields) {
      const index = mapping[field.key];
      const cell = index === undefined ? '' : row.cells[index]?.trim() ?? '';
      const issue = index === undefined ? undefined : row.cellIssues?.[index];
      values[field.key] = cell;
      if (issue === 'formula' || cell.startsWith('=')) issues[field.key] = 'Replace the formula with a fixed value.';
      if (issue === 'error') issues[field.key] = 'Correct the Excel cell error.';
      if (issue === 'long-number') issues[field.key] = 'Check the digits against the original record.';
    }
    if (!values.godown && !issues.godown) values.godown = defaultGodown.trim();
    return [{ number: row.number, values, issues }];
  });
}

export function parseCountDate(value: string, order: DateOrder = 'dmy'): string | undefined {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const localDate = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(value.trim());
  if (localDate) {
    const [, first, , second, year] = localDate;
    const [day, month] = order === 'dmy' ? [first, second] : [second, first];
    return parseCountDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, order);
  }
  if (!isoDate) return;
  const [, year, month, day] = isoDate;
  const canonical = [year, month, day].join('-');
  const time = new Date(canonical + 'T00:00:00Z');
  if (Number(year) >= 1900 && Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === canonical) return canonical;
}

function productIndex(products: ProductIdentity[], field: 'sku' | 'name') {
  const matches = new Map<string, ProductIdentity[]>();
  for (const product of products) {
    const key = normalizeKey(product[field]);
    const group = matches.get(key);
    if (group) group.push(product);
    else matches.set(key, [product]);
  }
  return matches;
}

export function reviewCount(
  rows: CountSource[], products: ProductIdentity[] | undefined, countDate: string, order: DateOrder,
): ReviewRow[] {
  const skus = productIndex(products ?? [], 'sku');
  const names = productIndex(products ?? [], 'name');
  const duplicateGroups = new Map<string, ReviewRow[]>();
  const referenceDate = parseCountDate(countDate);
  const review = rows.map((row): ReviewRow => {
    const { values } = row;
    const problems = [];
    for (const field of countFields) {
      if (row.issues[field.key]) problems.push(field.label + '. ' + row.issues[field.key]);
      if (values[field.key].length > 255) problems.push(field.label + ' is too long. Use up to 255 characters.');
    }
    const sku = normalizeKey(values.sku);
    const name = normalizeKey(values.name);
    const matches = sku ? skus.get(sku) : names.get(name);
    const matchedProduct = (sku || name) && matches?.length === 1 ? matches[0] : undefined;
    if (!sku && !name) problems.push('Enter the SKU or item name.');
    else if (!products) problems.push('Atlas catalog comparison is unavailable.');
    else if (!matchedProduct) problems.push(matches?.length ? 'Multiple products match. Enter the exact Atlas SKU.' : 'No matching Atlas product. Check the SKU or item name.');
    else if (sku && name && name !== normalizeKey(matchedProduct.name)) problems.push('The SKU and item name differ from the Atlas catalog.');

    const noExpiry = ['no expiry', 'no expiry applies', 'does not expire'].includes(normalizeKey(values.expiry));
    const expiryDate = parseCountDate(values.expiry, order);
    if (!noExpiry && !expiryDate) problems.push('Enter a full expiry date or specify No expiry.');
    if (!values.batch && !noExpiry) problems.push('Enter the batch number.');
    if (!values.godown) problems.push('Enter the godown where this stock was counted.');
    const unit = normalizeUnit(values.unit);
    if (!unit) problems.push('Enter a supported unit of measure.');
    else if (matchedProduct && unit !== normalizeUnit(matchedProduct.uom)) problems.push('The unit differs from the Atlas main unit. Verify and enter the count in the Atlas unit.');
    const quantity = parseStrictNumber(numericText(values.quantity), {
      fieldName: 'Counted quantity', required: true, min: 0, max: 1_000_000,
      integer: unit !== 'Kg' && unit !== 'Litres' && unit !== 'Meters',
      maxDecimals: 3, allowZero: true,
    });
    if (!quantity.valid) problems.push(quantity.error ?? 'Enter a valid counted quantity.');
    if (!referenceDate) problems.push('Choose a valid stock count date.');

    const result: ReviewRow = {
      ...row, problems, matchedProduct, countedQuantity: quantity.valid ? quantity.value : undefined,
      expiryText: noExpiry ? 'No expiry' : expiryDate ?? values.expiry,
      status: problems.length ? 'Needs review' :
        expiryDate && referenceDate && expiryDate <= referenceDate ? 'Expired' : 'Usable',
    };
    if (matchedProduct && values.godown && (values.batch || noExpiry)) {
      const key = JSON.stringify([matchedProduct.sku, values.batch, values.godown].map(normalizeKey));
      const duplicates = duplicateGroups.get(key);
      if (duplicates) duplicates.push(result);
      else duplicateGroups.set(key, [result]);
    }
    return result;
  });
  for (const group of duplicateGroups.values()) {
    if (group.length === 1) continue;
    for (const row of group) {
      row.problems.push('This product, batch and godown repeat in the sheet. Verify the counts.');
      row.status = 'Needs review';
    }
  }
  return review;
}
