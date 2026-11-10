import { test, expect } from '@playwright/test';

test.describe('PR #53 — Retail Counter billing workstation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
    await page.goto('/#/pos');
    await expect(page.getByRole('heading', { name: 'Retail Counter' })).toBeVisible();
  });

  test('shows compact invoice-style worksheet without unsafe billing actions', async ({ page }) => {
    const worksheet = page.getByRole('region', { name: 'Scroll billing line items' });
    await expect(worksheet).toBeVisible();
    const headings = ['Sl.', 'Product / SKU', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc %', 'GST %', 'Line total', 'Stock*'];
    for (const heading of headings) {
      await expect(worksheet.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    await expect(page.getByText(/Draft-only foundation:/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft sales order' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Generate Invoice' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collect Payment' })).toHaveCount(0);
  });

  test('supports keyboard-first product selection and inline quantity changes', async ({ page }) => {
    const search = page.getByLabel('Search POS products');
    await page.keyboard.press('F2');
    await expect(search).toBeFocused();
    await search.fill('Polycab');
    const result = page.getByRole('button', { name: /Add Polycab/i }).first();
    await expect(result).toBeVisible();
    await search.press('Enter');
    const worksheet = page.getByRole('table');
    await expect(worksheet.getByText(/Polycab/i).first()).toBeVisible();
    const qty = page.getByLabel(/Quantity for Polycab/i).first();
    await qty.fill('3');
    await expect(qty).toHaveValue('3');
    await expect(search).toHaveValue('');
  });

  test('keeps billing-grid horizontal scrolling inside the worksheet on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const region = page.getByRole('region', { name: 'Scroll billing line items' });
    await expect(region).toBeVisible();
    const size = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    if (size.docWidth > size.viewport + 1) {
      const overflowing = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className.slice(0, 140) : '',
          right: Math.round(element.getBoundingClientRect().right),
          left: Math.round(element.getBoundingClientRect().left),
        }))
        .filter((element) => element.right > document.documentElement.clientWidth + 2)
        .slice(0, 18));
      console.log('POS mobile overflow diagnostics', JSON.stringify(overflowing));
    }
    expect(size.docWidth).toBeLessThanOrEqual(size.viewport + 1);
    const innerWidths = await region.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(innerWidths.scrollWidth).toBeGreaterThan(innerWidths.clientWidth);
  });

  test('profile menu displays user identity separately from organization selector', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const profile = page.getByRole('button', { name: 'User Profile & Shop Menu' });
    await expect(profile).toBeVisible();
    await expect(profile).toContainText('owner', { ignoreCase: true });
    await expect(page.getByRole('button', { name: /Switch organization/i })).toBeVisible();
    await profile.click();
    await expect(page.getByText('Edit Profile & Photo')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(profile).toHaveAttribute('aria-expanded', 'false');
  });
});
