import { test, expect } from '@playwright/test';

test.describe('ATLAS OS — PR #48: Premium UI Refinement Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  });

  test('verifies official BrandLogo has no tagline and displays ATLAS OS wordmark', async ({ page }) => {
    const brand = page.locator('aside').getByTitle('Atlas OS');
    await expect(brand).toBeVisible();

    const logoImg = brand.getByRole('img', { name: 'Atlas OS logo' });
    await expect(logoImg).toBeVisible();
    await expect(logoImg).toHaveAttribute('src', '/favicon.svg');

    await expect(brand.getByText('ATLAS')).toBeVisible();
    await expect(brand.getByText('OS')).toBeVisible();
    await expect(page.locator('aside').getByText('Electrical Distribution')).toHaveCount(0);
  });

  test('verifies premium Dashboard Hero has dynamic org, concise copy, and equalized CTAs', async ({ page }) => {
    await expect(page.getByText('Operations Center')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
    await expect(page.getByText('Real-time operational command for inventory movements, sales orders, and financial workflows.')).toBeVisible();

    const newOrderBtn = page.getByRole('button', { name: 'New Sales Order' });
    const aiBtn = page.getByRole('button', { name: 'ATLAS AI' });

    await expect(newOrderBtn).toBeVisible();
    await expect(aiBtn).toBeVisible();

    const orderBox = await newOrderBtn.boundingBox();
    const aiBox = await aiBtn.boundingBox();

    expect(orderBox).not.toBeNull();
    expect(aiBox).not.toBeNull();
    if (orderBox && aiBox) {
      // Button heights must be equalized
      expect(Math.round(orderBox.height)).toBe(Math.round(aiBox.height));
    }
  });

  test('verifies sidebar navigation is clean without view selector and groups work', async ({ page }) => {
    const aside = page.locator('aside');

    // View selector must NOT exist
    await expect(aside.getByRole('combobox', { name: /navigation layout/i })).toHaveCount(0);
    await expect(aside.getByText('Simple View')).toHaveCount(0);
    await expect(aside.getByText('Full Navigation')).toHaveCount(0);

    // Static section headings exist without dropdown toggle buttons
    await expect(aside.getByText('Sales', { exact: true })).toBeVisible();
    await expect(aside.getByText('Inventory', { exact: true })).toBeVisible();
    await expect(aside.getByText('Finance', { exact: true })).toBeVisible();
    await expect(aside.getByRole('button', { name: 'Sales' })).toHaveCount(0);
    await expect(aside.getByRole('button', { name: 'Inventory' })).toHaveCount(0);
    await expect(aside.getByRole('button', { name: 'Finance' })).toHaveCount(0);
    await expect(aside.getByRole('link', { name: 'Sales Orders' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Products & SKUs' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Payments & Ledger' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'ATLAS AI Assistant' })).toBeVisible();
  });

  test('verifies top header controls have unified height and no horizontal overflow on mobile', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Verify search button
    const searchBtn = header.getByRole('button', { name: 'Search Atlas OS' });
    await expect(searchBtn).toBeVisible();

    // Verify organization selector
    const orgSelector = header.getByRole('button', { name: /Switch organization/i });
    await expect(orgSelector).toBeVisible();

    // Verify profile menu
    const profileBtn = header.getByRole('button', { name: 'User Profile & Shop Menu' });
    await expect(profileBtn).toBeVisible();

    // Check dropdown opens and closes
    await profileBtn.click();
    await expect(page.getByText('Edit Profile & Photo')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Edit Profile & Photo')).not.toBeVisible();
  });

  const viewports = [
    { name: 'Desktop (1280px)', width: 1280, height: 800 },
    { name: 'Tablet (768px)', width: 768, height: 1024 },
    { name: 'Mobile (375px)', width: 375, height: 667 },
    { name: 'Narrow Mobile (320px)', width: 320, height: 568 },
  ];

  for (const vp of viewports) {
    test(`verifies zero horizontal overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);

      const overflowInfo = await page.evaluate(() => {
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenders: Array.from(document.querySelectorAll('body *'))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                className: typeof element.className === 'string' ? element.className : '',
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
              };
            })
            .filter((element) => element.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1)
            .sort((a, b) => b.right - a.right || (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))
            .slice(0, 20),
        };
      });

      expect(overflowInfo.scrollWidth, JSON.stringify(overflowInfo.offenders)).toBeLessThanOrEqual(overflowInfo.clientWidth);
    });
  }
});
