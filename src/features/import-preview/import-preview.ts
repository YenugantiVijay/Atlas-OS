import { validateGstin, validateMoneyInput, validateQuantityInput, validateTaxRateInput } from '@/lib/validation';
import type { UOM } from '@/types';
import type { SourceSheet } from './import-file';

export type ImportDataset = 'products' | 'customers' | 'stock';
type Field = 'sku' | 'name' | 'unit' | 'category' | 'purchaseCost' | 'sellingPrice' |
  'hsn' | 'tax' | 'group' | 'gstin' | 'phone' | 'email' | 'quantity';
type FieldValues = Partial<Record<Field, string>>;
export type ColumnMapping = Partial<Record<Field, number>>;
interface FieldDefinition { key: Field; label: string; aliases: string[]; required?: boolean }

export const IMPORT_DATASETS: Record<ImportDataset, { label: string; hint: string; fields: FieldDefinition[] }> = {
  products: {
    label: 'Products',
    hint: 'Use the BUSY Item Master list. Include Item Name, Alias or Item Code, and Main Unit.',
    fields: [
      { key: 'name', label: 'Product name', aliases: ['item name', 'item', 'product name', 'name of item', 'name'], required: true },
      { key: 'sku', label: 'SKU or item code', aliases: ['sku', 'item code', 'product code', 'item alias', 'alias', 'code'], required: true },
      { key: 'unit', label: 'Main unit', aliases: ['main unit', 'main uom', 'unit name', 'uom', 'unit'], required: true },
      { key: 'category', label: 'Category', aliases: ['item group', 'group name', 'category', 'group'] },
      { key: 'purchaseCost', label: 'Purchase cost', aliases: ['purchase price', 'purchase rate', 'purchase cost', 'cost price'] },
      { key: 'sellingPrice', label: 'Selling price', aliases: ['sales price', 'sale price', 'selling price', 'sales rate', 'sale rate'] },
      { key: 'hsn', label: 'HSN code', aliases: ['hsn code', 'hsn sac code', 'hsn sac no', 'hsn sac', 'hsn'] },
      { key: 'tax', label: 'GST rate (%)', aliases: ['gst rate', 'gst percent', 'tax rate', 'gst'] },
    ],
  },
  customers: {
    label: 'Customers',
    hint: 'Use the BUSY Account Master list for Sundry Debtors. Include the account group if your export contains other accounts.',
    fields: [
      { key: 'name', label: 'Customer name', aliases: ['account name', 'party name', 'customer name', 'name of account', 'name'], required: true },
      { key: 'group', label: 'Account group', aliases: ['account group', 'group of account', 'group name', 'group', 'under group'] },
      { key: 'gstin', label: 'GSTIN', aliases: ['gstin', 'gst no', 'gstin uin', 'gstin no', 'gst number'] },
      { key: 'phone', label: 'Phone', aliases: ['mobile number', 'mobile no', 'mobile', 'phone', 'phone number', 'contact number'] },
      { key: 'email', label: 'Email', aliases: ['email', 'email id', 'e mail', 'email address'] },
    ],
  },
  stock: {
    label: 'Opening stock',
    hint: 'Use a BUSY closing-stock report as of your cutover date. Include the quantity in the main unit and the item code or name.',
    fields: [
      { key: 'sku', label: 'SKU or item code', aliases: ['sku', 'item code', 'product code', 'item alias', 'alias', 'code'] },
      { key: 'name', label: 'Product name', aliases: ['item name', 'item', 'product name', 'name of item', 'name'] },
      { key: 'quantity', label: 'Opening quantity', aliases: [
        'closing stock main unit qty', 'closing stock main qty', 'closing qty main unit',
        'closing stock qty', 'closing stock quantity', 'closing qty', 'closing quantity',
        'main unit qty', 'main unit quantity', 'main qty', 'main quantity',
        'stock qty', 'stock quantity', 'quantity', 'qty',
      ], required: true },
      { key: 'unit', label: 'Main unit', aliases: ['main unit', 'main uom', 'unit name', 'uom', 'unit'] },
    ],
  },
};

