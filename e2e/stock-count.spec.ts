import { test, expect } from './workspace-fixture';
import ExcelJS from 'exceljs';

test('reviews a warehouse workbook on mobile and downloads separate stock lists', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Demo Sandbox' }).click();
  await page.goto('/#/stock-count');
  await expect(page.getByRole('heading', { name: 'Stock count & expiry review' })).toBeVisible();

  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Cover').addRow(['Year-end warehouse count']);
  const sheet = workbook.addWorksheet('Main godown');
  sheet.addRows([
    ['Stock count'],
    ['SKU', 'Batch No.', 'Expiry date', 'Counted Qty', 'UOM'],
    ['POL-W-2.5-RD', 8, new Date('2026-03-31Z'), 12, 'Coils'],
    ['POL-W-2.5-RD', 9, new Date('2026-04-30Z'), 20, 'Coils'],
    ['POL-W-2.5-RD', 10, new Date('2026-04-30Z'), 5, 'Coils'],
  ]);
  for (const row of [3, 4, 5]) sheet.getCell('B' + row).numFmt = '0000';
  sheet.getCell('C3').numFmt = 'dd/mm/yyyy';
  sheet.getCell('C4').numFmt = 'dd/mm/yyyy';
  sheet.getCell('C5').numFmt = 'mmm-yyyy';

  await page.getByLabel('Stock count file').setInputFiles({
    name: 'warehouse-count.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(page.getByLabel('Header row')).toHaveValue('2');
  await page.getByLabel('Stock count date').fill('2026-03-31');
  await page.getByLabel('Default godown').fill('Main godown');
  await page.getByRole('button', { name: 'Build preview', exact: true }).click();
  const table = page.getByRole('table', { name: 'Stock count review' });
  await expect(table.getByRole('row').filter({ hasText: '0008' })).toContainText('Expired');
  await expect(table.getByRole('row').filter({ hasText: '0009' })).toContainText('Usable');
  await expect(table.getByRole('row').filter({ hasText: '0010' })).toContainText('Enter a full expiry date');

  await page.getByRole('button', { name: 'Needs review 1' }).click();
  await page.getByRole('button', { name: 'Edit row 5' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Expiry date').fill('2026-05-31');
  await dialog.getByLabel('Counted quantity').fill('11');
  await dialog.getByRole('button', { name: 'Apply to preview' }).click();
  await expect(page.getByText('No rows in this group.')).toBeVisible();
  await page.getByRole('button', { name: 'Usable 2' }).click();
  await expect(table.getByRole('row').filter({ hasText: '0010' })).toContainText('11 Coils');

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel review' }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('atlas-stock-count-2026-03-31.xlsx');
  const exported = new ExcelJS.Workbook();
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  await exported.xlsx.readFile(downloadPath!);
  expect(exported.getWorksheet('Expired')?.getCell('F2').value).toBe('0008');
  expect(exported.getWorksheet('Usable')?.getCell('H3').value).toBe(11);
  expect(exported.getWorksheet('Needs review')?.rowCount).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
