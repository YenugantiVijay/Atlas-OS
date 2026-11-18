import { sanitizeExcelText, triggerExcelDownload } from '@/lib/excel';
import { countStatuses, type ReviewRow } from './stock-count';

export async function buildStockCountWorkbook(rows: ReviewRow[], countDate: string, file: string, sheetName: string) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 25 }, { width: 65 }];
  summary.addRows([
    ['Stock count review', 'Preview only — no inventory changes'],
    ['Count date', countDate],
    ['Source file', sanitizeExcelText(file)],
    ['Source sheet', sanitizeExcelText(sheetName)],
    ['Expiry rule', 'Expired on or before the count date'],
    ['Status', 'Rows'],
    ...countStatuses.map((status) => [status, rows.filter((row) => row.status === status).length]),
  ]);
  summary.getRow(1).font = { bold: true };
  summary.getRow(6).font = { bold: true };

  for (const status of countStatuses) {
    const sheet = workbook.addWorksheet(status, { views: [{ state: 'frozen', ySplit: 1 }] });
    const headings = [
      ['Source row', 13], ['Entered SKU', 20], ['Entered item name', 32], ['Matched Atlas SKU', 20],
      ['Matched Atlas item', 32], ['Batch number', 19], ['Expiry', 18], ['Counted quantity', 19],
      ['Unit', 14], ['Godown', 23], ['Review notes', 72],
    ] as const;
    sheet.columns = headings.map(([header, width]) => ({ header, width }));
    sheet.autoFilter = { from: 'A1', to: 'K1' };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    for (const row of rows) {
      if (row.status !== status) continue;
      const { values } = row;
      const quantity = row.issues.quantity ? values.quantity : row.countedQuantity ?? values.quantity;
      sheet.addRow([
        row.number, values.sku, values.name, row.matchedProduct?.sku, row.matchedProduct?.name, values.batch,
        row.expiryText, quantity, values.unit, values.godown, row.problems.join(' '),
      ].map((value) => typeof value === 'number' ? value : sanitizeExcelText(value).slice(0, 32_767)));
    }
  }

  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}

export async function downloadStockCount(rows: ReviewRow[], countDate: string, file: string, sheet: string) {
  const buffer = await buildStockCountWorkbook(rows, countDate, file, sheet);
  triggerExcelDownload(buffer, `atlas-stock-count-${countDate}.xlsx`);
}
