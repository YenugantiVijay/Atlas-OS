import { test, expect } from '@playwright/test';

test('Products catalog offers immediate stock and selling-price suggestions with keyboard selection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/#/products');
  await expect(page.getByRole('heading', { name: /Products & Catalog/ })).toBeVisible();

  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.fill('Havells');
  const options = page.getByRole('listbox', { name: 'Matching catalog products' }).getByRole('option');
  await expect(options.first()).toBeVisible();
  await expect(options.first()).toContainText('Stock');
  await expect(options.first()).toContainText('₹');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(search).not.toHaveValue('Havells');
  await expect(page.getByRole('listbox', { name: 'Matching catalog products' })).toHaveCount(0);
});
