import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

test('previews a BUSY workbook with editable mappings and keeps records local', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Demo Sandbox' }).click();
  await page.getByRole('link', { name: 'Products & SKUs' }).click();
  await page.getByRole('link', { name: 'BUSY import preview' }).click();
  await expect(page.getByRole('heading', { name: 'BUSY import preview' })).toBeVisible();

  const workbook = new ExcelJS.Workbook();
  const items = workbook.addWorksheet('Item Master');
  items.addRows([
    ['BUSY Item List'],
    ['Item Name', 'Alias', 'Main Unit'],
    ['Demo import relay', 19, 'PCS'],
    ['Another relay', 'DUP-1', 'Nos'],
    ['Duplicate relay', 'dup-1', 'Nos'],
    ['Existing cable', 'POL-W-2.5-RD', 'Coils'],
  ]);
  items.getCell('B3').numFmt = '00000';
  workbook.addWorksheet('Sundry Debtors').addRows([
    ['Account Name', 'Group', 'Mobile No'],
    ['Demo import customer', 'Sundry Debtors', '9876543210'],
    ['Supplier account', 'Sundry Creditors', '9898765432'],
  ]);
  workbook.addWorksheet('Closing Stock').addRows([
    ['Alias', 'Item Name', 'Balance in main UOM', 'Main Unit', 'Stock Value'],
    ['00019', 'Demo import relay', '12', 'Boxes', '1440'],
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE' } }));
  await page.getByLabel('Export file').setInputFiles({
    name: 'BUSY-exports.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer,
  });
  await expect(page.getByLabel('Header row')).toHaveValue('2');
  const products = page.getByRole('table', { name: 'Products import preview' });
  await expect(products.getByRole('row').filter({ hasText: 'Demo import relay' })).toContainText('00019');
  await expect(products.getByText('Duplicate SKU in the source sheet.')).toHaveCount(2);
  await expect(products.getByText('This SKU already exists in Atlas.')).toBeVisible();
  await page.getByLabel('Show rows needing review').check();
  await expect(products.getByText('Demo import relay')).toHaveCount(0);

  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByLabel('Use a loaded workbook').selectOption('1');
  await expect(page.getByLabel('Worksheet')).toHaveValue('Sundry Debtors');
  await expect(page.getByRole('table', { name: 'Customers import preview' }))
    .toContainText('Review this account group before treating it as a customer.');
  await page.getByLabel('Export file').setInputFiles({
    name: 'BUSY-customers.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Account Name,Group\nCSV import customer,Sundry Debtors\n'),
  });
  await expect(page.getByRole('table', { name: 'Customers import preview' })).toContainText('CSV import customer');

  await page.getByRole('button', { name: 'Opening stock', exact: true }).click();
  await page.getByLabel('Use a loaded workbook').selectOption('1');
  await expect(page.getByLabel('Worksheet')).toHaveValue('Closing Stock');
  await expect(page.getByRole('alert')).toContainText('Opening quantity');
  await page.getByLabel('Opening quantity').selectOption('4');
  await expect(page.getByRole('alert')).toContainText('monetary value');
  await page.getByLabel('Opening quantity').selectOption('2');
  const stock = page.getByRole('table', { name: 'Opening stock import preview' });
  await expect(stock).toContainText('Demo import relay · 00019');
  await expect(stock).toContainText('Stock unit differs from the product main unit');

  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();
  await expect(page.getByText('Demo import relay')).toHaveCount(0);
});

test('handles late headers, unnamed columns and Excel display formats on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Demo Sandbox' }).click();
  await page.goto('/#/import-preview');
  const workbook = new ExcelJS.Workbook();
  const items = workbook.addWorksheet('Item Master');
  for (let row = 1; row <= 55; row++) items.getCell('A' + row).value = 'BUSY report information ' + row;
  items.getRow(60).values = ['Item Name', 'Alias', 'Main Unit', 'GST Rate'];
  items.getRow(61).values = ['Mobile relay', 'MOB-01', 'Nos', 0.18, 180];
  items.getCell('D61').numFmt = '0%';
  items.getRow(62).values = ['Long SKU', 1234567890123456, 'Nos'];
  items.getRow(63).values = ['Faulty relay', 'FAULT-1', 'Nos', { error: '#N/A' }];
  await page.getByLabel('Export file').setInputFiles({
    name: 'BUSY-report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });

  const header = page.getByRole('spinbutton', { name: 'Header row' });
  await header.fill('58');
  await page.getByRole('button', { name: 'Use row' }).click();
  await expect(page.getByText('Choose a populated source row.')).toBeVisible();
  await header.fill('60');
  await page.getByRole('button', { name: 'Use row' }).click();
  await page.getByLabel('Selling price').selectOption({ label: 'E · Unnamed column' });
  const table = page.getByRole('table', { name: 'Products import preview' });
  await expect(table.getByRole('row').filter({ hasText: 'Mobile relay' })).toContainText('18%');
  await expect(table.getByRole('row').filter({ hasText: 'Mobile relay' })).toContainText('180');
  await expect(table.getByRole('row').filter({ hasText: 'Long SKU' })).toContainText('may have lost digits');
  await expect(table.getByRole('row').filter({ hasText: 'Faulty relay' })).toContainText('contains an Excel error');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
