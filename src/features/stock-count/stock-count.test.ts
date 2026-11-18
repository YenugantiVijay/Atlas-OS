import { File as NodeFile } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { readImportFile, type SourceSheet } from '@/features/import-preview/import-file';
import { buildStockCountWorkbook } from './stock-count-export';
import { parseCountDate, readCountRows, reviewCount, suggestCountSetup, type CountValues } from './stock-count';

const products = [
  { sku: 'NPK-01', name: 'Fertilizer NPK', uom: 'Bags' },
  { sku: 'NPK-02', name: 'Fertilizer NPK', uom: 'Kg' },
];
const base: CountValues = {
  sku: 'NPK-01', name: 'Fertilizer NPK', batch: '0008', expiry: '31/03/2026',
  quantity: '12', unit: 'bags', godown: 'Main godown',
};
const date = '2026-03-31';

describe('stock count and expiry review', () => {
  it('requires real dates and respects the selected order for numeric dates', () => {
    expect(parseCountDate('04/05/2026', 'dmy')).toBe('2026-05-04');
    expect(parseCountDate('04/05/2026', 'mdy')).toBe('2026-04-05');
    expect(parseCountDate('2024-02-29')).toBe('2024-02-29');
    for (const value of ['2025-02-29', '31/04/2026', 'Mar 2026', '03/2026', '46000', '']) {
      expect(parseCountDate(value)).toBeUndefined();
    }
  });

  it('maps a late header and retains leading zeros, formula issues, and source row numbers', () => {
    const headings = ['Item Code', 'Batch No.', 'Expiry Date', 'Counted Qty', 'Unit'];
    const sheet: SourceSheet = { name: 'Counts', rows: [
      { number: 1, cells: ['Warehouse stock count'] },
      { number: 3, cells: headings },
      { number: 7, cells: ['NPK-01', '0008', '31/03/2026', '', 'Bags'], cellIssues: { 3: 'formula' } },
      { number: 9, cells: headings },
    ] };
    const { header, mapping } = suggestCountSetup(sheet);
    expect(header).toBe(3);
    expect(readCountRows(sheet, header, mapping, '  Main godown  ')).toEqual([{
      number: 7,
      values: { sku: 'NPK-01', name: '', batch: '0008', expiry: '31/03/2026', quantity: '', unit: 'Bags', godown: 'Main godown' },
      issues: { quantity: 'Replace the formula with a fixed value.' },
    }]);
  });

  it('recalculates expiry, including the count-day boundary and explicitly non-expiring items', () => {
    const rows = [
      { number: 2, values: base, issues: {} },
      { number: 3, values: { ...base, batch: '0009', expiry: '01/04/2026' }, issues: {} },
      { number: 4, values: { ...base, batch: '', expiry: 'No expiry', quantity: '0' }, issues: {} },
      { number: 5, values: { ...base, batch: '0010', expiry: '' }, issues: {} },
    ];
    expect(reviewCount(rows, products, date, 'dmy').map(({ status }) => status))
      .toEqual(['Expired', 'Usable', 'Usable', 'Needs review']);
    expect(reviewCount(rows, products, '2026-04-01', 'dmy')[1].status).toBe('Expired');
  });

  it('checks duplicates by SKU, batch and godown and validates identity and units', () => {
    const values = [
      base,
      { ...base, godown: 'main  godown  ' },
      { ...base, godown: 'Overflow' },
      { ...base, sku: '', batch: '0009' },
      { ...base, sku: 'UNKNOWN', batch: '0010' },
      { ...base, unit: 'Kg', batch: '0011' },
      { ...base, batch: '0012', quantity: '1.5' },
      { ...base, sku: 'NPK-02', unit: 'Kg', quantity: '1,200.125' },
    ];
    const result = reviewCount(values.map((value, index) => ({ number: index + 2, values: value, issues: {} })), products, date, 'dmy');
    expect(result.map(({ status }) => status)).toEqual([
      'Needs review', 'Needs review', 'Expired', 'Needs review', 'Needs review', 'Needs review', 'Needs review', 'Expired',
    ]);
    expect(result[7].countedQuantity).toBe(1200.125);
    expect(reviewCount([{ number: 2, values: base, issues: {} }], undefined, date, 'dmy')[0].status).toBe('Needs review');
  });

  it('exports the edited values to separate Excel sheets with numeric counts and text batches', async () => {
    const rows = reviewCount([
      { number: 2, values: base, issues: {} },
      { number: 3, values: { ...base, batch: '0009', expiry: '04/04/2026' }, issues: {} },
      { number: 4, values: { ...base, batch: '0010', name: '=bad' }, issues: { name: 'Use text.' } },
    ], products, date, 'dmy');
    const workbook = new Workbook();
    await workbook.xlsx.load(await buildStockCountWorkbook(rows, date, 'stock.xlsx', 'Count'));
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['Summary', 'Expired', 'Usable', 'Needs review']);
    expect(workbook.getWorksheet('Expired')?.getCell('F2').value).toBe('0008');
    expect(workbook.getWorksheet('Expired')?.getCell('H2').value).toBe(12);
    expect(workbook.getWorksheet('Needs review')?.getCell('C2').value).toBe("'=bad");
  });

  it('preserves full Excel dates and sends month-only expiry dates to review', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Stock count');
    sheet.addRows([
      ['SKU', 'Batch', 'Expiry Date', 'Quantity', 'Unit', 'Godown'],
      ['NPK-01', 8, new Date('2026-03-31T00:00:00Z'), 12, 'Bags', 'Main'],
      ['NPK-01', 9, new Date('2026-03-31T00:00:00Z'), 4, 'Bags', 'Main'],
    ]);
    sheet.getCell('B2').numFmt = '0000';
    sheet.getCell('C2').numFmt = 'dd/mm/yyyy';
    sheet.getCell('C3').numFmt = 'mmm-yyyy';
    const [source] = await readImportFile(new NodeFile([new Uint8Array(await workbook.xlsx.writeBuffer({ zip: { compression: 'STORE' } }) as ArrayBuffer)], 'counts.xlsx'), { calendarDates: true });
    const setup = suggestCountSetup(source);
    const reviewed = reviewCount(readCountRows(source, setup.header, setup.mapping, ''), products, date, 'dmy');
    expect(reviewed[0]).toMatchObject({ expiryText: '2026-03-31', status: 'Expired', values: { batch: '0008' } });
    expect(reviewed[1]).toMatchObject({ expiryText: '2026-03', status: 'Needs review' });
  });

  it('accepts imported CSV counts through the shared file reader', async () => {
    const [sheet] = await readImportFile(new NodeFile([
      'SKU,Batch,Expiry,Quantity,Unit,Warehouse\nNPK-01,0008,2026-03-31,12,Bags,Main\n',
    ], 'stock.csv'));
    const setup = suggestCountSetup(sheet);
    const reviewed = reviewCount(readCountRows(sheet, setup.header, setup.mapping, ''), products, date, 'dmy');
    expect(reviewed[0]).toMatchObject({ number: 2, status: 'Expired', countedQuantity: 12, values: { batch: '0008' } });
  });
});