const units: Record<UOM, string[]> = {
  Nos: ['nos', 'no', 'pcs', 'pc', 'piece', 'pieces', 'each', 'ea', 'number', 'numbers'],
  Coils: ['coil', 'coils'],
  Meters: ['meter', 'meters', 'metre', 'metres', 'm', 'mtr', 'mtrs'],
  Boxes: ['box', 'boxes'],
  Bundles: ['bundle', 'bundles'],
  Sets: ['set', 'sets'],
  Rolls: ['roll', 'rolls'],
  Bags: ['bag', 'bags'],
  Kg: ['kg', 'kgs', 'kilogram', 'kilograms'],
  Litres: ['l', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres'],
  Packs: ['pack', 'packs', 'pkt', 'pkts', 'packet', 'packets'],
};

export function normalizeKey(value = '') {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

const normalizeHeader = (value: string) => normalizeKey(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const unitLookup = new Map(Object.entries(units).flatMap(([unit, aliases]) => aliases.map((alias) => [alias, unit as UOM] as const)));
export const normalizeUnit = (value = '') => unitLookup.get(normalizeHeader(value));

export function suggestColumns(dataset: ImportDataset, cells: string[]): ColumnMapping {
  const headings = groupBy(
    Array.from(cells, (cell, index) => ({ heading: normalizeHeader(cell ?? ''), index })),
    (column) => column.heading,
  );
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_DATASETS[dataset].fields) {
    for (const alias of field.aliases) {
      const matches = headings.get(normalizeHeader(alias));
      if (matches?.length !== 1 || used.has(matches[0].index)) continue;
      const column = matches[0].index;
      mapping[field.key] = column;
      used.add(column);
      break;
    }
  }
  return mapping;
}

export function suggestHeader(dataset: ImportDataset, sheet: SourceSheet): number {
  let best = sheet.rows[0].number;
  let bestScore = 0;
  for (const row of sheet.rows.slice(0, 50)) {
    const mapping = suggestColumns(dataset, row.cells);
    const score = IMPORT_DATASETS[dataset].fields.reduce((sum, field) =>
      sum + (mapping[field.key] === undefined ? 0 : field.required ? 3 : 1), 0);
    if (score > bestScore) {
      best = row.number;
      bestScore = score;
    }
  }
  return best;
}

export function mappingIssues(dataset: ImportDataset, mapping: ColumnMapping, headings: string[] = []): string[] {
  const missing = IMPORT_DATASETS[dataset].fields
    .filter((field) => field.required && mapping[field.key] === undefined).map((field) => field.label);
  if (dataset === 'stock' && mapping.sku === undefined && mapping.name === undefined) {
    missing.push('SKU or product name');
  }
  const issues = missing.length ? ['Map the required columns — ' + missing.join(', ') + '.'] : [];
  const columns = Object.values(mapping);
  if (new Set(columns).size !== columns.length) issues.push('Each mapped field needs its own source column.');
  const quantityHeading = mapping.quantity === undefined ? '' : normalizeHeader(headings[mapping.quantity] ?? '');
  const unitHeading = mapping.unit === undefined ? '' : normalizeHeader(headings[mapping.unit] ?? '');
  if (dataset === 'stock' && /\b(?:value|amount|amt|valuation|rate|price)\b/.test(quantityHeading)) {
    issues.push('The selected stock column describes a monetary value. Choose a quantity column.');
  }
  if (/\b(?:alt|alternate|secondary)\b/.test(unitHeading + ' ' + quantityHeading)) {
    issues.push('Choose the main-unit columns for quantity and unit.');
  }
  return issues;
}

interface MappedRow { number: number; values: FieldValues; issues: string[] }
export interface PreviewRow extends MappedRow { matchedProduct?: string; normalizedUnit?: UOM }
export interface ProductIdentity { sku: string; name: string; uom: string }
export interface CustomerIdentity { name: string; gstin?: string; phone?: string }
const identifierFields = new Set<Field>(['sku', 'hsn', 'gstin', 'phone']);

export function readMappedRows(dataset: ImportDataset, sheet: SourceSheet, header: number, mapping: ColumnMapping) {
  const rows: MappedRow[] = [];
  let ignored = 0;
  const headings = sheet.rows.find((row) => row.number === header)?.cells ?? [];
  for (const row of sheet.rows) {
    if (row.number <= header) continue;
    const values: FieldValues = {};
    const issues: string[] = [];
    for (const field of IMPORT_DATASETS[dataset].fields) {
      const column = mapping[field.key];
      if (column === undefined) continue;
      const value = row.cells[column] ?? '';
      const cellIssue = row.cellIssues?.[column];
      if (cellIssue === 'formula' || value.startsWith('=')) {
        issues.push(field.label + ' uses a formula. Paste a fixed value into the source file.');
      } else if (cellIssue === 'error') {
        issues.push(field.label + ' contains an Excel error. Correct it in the source file.');
      } else {
        values[field.key] = value;
        if (cellIssue === 'long-number' && identifierFields.has(field.key)) {
          issues.push(field.label + ' may have lost digits in Excel. Export this identifier as text.');
        }
      }
    }
    const firstText = row.cells.find(Boolean);
    const footer = dataset === 'stock' && /^(?:grand total|sub\s?total|report total):?$/i.test(firstText ?? '');
    const repeatedHeader = Object.values(mapping).length > 0 && Object.values(mapping)
      .every((column) => normalizeHeader(row.cells[column] ?? '') === normalizeHeader(headings[column] ?? ''));
    if ((!values.sku && footer) || (repeatedHeader && issues.length === 0)) {
      ignored++;
      continue;
    }
    rows.push({ number: row.number, values, issues });
  }
  return { rows, ignored };
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = index.get(key);
    if (group) group.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function numericText(value: string) {
  const text = value.trim();
  return /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(text)
    ? text.replace(/,/g, '') : text;
}

function phoneKey(value = '') {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function previewProducts(rows: MappedRow[], existing: ProductIdentity[]): PreviewRow[] {
  const skuIndex = groupBy(rows, (row) => normalizeKey(row.values.sku));
  const atlasSkus = new Set(existing.map((product) => normalizeKey(product.sku)));
  return rows.map((row) => {
    const { sku, name, unit, category, purchaseCost, sellingPrice, hsn, tax } = row.values;
    const issues = [...row.issues];
    const skuKey = normalizeKey(sku);
    const normalizedUnit = normalizeUnit(unit);
    if (!name || name.length > 255) issues.push('Enter a product name up to 255 characters.');
    if (!skuKey || (sku?.length ?? 0) > 100) issues.push('Enter an item code up to 100 characters.');
    if (!normalizedUnit) issues.push(unit ? 'Atlas does not recognise this main unit.' : 'Main unit is missing.');
    if (category && category.length > 100) issues.push('Category exceeds 100 characters.');
    if ((skuIndex.get(skuKey)?.length ?? 0) > 1) issues.push('Duplicate SKU in the source sheet.');
    if (skuKey && atlasSkus.has(skuKey)) issues.push('This SKU already exists in Atlas.');
    const amounts = [{ value: purchaseCost, label: 'Purchase cost' }, { value: sellingPrice, label: 'Selling price' }];
    for (const amount of amounts) {
      if (!amount.value) continue;
      const validation = validateMoneyInput(numericText(amount.value.replace(/^₹\s*/, '')), amount.label);
      if (!validation.valid) issues.push(validation.error ?? amount.label + ' is invalid.');
    }
    if (hsn && !/^\d{4,8}$/.test(hsn)) issues.push('Check the HSN code. Use 4 to 8 digits.');
    if (tax) {
      const result = validateTaxRateInput(tax.replace(/\s*%$/, ''), 'GST rate');
      if (!result.valid) issues.push(result.error ?? 'GST rate is invalid.');
    }
    return { ...row, normalizedUnit, issues };
  });
}

export function previewCustomers(rows: MappedRow[], existing: CustomerIdentity[], includesGroup: boolean): PreviewRow[] {
  const fromSheet = rows.map((row) => ({ name: row.values.name ?? '', gstin: row.values.gstin, phone: row.values.phone }));
  const byGstin = (customer: CustomerIdentity) => normalizeKey(customer.gstin);
  const byPhone = (customer: CustomerIdentity) => phoneKey(customer.phone);
  const byName = (customer: CustomerIdentity) => normalizeKey(customer.name);
  const sourceIndexes = [groupBy(fromSheet, byGstin), groupBy(fromSheet, byPhone), groupBy(fromSheet, byName)];
  const atlasIndexes = [groupBy(existing, byGstin), groupBy(existing, byPhone), groupBy(existing, byName)];
  return rows.map((row, index) => {
    const issues = [...row.issues];
    const { name, group, gstin, phone, email } = row.values;
    if (!name || name.length > 255) issues.push('Enter a customer name up to 255 characters.');
    if (includesGroup && !['sundry debtor', 'sundry debtors', 'customer', 'customers', 'trade receivables', 'accounts receivable'].includes(normalizeHeader(group ?? ''))) {
      issues.push(group ? 'Review this account group before treating it as a customer.' : 'Customer account group is missing.');
    }
    if (gstin && !validateGstin(gstin).valid) issues.push('Check the GSTIN format.');
    if (phone && (!/^[+\d\s().-]+$/.test(phone) || !phoneKey(phone))) issues.push('Check the phone number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Check the email address.');
    const customer = fromSheet[index];
    const keys = [byGstin(customer), byPhone(customer), byName(customer)];
    if (keys.some((key, i) => key && (sourceIndexes[i].get(key)?.length ?? 0) > 1)) {
      issues.push('Possible duplicate customer in the source sheet.');
    }
    if (keys.some((key, i) => key && atlasIndexes[i].has(key))) issues.push('Possible match to an existing Atlas customer.');
    return { ...row, issues };
  });
}

export function previewStock(rows: MappedRow[], products: PreviewRow[], existing: ProductIdentity[], atlasCompared = true): PreviewRow[] {
  const fromSheet = products.filter(({ values }) => values.sku && values.name)
    .map(({ values }) => ({ sku: values.sku!, name: values.name!, uom: values.unit ?? '' }));
  const bySku = (product: ProductIdentity) => normalizeKey(product.sku);
  const byName = (product: ProductIdentity) => normalizeKey(product.name);
  const sourceSku = groupBy(fromSheet, bySku);
  const sourceName = groupBy(fromSheet, byName);
  const atlasSku = groupBy(existing, bySku);
  const atlasName = groupBy(existing, byName);

  const preview = rows.map((row) => {
    const issues = [...row.issues];
    const sku = normalizeKey(row.values.sku);
    const name = normalizeKey(row.values.name);
    const quantity = (row.values.quantity ?? '').match(/^([+-]?\d[\d,.]*)(?:\s*([\p{L}][\p{L}. ]*))?$/u);
    const value = validateQuantityInput(quantity ? numericText(quantity[1]) : row.values.quantity, 'Opening quantity', {
      min: 0, allowZero: true,
    });
    if (!value.valid) issues.push(value.error ?? 'Check the opening quantity.');
    const unitText = row.values.unit || quantity?.[2] || '';
    const normalizedUnit = normalizeUnit(unitText);
    const inlineUnit = normalizeUnit(quantity?.[2]);
    if (!normalizedUnit) issues.push(unitText ? 'Atlas does not recognise this stock unit.' : 'Stock unit is missing.');
    if (row.values.unit && quantity?.[2] && normalizedUnit !== inlineUnit) issues.push('The quantity and unit columns use different units.');

    const sourceMatches = (sku ? sourceSku.get(sku) : sourceName.get(name)) ?? [];
    const atlasMatches = (sku ? atlasSku.get(sku) : atlasName.get(name)) ?? [];
    const sourceProduct = sourceMatches[0];
    const atlasProduct = atlasMatches[0];
    const ambiguous = sourceMatches.length > 1 || atlasMatches.length > 1 ||
      (sourceProduct && atlasProduct && bySku(sourceProduct) !== bySku(atlasProduct));
    const product = sourceProduct ?? atlasProduct;
    let matchedProduct: ProductIdentity | undefined;
    if (!sku && !name) issues.push('Enter a SKU or product name.');
    else if (!product) issues.push(atlasCompared
      ? 'Product not found in the product export or Atlas catalog.'
      : 'No match in the product export. Compare with Atlas to check the catalog.');
    else if (ambiguous) {
      issues.push('More than one product matches. Check the SKU.');
    } else {
      const matches = [...sourceMatches, ...atlasMatches];
      if (sku && name && !matches.some((match) => byName(match) === name)) {
        issues.push('The SKU matches a different product name.');
      } else matchedProduct = product;
      const expected = matches.map((match) => normalizeUnit(match.uom));
      if (expected.some((unit) => !unit)) issues.push('A matching product needs a recognised main unit.');
      if (normalizedUnit && expected.some((unit) => unit && unit !== normalizedUnit)) {
        issues.push('Stock unit differs from the product main unit (' +
          [...new Set(matches.map((match) => match.uom || 'missing'))].join(' / ') + ').');
      }
      if (atlasMatches.length) issues.push('This product already exists in Atlas. Review its stock before applying an opening balance.');
    }
    return {
      ...row, issues, normalizedUnit,
      matchedProduct: matchedProduct ? matchedProduct.name + ' · ' + matchedProduct.sku : undefined,
      identity: matchedProduct ? 'sku:' + bySku(matchedProduct) : sku ? 'sku:' + sku : name ? 'name:' + name : '',
    };
  });
  const groups = groupBy(preview, (row) => row.identity);
  return preview.map(({ identity, ...row }) => ({
    ...row,
    issues: (groups.get(identity)?.length ?? 0) > 1
      ? [...row.issues, 'Multiple stock rows use this SKU or name. Review them before migration.']
      : row.issues,
  }));
}
