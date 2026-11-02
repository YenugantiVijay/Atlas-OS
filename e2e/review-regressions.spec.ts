import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
});

test('clears AI history when switching organizations', async ({ page }) => {
  await page.goto('/#/ai');
  await page.getByRole('button', { name: "Summarize today's sales & orders" }).click();
  await expect(page.getByText('Operational Sales Summary for Sri Lakshmi Electrical Distributors')).toBeVisible();
  await page.getByRole('button', { name: /^Switch organization:/ }).click();
  await page.getByRole('button', { name: /Apex Electro Controls/ }).click();
  await expect(page.getByText(/Hello! I am ATLAS Operational Assistant for Apex Electro Controls/)).toBeVisible();
  await expect(page.getByText('Operational Sales Summary for Sri Lakshmi Electrical Distributors')).toHaveCount(0);
});

test('returns valuation for the inventory valuation prompt', async ({ page }) => {
  await page.goto('/#/ai');
  await page.getByRole('button', { name: 'Inventory valuation breakdown' }).click();
  await expect(page.getByText('Total Stock Value at Purchase Cost:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Requisition Proposal' })).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`keeps header controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const label of ['Open navigation menu', 'Switch organization', 'Search Atlas OS', 'Quick Create', 'User Profile & Shop Menu']) {
      const button = page.getByRole('button', { name: label === 'Switch organization' ? /^Switch organization:/ : label, exact: true });
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole('button', { name: 'User Profile & Shop Menu', exact: true }).click();
    await expect(page.getByText('Edit Profile & Photo', { exact: true })).toBeVisible();
  });
}

test('search selection opens the filtered catalog and restores keyboard focus', async ({ page }) => {
  const search = page.getByRole('button', { name: 'Search Atlas OS', exact: true });
  await search.click();
  await page.getByRole('textbox', { name: 'Search Atlas OS' }).fill('POL-W-2.5-RD');
  await page.getByRole('button', { name: /Polycab 2.5 sq mm/ }).click();
  await expect(page).toHaveURL(/products\?search=POL-W-2.5-RD/);
  await expect(page.getByRole('textbox', { name: /Search products/i })).toHaveValue('POL-W-2.5-RD');
  await expect(page.getByText('HAV-MCB-DP-32A', { exact: true })).toHaveCount(0);
  await search.click();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
});

for (const route of ['orders', 'quotations']) {
  test(`preserves zero price and tax when changing a ${route} line item`, async ({ page }) => {
    const zeroProduct = await page.evaluate(() => {
      const products = JSON.parse(localStorage.getItem('atlas_products_v1') || '[]');
      products[0].sellingPrice = 100;
      products[0].taxRate = 18;
      products[1].sellingPrice = 0;
      products[1].taxRate = 0;
      localStorage.setItem('atlas_products_v1', JSON.stringify(products));
      return products[1].id;
    });
    await page.goto(`/#/${route}`);
    await page.getByRole('button', { name: route === 'orders' ? 'New Sales Order' : 'Create Quotation', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Product 1' }).selectOption(zeroProduct);
    await expect(dialog.getByTitle('Unit Price')).toHaveValue('0');
    await expect(dialog.getByText('GST Tax Amount:').locator('..')).toContainText('₹0.00');
  });
}
