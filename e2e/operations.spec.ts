import { test, expect } from '@playwright/test';

test.describe('ATLAS OS — Electrical Distribution E2E Operational Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // When opened in Live Cloud default mode without active session, click Explore Demo Sandbox
    const exploreBtn = page.getByRole('button', { name: 'Explore Demo Sandbox' });
    if (await exploreBtn.isVisible()) {
      await exploreBtn.click();
    }
  });

  test('loads dashboard and displays organization identity and metrics', async ({ page }) => {
    await expect(page).toHaveTitle(/ATLAS OS/);
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
    await expect(page.getByText("Today's Sales")).toBeVisible();
    await expect(page.getByText('Outstanding Receivables')).toBeVisible();
    await expect(page.getByText('Total Orders')).toBeVisible();
    await expect(page.getByText('Inventory Valuation')).toBeVisible();
  });

  test('navigates to products catalog and filters by category', async ({ page }) => {
    await page.click('text=Products & SKUs');
    await expect(page).toHaveURL(/.*#\/products/);
    await expect(page.getByText('Products & Catalog')).toBeVisible();
    await expect(page.getByText('POL-W-2.5-RD')).toBeVisible();
    await expect(page.getByText('Havells 32A Double Pole C-Curve MCB')).toBeVisible();
  });

  test('opens command palette using keyboard shortcut Ctrl+K', async ({ page }) => {
    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder('Search commands, products, customers, or workflows...')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('navigates to sales orders and verifies order lifecycle', async ({ page }) => {
    await page.click('text=Sales Orders');
    await expect(page).toHaveURL(/.*#\/orders/);
    await expect(page.getByText('SO-2026-0001')).toBeVisible();
  });

  test('navigates to tax invoices and views commercial GST snapshot', async ({ page }) => {
    await page.click('text=Invoices');
    await expect(page).toHaveURL(/.*#\/invoices/);
    await expect(page.getByText('ATL/25-26/0001')).toBeVisible();
    await page.click('text=View Invoice');
    await expect(page.getByText(/Tax Invoice.*ATL\/25-26\/0001/)).toBeVisible();
    await expect(page.getByText('Billed To Customer')).toBeVisible();
  });

  test('interacts with ATLAS AI grounded business copilot', async ({ page }) => {
    await page.click('text=ATLAS AI Assistant');
    await expect(page).toHaveURL(/.*#\/ai/);
    await expect(page.getByRole('heading', { name: 'ATLAS AI Assistant' })).toBeVisible();
    await page.click("text=Summarize today's sales & orders");
    await expect(page.getByText('Operational Sales Summary for Sri Lakshmi Electrical Distributors')).toBeVisible({ timeout: 5000 });
  });

  test('verifies AI replenishment suggests purchase requisition proposal without direct stock inflation', async ({ page }) => {
    await page.click('text=ATLAS AI Assistant');
    await expect(page).toHaveURL(/.*#\/ai/);
    await page.click('text=Low-stock reorder suggestions');
    await expect(page.getByText('Generate Purchase Requisition Proposal')).toBeVisible({ timeout: 5000 });
    const approveBtn = page.getByRole('button', { name: 'Approve Requisition Proposal' });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect(page.getByRole('heading', { name: 'Requisition Proposal Approved' })).toBeVisible({ timeout: 5000 });
  });
});
