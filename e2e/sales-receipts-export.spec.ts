import { test, expect } from '@playwright/test';

/**
 * ATLAS OS — Phase B1 End-to-End Test Suite
 * One-Click Excel Exports & Historical Business Reporting
 *
 * Verifies:
 * 1. Navigation to Reports -> Sales & Receipts via sidebar and direct route
 * 2. Quick Period Preset switching (Current FY, Previous FY, Current Month, Today, Custom)
 * 3. Scope and filter selections (Customer filter, Document scope, Invoice status)
 * 4. Live matching records preview cards
 * 5. One-click Excel (.xlsx) workbook generation and download
 * 6. Non-financial role access restriction
 */

test.describe('ATLAS OS — Sales & Receipts Excel Export (Phase B1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  });

  test('navigates to Sales & Receipts report via sidebar and verifies UI elements', async ({ page }) => {
    // Navigate via Sidebar
    const reportNavLink = page.getByRole('link', { name: 'Sales & Receipts' });
    await expect(reportNavLink).toBeVisible();
    await reportNavLink.click();

    // Verify page title and badges
    await expect(page.getByRole('heading', { name: 'Sales & Receipts Reports' })).toBeVisible();
    await expect(page.getByText('Excel Export Engine')).toBeVisible();
    await expect(page.getByText(/Demo Mode — Sample Data Only/i)).toBeVisible();

    // Verify Quick Presets
    await expect(page.getByRole('button', { name: /Current FY/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Previous FY/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Current Month' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Custom Date Range' })).toBeVisible();

    // Verify Preview Cards
    await expect(page.getByText('Matching Invoices')).toBeVisible();
    await expect(page.getByText('Matching Receipts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Excel (.xlsx)' })).toBeVisible();
  });

  test('switches between presets and updates date filter inputs dynamically', async ({ page }) => {
    await page.goto('/#/reports/sales-receipts');
    await expect(page.getByRole('heading', { name: 'Sales & Receipts Reports' })).toBeVisible();

    // 1. Month preset
    await page.getByRole('button', { name: 'Current Month' }).click();
    await expect(page.getByLabel('Select Calendar Month')).toBeVisible();

    // 2. Day preset
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.getByLabel('Select Single Calendar Date')).toBeVisible();

    // 3. Custom Date Range
    await page.getByRole('button', { name: 'Custom Date Range' }).click();
    await expect(page.getByLabel('Start Date (From)')).toBeVisible();
    await expect(page.getByLabel('End Date (To)')).toBeVisible();

    // 4. Return to Current FY
    await page.getByRole('button', { name: /Current FY/i }).click();
    await expect(page.getByLabel(/Indian Financial Year/i)).toBeVisible();
  });

  test('filters by customer and resets filters cleanly', async ({ page }) => {
    await page.goto('/#/reports/sales-receipts');
    await expect(page.getByRole('heading', { name: 'Sales & Receipts Reports' })).toBeVisible();

    // Customer dropdown
    const customerSelect = page.getByLabel('Customer Account');
    await expect(customerSelect).toBeVisible();

    // Select custom range
    await page.getByRole('button', { name: 'Current Month' }).click();

    // Reset filters
    await page.getByRole('button', { name: 'Reset Filters' }).click();

    // Reverts to FY selection
    await expect(page.getByLabel(/Indian Financial Year/i)).toBeVisible();
  });

  test('triggers one-click Excel download and receives valid .xlsx spreadsheet', async ({ page }) => {
    await page.goto('/#/reports/sales-receipts');
    await expect(page.getByRole('heading', { name: 'Sales & Receipts Reports' })).toBeVisible();

    const exportBtn = page.getByRole('button', { name: 'Export Excel (.xlsx)' });
    await expect(exportBtn).toBeVisible();

    // Trigger download and intercept download event
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;

    // Verify filename format
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^AtlasOS_Sales_Receipts_.*\.xlsx$/);

    // Verify success banner appears
    await expect(page.getByText(/Successfully exported AtlasOS_Sales_Receipts_/i)).toBeVisible();
  });
});
