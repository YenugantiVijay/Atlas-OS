import { describe, expect, it } from 'vitest';
import { parseDelimitedSheet } from './import-file';
import {
  mappingIssues, previewCustomers, previewProducts, previewStock, readMappedRows,
  suggestColumns, suggestHeader, type ImportDataset,
} from './import-preview';

function source(dataset: ImportDataset, csv: string) {
  const sheet = parseDelimitedSheet(csv, 'BUSY export');
  const header = suggestHeader(dataset, sheet);
  const mapping = suggestColumns(dataset, sheet.rows.find((row) => row.number === header)!.cells);
  return { header, mapping, ...readMappedRows(dataset, sheet, header, mapping) };
}

describe('BUSY import preview', () => {
  it('keeps physical source row numbers when CSV has a title and quoted line breaks', () => {
    const parsed = source('products', '\uFEFFInventory report\r\nItem Name,Alias,Main Unit\r\n"Relay, Panel\nMount",00019,PCS\r\nRelay Base,019,NOS');
    expect(parsed.header).toBe(2);
    expect(parsed.rows.map((row) => row.number)).toEqual([3, 5]);
    expect(parsed.rows[0].values).toMatchObject({ name: 'Relay, Panel\nMount', sku: '00019' });
    expect(previewProducts(parsed.rows, [])[0]).toMatchObject({ normalizedUnit: 'Nos', issues: [] });
  });

  it('rejects incomplete quoted records and supports semicolon exports', () => {
    expect(() => parseDelimitedSheet('Name,Code\n"Missing quote,001', 'broken.csv')).toThrow(/incomplete/);
    expect(source('products', 'Item Name;Alias;Main Unit\n"Box, Steel";0002;Boxes').rows[0].values)
      .toMatchObject({ sku: '0002', name: 'Box, Steel', unit: 'Boxes' });
  });

  it('uses an Excel separator directive and retains row numbers for part names with inch marks', () => {
    const parsed = source('products', '\uFEFFsep=;\r\nReport details, Pune\r\nItem Name;Alias;Main Unit\r\nSocket 1";00001;Nos');
    expect(parsed.header).toBe(3);
    expect(parsed.rows[0]).toMatchObject({ number: 4, values: { name: 'Socket 1"', sku: '00001', unit: 'Nos' } });
    expect(source('products', 'Item Name;Alias;Main Unit\nSocket 1";00001;Nos\nSocket 2";00002;Nos').rows)
      .toHaveLength(2);
  });

  it('reports missing and overlapping mappings', () => {
    expect(mappingIssues('stock', { quantity: 2 })).toEqual([expect.stringContaining('SKU or product name')]);
    expect(mappingIssues('products', { sku: 0, name: 0, unit: 1 }))
      .toEqual([expect.stringContaining('own source column')]);
  });

  it('suggests a unique closing quantity and blocks clearly alternate or monetary mappings', () => {
    const headings = ['Item Name', 'Opening Qty', 'Closing Stock Qty', 'Alt. Unit Qty', 'Stock Value', 'Main Unit'];
    const mapping = suggestColumns('stock', headings);
    expect(mapping.quantity).toBe(2);
    expect(suggestColumns('stock', ['Item Name', 'Qty', 'Qty', 'Main Unit']).quantity).toBeUndefined();
    expect(suggestColumns('stock', ['Item Name', 'Opening Qty', 'Closing Stock', 'Main Unit']).quantity).toBeUndefined();
    expect(mappingIssues('stock', { ...mapping, quantity: 3 }, headings)).toEqual([expect.stringContaining('main-unit')]);
    expect(mappingIssues('stock', { ...mapping, quantity: 4 }, headings)).toEqual([expect.stringContaining('monetary value')]);
  });

  it('flags duplicate SKUs, existing items, invalid money and spreadsheet formulas', () => {
    const { rows } = source('products', [
      'Item Name,Alias,Main Unit,Sale Price', 'Relay,A-01,Nos,450',
      'Relay DIN,a-01,Nos,=150+5', 'Relay spare,B-02,Nos,12.999',
    ].join('\n'));
    const checked = previewProducts(rows, [{ sku: 'A-01', name: 'Existing relay', uom: 'Nos' }]);
    expect(checked[0].issues).toEqual(expect.arrayContaining([
      'Duplicate SKU in the source sheet.', 'This SKU already exists in Atlas.',
    ]));
    expect(checked[1].issues).toEqual(expect.arrayContaining([expect.stringContaining('uses a formula')]));
    expect(checked[2].issues).toEqual([expect.stringContaining('2 decimal places')]);
  });

  it('flags non-customer account groups and normalizes matching phone numbers', () => {
    const { rows } = source('customers', 'Account Name,Group,Mobile No,Email\nKiran Electricals,Sundry Debtors,+91 9876543210,not-an-email\nVendor Name,Sundry Creditors,98765 43210,');
    const checked = previewCustomers(rows, [{ name: 'Kiran Stores', phone: '9876543210' }], true);
    expect(checked[0].issues).toEqual(expect.arrayContaining([
      'Check the email address.', 'Possible duplicate customer in the source sheet.',
      'Possible match to an existing Atlas customer.',
    ]));
    expect(checked[1].issues).toContain('Review this account group before treating it as a customer.');
  });

  it('matches stock by SKU or unique name and flags unit mismatches, fractional quantities, duplicate lines and unmatched items', () => {
    const products = source('products', 'Item Name,Alias,Main Unit\nRelay,A-01,Nos\nWall plate,P-02,Nos');
    const stock = source('stock', [
      'Alias,Item Name,Closing Stock Qty,Main Unit',
      'A-01,Relay,12,Boxes',
      ',Relay,2.5,PCS',
      ',Wall plate,0 PCS,',
      'UNKNOWN,Unknown,8,Nos',
      ',Grand Total,22.5,',
    ].join('\n'));
    const checked = previewStock(stock.rows, previewProducts(products.rows, []), []);
    expect(stock.ignored).toBe(1);
    expect(checked[0]).toMatchObject({ matchedProduct: 'Relay · A-01', normalizedUnit: 'Boxes' });
    expect(checked[0].issues).toEqual(expect.arrayContaining([
      expect.stringContaining('differs from the product main unit'),
      expect.stringContaining('Multiple stock rows'),
    ]));
    expect(checked[1].issues).toEqual(expect.arrayContaining([expect.stringContaining('whole number')]));
    expect(checked[2]).toMatchObject({ matchedProduct: 'Wall plate · P-02', normalizedUnit: 'Nos', issues: [] });
    expect(checked[3].issues).toEqual(['Product not found in the product export or Atlas catalog.']);
  });

  it('asks for a SKU when product names are ambiguous and flags opening stock for existing Atlas products', () => {
    const products = source('products', 'Item Name,Alias,Main Unit\nRelay,A-01,Nos\nRelay,A-02,Nos');
    const stock = source('stock', 'Alias,Item Name,Qty,Unit\n,Relay,12,PCS\nATLAS-1,Terminal,9,Boxes');
    const checked = previewStock(stock.rows, previewProducts(products.rows, []), [
      { sku: 'ATLAS-1', name: 'Terminal', uom: 'Boxes' },
    ]);
    expect(checked[0].issues).toContain('More than one product matches. Check the SKU.');
    expect(checked[0].matchedProduct).toBeUndefined();
    expect(checked[1].issues).toEqual([expect.stringContaining('already exists in Atlas')]);
  });

  it('keeps an item named Total and leaves a mismatched SKU and name unresolved', () => {
    const products = source('products', 'Item Name,Alias,Main Unit\nTotal,T-01,Nos\nRelay,R-01,Nos');
    const stock = source('stock', 'Alias,Item Name,Qty,Unit\n,Total,9,Nos\nR-01,Total,3,Nos');
    const checked = previewStock(stock.rows, previewProducts(products.rows, []), []);
    expect(stock.ignored).toBe(0);
    expect(checked[0]).toMatchObject({ matchedProduct: 'Total · T-01', issues: [] });
    expect(checked[1].issues).toContain('The SKU matches a different product name.');
    expect(checked[1].matchedProduct).toBeUndefined();
  });

  it('distinguishes a missing source product from a completed Atlas comparison', () => {
    const stock = source('stock', 'Alias,Qty,Unit\nP-01,3,Nos');
    expect(previewStock(stock.rows, [], [], false)[0].issues).toEqual([
      'No match in the product export. Compare with Atlas to check the catalog.',
    ]);
  });
});
