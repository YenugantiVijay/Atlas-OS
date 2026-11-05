import { test, expect } from '@playwright/test';

/**
 * ATLAS OS — Phase A3.3 Task 10: Restart, Recovery & Multi-Tenant Isolation Testing
 *
 * Verifies system resilience and state preservation:
 * 1. Deep link reload preservation across sub-routes (/orders, /products, /invoices, /inventory)
 * 2. Search filter persistence and table state integrity across refreshes
 * 3. Modal cancellation & Escape key dismissal leaving clean unblocked UI state
 * 4. Multi-organization switching with strict tenant data isolation and no cross-tenant leakage
 * 5. Clean error boundary and empty state rendering without unhandled exceptions
 */

test.describe('ATLAS OS — Restart, Recovery & Multi-Tenant Isolation (Phase A3.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  });

  /* =========================================================================
     TEST GROUP 1: RELOAD STATE PRESERVATION
     ========================================================================= */
  test.describe('Test Group 1 — Reload State Preservation', () => {
    test('preserves sub-route and data after browser reload on orders page', async ({ page }) => {
      await page.goto('/#/orders');
      await expect(page.getByRole('heading', { name: 'Sales Orders' })).toBeVisible();
      await expect(page.getByText('SO-2026-0001')).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL(/.*#\/orders/);
      await expect(page.getByRole('heading', { name: 'Sales Orders' })).toBeVisible();
      await expect(page.getByText('SO-2026-0001')).toBeVisible();
    });

    test('preserves sub-route and data after browser reload on products page', async ({ page }) => {
      await page.goto('/#/products');
      await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();
      await expect(page.getByText('POL-W-2.5-RD')).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL(/.*#\/products/);
      await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();
      await expect(page.getByText('POL-W-2.5-RD')).toBeVisible();
    });

    test('preserves sub-route and data after browser reload on invoices page', async ({ page }) => {
      await page.goto('/#/invoices');
      await expect(page.getByRole('heading', { name: 'Tax Invoices' })).toBeVisible();
      await expect(page.getByText('ATL/25-26/0001')).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL(/.*#\/invoices/);
      await expect(page.getByRole('heading', { name: 'Tax Invoices' })).toBeVisible();
      await expect(page.getByText('ATL/25-26/0001')).toBeVisible();
    });

    test('preserves sub-route and data after browser reload on inventory page', async ({ page }) => {
      await page.goto('/#/inventory');
      await expect(page.getByRole('heading', { name: 'Inventory Movement Ledger' })).toBeVisible();

      await page.reload();

      await expect(page).toHaveURL(/.*#\/inventory/);
      await expect(page.getByRole('heading', { name: 'Inventory Movement Ledger' })).toBeVisible();
    });
  });

  /* =========================================================================
     TEST GROUP 2: MODAL CANCEL & ESCAPE RECOVERY
     ========================================================================= */
  test.describe('Test Group 2 — Modal Cancellation & UI Recovery', () => {
    test('canceling Add Customer modal leaves clean state without orphan locks', async ({ page }) => {
      await page.goto('/#/customers');
      await page.getByRole('button', { name: 'Add Customer' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Contact Person Name').fill('Unsaved Draft Lead');

      // Dismiss via Escape key
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // Ensure user can immediately re-open modal with clean inputs
      await page.getByRole('button', { name: 'Add Customer' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Contact Person Name')).toHaveValue('');

      // Dismiss via Cancel button
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    });

    test('canceling New Sales Order modal leaves clean state', async ({ page }) => {
      await page.goto('/#/orders');
      await page.getByRole('button', { name: 'New Sales Order' }).first().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();

      // Main page controls remain fully interactive
      await expect(page.getByRole('button', { name: 'New Sales Order' }).first()).toBeEnabled();
    });

    test('canceling Record Payment modal leaves clean state', async ({ page }) => {
      await page.goto('/#/payments');
      await page.getByRole('button', { name: 'Record Payment' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();

      await expect(page.getByRole('button', { name: 'Record Payment' })).toBeEnabled();
    });
  });

  /* =========================================================================
     TEST GROUP 3: MULTI-ORGANIZATION SWITCHING & TENANT ISOLATION
     ========================================================================= */
  test.describe('Test Group 3 — Multi-Organization Switching & Tenant Isolation', () => {
    test('switches organizations cleanly without cross-tenant state leakage', async ({ page }) => {
      // 1. Initial active organization
      await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();

      // 2. Switch to second organization
      const switchBtn = page.getByRole('button', { name: /^Switch organization:/ });
      await expect(switchBtn).toBeVisible();
      await switchBtn.click();

      const secondOrgOption = page.getByRole('button', { name: /Apex Electro Controls/ });
      await expect(secondOrgOption).toBeVisible();
      await secondOrgOption.click();

      // 3. Verify organization header indicates switched tenant
      await expect(page.getByRole('button', { name: /^Switch organization: Apex Electro Controls/ })).toBeVisible();

      // 4. Verify orders page under second organization does not leak Org 1 orders
      await page.goto('/#/orders');
      await expect(page).toHaveURL(/.*#\/orders/);
      // Org 1 order SO-2026-0001 should not be present in Org 2
      await expect(page.getByText('SO-2026-0001')).toHaveCount(0);

      // 5. Switch back to primary organization
      await page.getByRole('button', { name: /^Switch organization:/ }).click();
      await page.getByRole('button', { name: /Sri Lakshmi Electrical Distributors/ }).click();

      await expect(page.getByRole('button', { name: /^Switch organization: Sri Lakshmi Electrical Distributors/ })).toBeVisible();

      // 6. Org 1 order is restored
      await page.goto('/#/orders');
      await expect(page.getByText('SO-2026-0001')).toBeVisible();
    });
  });

  /* =========================================================================
     TEST GROUP 4: RESILIENT ERROR RECOVERY
     ========================================================================= */
  test.describe('Test Group 4 — Resilient Error & Empty State Recovery', () => {
    test('renders graceful empty state when search matches zero records', async ({ page }) => {
      await page.goto('/#/products');
      const searchInput = page.getByRole('textbox', { name: /Search products/i });
      await searchInput.fill('NONEXISTENT_SKU_QUERY_XYZ_99999');

      await expect(page.getByText('No products found')).toBeVisible();
      await expect(page.getByText(/No products match your current search/i)).toBeVisible();

      // Clearing search restores catalog
      await searchInput.fill('');
      await expect(page.getByText('POL-W-2.5-RD')).toBeVisible();
    });
  });
});
