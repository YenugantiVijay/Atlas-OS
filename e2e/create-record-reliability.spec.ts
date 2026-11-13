import { test, expect } from '@playwright/test';

test.describe('ATLAS OS — Create Record Reliability & Permission Hardening (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible({ timeout: 15000 });
  });

  /* =========================================================================
     TEST GROUP A: NAVIGATION & ENTRY POINTS
     ========================================================================= */
  test.describe('Test Group A — Navigation & Entry Points', () => {
    test('Dashboard → New Sales Order opens Create Sales Order form', async ({ page }) => {
      const btn = page.getByRole('button', { name: 'New Sales Order' });
      await expect(btn).toBeVisible();
      await btn.click();

      await expect(page).toHaveURL(/.*#\/orders/);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Create Sales Order')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Dashboard → Create Quotation opens Create Quotation form', async ({ page }) => {
      const btn = page.getByRole('button', { name: 'Create Quotation' });
      await expect(btn).toBeVisible();
      await btn.click();

      await expect(page).toHaveURL(/.*#\/quotations/);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Create Customer Quotation')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Dashboard → Add Product SKU opens Add New Product form', async ({ page }) => {
      const btn = page.getByRole('button', { name: 'Add Product SKU' });
      await expect(btn).toBeVisible();
      await btn.click();

      await expect(page).toHaveURL(/.*#\/products/);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Add New Product')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Dashboard → Record Payment opens Record Payment Receipt form', async ({ page }) => {
      const btn = page.getByRole('button', { name: 'Record Payment' });
      await expect(btn).toBeVisible();
      await btn.click();

      await expect(page).toHaveURL(/.*#\/payments/);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Record Customer Payment')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Header → Quick Create menu navigates and opens corresponding forms', async ({ page }) => {
      const quickCreateBtn = page.getByRole('button', { name: 'Quick Create' });
      await expect(quickCreateBtn).toBeVisible();
      await quickCreateBtn.click();

      // Click New Customer option
      const newCustomerOption = page.getByRole('button', { name: 'New Customer' });
      await expect(newCustomerOption).toBeVisible();
      await newCustomerOption.click();

      await expect(page).toHaveURL(/.*#\/customers/);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Add New Customer Account')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Direct URL navigation ?action=create cleanly opens forms', async ({ page }) => {
      await page.goto('/#/orders?action=create');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Create Sales Order')).toBeVisible();
    });
  });

  /* =========================================================================
     TEST GROUP B: ASYNCHRONOUS DATA LOADING & PREREQUISITES
     ========================================================================= */
  test.describe('Test Group B — Asynchronous Loading & Prerequisites', () => {
    test('Shows missing customer prerequisite modal when no customers exist for orders', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('atlas_customers_v1', JSON.stringify([]));
      });

      await page.goto('/#/orders?action=create');
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('heading', { name: 'No Customers Found' })).toBeVisible();
      await expect(
        modal.getByText('No customers found. Add a customer before creating this sales order.')
      ).toBeVisible();

      // Click "Add Customer" button in prerequisite modal
      const addCustBtn = modal.getByRole('button', { name: 'Add Customer' });
      await expect(addCustBtn).toBeVisible();
      await addCustBtn.click();

      // Navigation reaches customers and opens customer creation modal
      await expect(page).toHaveURL(/.*#\/customers/);
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('Shows missing product prerequisite modal when no products exist for orders', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('atlas_products_v1', JSON.stringify([]));
      });

      await page.goto('/#/orders?action=create');
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('heading', { name: 'No Products Found' })).toBeVisible();
      await expect(
        modal.getByText('No products found. Add a product before creating this sales order.')
      ).toBeVisible();

      const addProdBtn = modal.getByRole('button', { name: 'Add Product' });
      await expect(addProdBtn).toBeVisible();
      await addProdBtn.click();

      await expect(page).toHaveURL(/.*#\/products/);
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  });

  /* =========================================================================
     TEST GROUP C: USER PERMISSIONS & RBAC HARDENING
     ========================================================================= */
  test.describe('Test Group C — User Permissions & RBAC Hardening', () => {
    test('Viewer role has disabled creation entry points and cannot bypass via URL', async ({ page }) => {
      // Configure viewer membership in localStorage
      await page.evaluate(() => {
        const mems = JSON.parse(localStorage.getItem('atlas_memberships_v1') || '[]');
        for (const m of mems) {
          m.role = 'viewer';
        }
        localStorage.setItem('atlas_memberships_v1', JSON.stringify(mems));
      });

      await page.goto('/');

      // 1. Header Quick Create button should be hidden for viewer
      await expect(page.getByRole('button', { name: 'Quick Create' })).toHaveCount(0);

      // 2. Dashboard New Sales Order button should be disabled
      const newOrderBtn = page.getByRole('button', { name: 'New Sales Order' });
      await expect(newOrderBtn).toBeDisabled();
      await expect(newOrderBtn).toHaveAttribute('title', /does not have permission/);

      // 3. Direct URL attempt to /orders?action=create must NOT open modal
      await page.goto('/#/orders?action=create');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /Permission Denied/i }).first()).toBeVisible();
    });
  });

  /* =========================================================================
     TEST GROUP D & E: RECORD CREATION & REFRESH PERSISTENCE
     ========================================================================= */
  test.describe('Test Group D & E — Record Creation & Refresh Persistence', () => {
    test('Creates new customer, saves to storage, and persists after reload', async ({ page }) => {
      await page.goto('/#/customers');
      await page.getByRole('button', { name: 'Add Customer' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Contact Person Name').fill('Kavita Sharma');
      await dialog.getByLabel('Firm / Trade Name').fill('Kavita Switchgears Bangalore');
      await dialog.getByLabel('Phone Number').fill('+91 98450 12345');

      await dialog.getByRole('button', { name: 'Save Customer' }).click();
      await expect(dialog).not.toBeVisible();

      // Record visible in table
      await expect(page.getByText('Kavita Switchgears Bangalore', { exact: true })).toBeVisible();

      // Refresh page and confirm record persists
      await page.reload();
      await expect(page.getByText('Kavita Switchgears Bangalore', { exact: true })).toBeVisible();
    });

    test('Creates new product SKU, saves, and persists after reload', async ({ page }) => {
      await page.goto('/#/products');
      await page.getByRole('button', { name: 'Add Product' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('SKU Code').fill('TEST-SKU-999');
      await dialog.getByLabel('Product Title & Description').fill('Finolex 4.0 sq mm Flexible Cable');
      await dialog.getByLabel('Purchase Cost (₹)').fill('3200');
      await dialog.getByLabel('Selling Price (₹)').fill('3800');

      await dialog.getByRole('button', { name: 'Create Product' }).click();
      await expect(dialog).not.toBeVisible();

      await expect(page.getByText('TEST-SKU-999', { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.getByText('TEST-SKU-999', { exact: true })).toBeVisible();
    });

    test('Creates sales order with multiple items and verifies persistence', async ({ page }) => {
      await page.goto('/#/orders');
      await page.getByRole('button', { name: 'New Sales Order' }).first().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Form automatically pre-selects customer and first product line
      await dialog.getByRole('button', { name: 'Save Sales Order' }).click();
      await expect(dialog).not.toBeVisible();

      // Verified order appears in list
      await expect(page.getByText('SO-2026-0002', { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.getByText('SO-2026-0002', { exact: true })).toBeVisible();
    });

    test('Records manual stock adjustment with audit note and verifies persistence', async ({ page }) => {
      await page.goto('/#/inventory');
      await page.getByRole('button', { name: 'Adjust Stock' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByLabel('Quantity Change (+ to add, - to deduct)').fill('+25');
      await dialog.getByLabel('Reason / Audit Note').fill('Physical warehouse count reconciliation');

      await dialog.getByRole('button', { name: 'Record Adjustment' }).click();
      await expect(dialog).not.toBeVisible();

      // Adjustment appears in ledger
      await expect(page.getByText('+25 Coils')).toBeVisible();

      await page.reload();
      await expect(page.getByText('+25 Coils')).toBeVisible();
    });
  });
});
