import { test, expect, type Page } from '@playwright/test';

/**
 * ATLAS OS — disposable Demo Mode industrial entry audit.
 * This does NOT use production Supabase, a merchant's books, or real bank payments.
 * Coverage: 100 products entered through the form + 100 audited inventory adjustments
 * entered through the form. Existing SQL Scenario C separately covers the DB scale.
 */
test.describe('Industrial entry audit: 200 UI transactions (Demo Mode only)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  });

  test('creates 100 unique product SKUs and opening-stock entries via the UI', async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto('/#/products');
    await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();

    const durations: number[] = [];
    const count = 100;
    for (let i = 1; i <= count; i++) {
      const start = Date.now();
      const suffix = String(i).padStart(3, '0');
      const addBtn = page.getByRole('button', { name: 'Add Product', exact: true });
      await expect(addBtn).toBeEnabled();
      await addBtn.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('SKU Code').fill('QA-LOAD-P-' + suffix);
      await dialog.getByLabel('Product Title & Description').fill('QA Test Electrical Component ' + suffix);
      await dialog.getByLabel('Purchase Cost (₹)').fill(String(100 + i));
      await dialog.getByLabel('Selling Price (₹)').fill(String(150 + i));
      await dialog.getByLabel('GST Tax Rate (%)').fill('18');
      await dialog.getByLabel('Opening Stock').fill(String(5 + (i % 9)));
      await dialog.getByRole('button', { name: 'Create Product' }).click();
      await expect(dialog).toBeHidden();

      durations.push(Date.now() - start);
      if (i % 25 === 0) console.log('[industrial-qa] product UI entries completed:', i);
    }

    const audit = await page.evaluate(() => {
      const products = JSON.parse(localStorage.getItem('atlas_products_v1') || '[]') as Array<{ id: string; sku: string }>;
      const movements = JSON.parse(localStorage.getItem('atlas_stock_movements_v1') || '[]') as Array<{ productId: string; movementType: string; quantityChange: number }>;
      const qa = products.filter((p) => p.sku.startsWith('QA-LOAD-P-'));
      const ids = new Set(qa.map((p) => p.id));
      const opening = movements.filter((m) => ids.has(m.productId) && m.movementType === 'OPENING_STOCK');
      return {
        productCount: qa.length,
        uniqueSkus: new Set(qa.map((p) => p.sku)).size,
        openingMovementCount: opening.length,
        openingUnits: opening.reduce((sum, m) => sum + Number(m.quantityChange), 0),
      };
    });

    let expectedUnits = 0;
    for (let i = 1; i <= count; i++) expectedUnits += 5 + (i % 9);
    expect(audit.productCount).toBe(count);
    expect(audit.uniqueSkus).toBe(count);
    expect(audit.openingMovementCount).toBe(count);
    expect(audit.openingUnits).toBe(expectedUnits);
    expect(pageErrors).toEqual([]);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();
    const persisted = await page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('atlas_products_v1') || '[]') as Array<{ sku: string }>;
      return rows.filter((p) => p.sku.startsWith('QA-LOAD-P-')).length;
    });
    expect(persisted).toBe(count);

    durations.sort((a, b) => a - b);
    console.log('[industrial-qa] PRODUCT_FORM_ENTRY_METRICS ' + JSON.stringify({
      entries: count,
      medianMs: durations[Math.floor(durations.length / 2)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      maxMs: durations[durations.length - 1],
      totalMs: durations.reduce((a, b) => a + b, 0),
      openingUnits: audit.openingUnits,
    }));
  });

  test('records 100 audited stock adjustments via the UI and persists them on refresh', async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto('/#/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory Movement Ledger' })).toBeVisible();

    const durations: number[] = [];
    const count = 100;
    let productId = '';
    for (let i = 1; i <= count; i++) {
      const start = Date.now();
      const btn = page.getByRole('button', { name: 'Adjust Stock', exact: true });
      await expect(btn).toBeEnabled();
      await btn.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const selection = dialog.getByLabel('Select Product');
      if (!productId) {
        productId = (await selection.locator('option').first().getAttribute('value')) || '';
        expect(productId).not.toBe('');
      }
      await selection.selectOption(productId);
      await dialog.getByLabel('Quantity Change (+ to add, - to deduct)').fill('1');
      await dialog.getByLabel('Reason / Audit Note').fill('QA-STOCK-LOAD-' + String(i).padStart(3, '0'));
      await dialog.getByRole('button', { name: 'Record Adjustment' }).click();
      await expect(dialog).toBeHidden();
      durations.push(Date.now() - start);
      if (i % 25 === 0) console.log('[industrial-qa] stock adjustment UI entries completed:', i);
    }

    const audit = await page.evaluate((selectedProductId) => {
      const rows = JSON.parse(localStorage.getItem('atlas_stock_movements_v1') || '[]') as Array<{ productId: string; movementType: string; quantityChange: number; notes?: string }>;
      const qa = rows.filter((m) => m.notes?.startsWith('QA-STOCK-LOAD-'));
      return {
        qaMovements: qa.length,
        uniqueAuditNotes: new Set(qa.map((m) => m.notes)).size,
        unitsAdded: qa.reduce((sum, m) => sum + Number(m.quantityChange), 0),
        correctProduct: qa.every((m) => m.productId === selectedProductId),
        correctType: qa.every((m) => m.movementType === 'ADJUSTMENT'),
      };
    }, productId);

    expect(audit.qaMovements).toBe(count);
    expect(audit.uniqueAuditNotes).toBe(count);
    expect(audit.unitsAdded).toBe(count);
    expect(audit.correctProduct).toBe(true);
    expect(audit.correctType).toBe(true);
    expect(pageErrors).toEqual([]);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inventory Movement Ledger' })).toBeVisible();
    const persisted = await page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('atlas_stock_movements_v1') || '[]') as Array<{ notes?: string }>;
      return rows.filter((m) => m.notes?.startsWith('QA-STOCK-LOAD-')).length;
    });
    expect(persisted).toBe(count);

    durations.sort((a, b) => a - b);
    console.log('[industrial-qa] STOCK_ADJUSTMENT_METRICS ' + JSON.stringify({
      entries: count,
      medianMs: durations[Math.floor(durations.length / 2)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      maxMs: durations[durations.length - 1],
      totalMs: durations.reduce((a, b) => a + b, 0),
      unitsAdded: audit.unitsAdded,
    }));
  });
});
