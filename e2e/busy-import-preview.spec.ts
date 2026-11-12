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
    ['Alias', 'Item Name', 'Balance in main UOM', 'Main Unit'],
    ['00019', 'Demo import relay', '12', 'Boxes'],
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
  await page.getByLabel('Opening quantity').selectOption('2');
  const stock = page.getByRole('table', { name: 'Opening stock import preview' });
  await expect(stock).toContainText('Demo import relay · 00019');
  await expect(stock).toContainText('Stock unit differs from the product main unit');

  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();
  await expect(page.getByText('Demo import relay')).toHaveCount(0);
});
