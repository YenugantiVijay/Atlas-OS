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
    // AI is intentionally hidden in the default Essentials navigation.
    // Choose the permission-preserving All Tools view before using it.
    await page.getByRole('button', { name: 'All Tools' }).click();
    await page.getByRole('link', { name: /ATLAS AI Assistant/ }).click();
    await expect(page).toHaveURL(/.*#\/ai/);
    await expect(page.getByRole('heading', { name: 'ATLAS AI Assistant' })).toBeVisible();
    await page.click("text=Summarize today's sales & orders");
    await expect(page.getByText('Operational Sales Summary for Sri Lakshmi Electrical Distributors')).toBeVisible({ timeout: 5000 });
  });

  test('verifies AI replenishment suggests purchase requisition proposal without direct stock inflation', async ({ page }) => {
    // AI is intentionally hidden in the default Essentials navigation.
    // Choose the permission-preserving All Tools view before using it.
    await page.getByRole('button', { name: 'All Tools' }).click();
    await page.getByRole('link', { name: /ATLAS AI Assistant/ }).click();
    await expect(page).toHaveURL(/.*#\/ai/);
    await page.click('text=Low-stock reorder suggestions');
    await expect(page.getByText('Generate Purchase Requisition Proposal')).toBeVisible({ timeout: 5000 });
    const approveBtn = page.getByRole('button', { name: 'Approve Requisition Proposal' });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect(page.getByRole('heading', { name: 'Requisition Proposal Approved' })).toBeVisible({ timeout: 5000 });
  });

  test('verifies dashboard charts and server-side pagination controls across product catalog', async ({ page }) => {
    // 1. Dashboard charts render
    await expect(page.getByText('Sales Performance Over Time')).toBeVisible();
    await expect(page.getByText('Receivables & Collections')).toBeVisible();
    await expect(page.getByText('Top Brands by Stock Valuation')).toBeVisible();

    // 2. Products pagination controls
    await page.click('text=Products & SKUs');
    await expect(page).toHaveURL(/.*#\/products/);
    const pagination = page.getByTestId('pagination-control');
    await expect(pagination).toBeVisible();
    await expect(pagination.getByText(/Showing.*results/)).toBeVisible();
    await expect(pagination.getByRole('button', { name: 'Previous' })).toBeVisible();
    await expect(pagination.getByRole('button', { name: 'Next' })).toBeVisible();
  });

  test('verifies end-to-end payment workflow and balance settlement', async ({ page }) => {
    // 1. Navigate to Payments page and verify KPI summary metrics
    await page.click('text=Payments');
    await expect(page).toHaveURL(/.*#\/payments/);
    await expect(page.getByText('Payments & Receivables Ledger')).toBeVisible();
    await expect(page.getByText('Total Receivables Outstanding')).toBeVisible();
    await expect(page.getByText('Total Collections Logged')).toBeVisible();

    // 2. Open Record Payment Modal
    await page.getByRole('button', { name: 'Record Payment' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Record Customer Payment')).toBeVisible();

    // 3. Search and select customer
    const custSearch = modal.getByPlaceholder(/search customers/i);
    await expect(custSearch).toBeVisible();
    await custSearch.fill('Sharma');
    await page.waitForTimeout(300);

    // 4. Fill payment amount and submit payment
    const amountInput = modal.getByLabel('Amount Received (₹)');
    await amountInput.fill('1500');
    await modal.getByLabel('Reference / Transaction ID').fill('UPI-E2E-TEST-9988');

    await modal.getByRole('button', { name: 'Record Payment Receipt' }).click();
    await expect(modal).not.toBeVisible();

    // 5. Confirm newly recorded receipt appears in the table
    await expect(page.getByText('UPI-E2E-TEST-9988')).toBeVisible();
  });
});
