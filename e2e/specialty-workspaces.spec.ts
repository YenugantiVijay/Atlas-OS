import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
});

test('studio records mixed-unit work and updates its due-date chart', async ({ page }) => {
  await page.goto('/?tool=banner-print-studio#/studio-jobs');
  await page.getByLabel('Job name').fill('Store opening');
  await page.getByLabel('Customer', { exact: true }).fill('Corner shop');
  await page.getByLabel('Quote item 1', { exact: true }).fill('Flex banner');
  await page.getByLabel('Unit', { exact: true }).selectOption('sq ft');
  await page.getByLabel('Quantity', { exact: true }).fill('12.5');
  await page.getByLabel('Rate (₹)').fill('20');
  await page.getByRole('button', { name: 'Add quote item' }).click();
  await page.getByLabel('Quote item 2', { exact: true }).fill('Sign boards');
  await page.getByLabel('Quantity', { exact: true }).nth(1).fill('2');
  await page.getByLabel('Rate (₹)').nth(1).fill('150');
  await page.getByRole('button', { name: 'Save print job' }).click();
  const board = page.getByRole('region', { name: 'Print job board' });
  await expect(board).toContainText('₹550');
  const chart = page.getByRole('region', { name: 'Open print jobs by due date' });
  await expect(chart.locator('[aria-label="Open jobs: 1"]')).toHaveCount(1);
  await board.getByRole('button', { name: 'Record artwork version' }).click();
  await page.getByLabel('Artwork file name or reference').fill('Banner proof v2');
  await page.getByRole('button', { name: 'Save artwork version' }).click();
  await board.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('200');
  await page.getByRole('button', { name: 'Save payment', exact: true }).click();
  await expect(board).toContainText('Balance ₹350');
  for (const name of ['Approve proof', 'Start printing', 'Mark ready', 'Mark delivered'])
    await board.getByRole('button', { name }).click();
  await expect(chart.locator('[aria-label="Open jobs: 1"]')).toHaveCount(0);
  await page.reload();
  await expect(board).toContainText('delivered');
});

test('stall records a scoop sale, waste and counted cash on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?tool=ice-cream-stalls#/ice-cream-counter');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await page.getByLabel('Stall', { exact: true }).fill('Market stall');
  await page.getByLabel('Product SKU or flavor').fill('Vanilla');
  await page.getByLabel('Stock unit').selectOption('scoop');
  await page.getByLabel('Quantity', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save receipt' }).click();
  await expect(page.getByText('20 scoop', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await page.getByRole('button', { name: /VANILLA · 20 scoop/ }).click();
  await page.getByLabel('Serve in').selectOption('Cone');
  await page.getByLabel('Quantity', { exact: true }).fill('3');
  await page.getByLabel('Amount collected (₹)').fill('90');
  await page.getByRole('button', { name: 'Save sale' }).click();
  await page.getByRole('button', { name: 'Record waste', exact: true }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save waste' }).click();
  await page.getByLabel('Graph unit').selectOption('scoop');
  const chart = page.getByRole('region', { name: 'Sold and wasted over 7 days' });
  await expect(chart.locator('[aria-label="Sold: 3"]')).toHaveCount(1);
  await expect(chart.locator('[aria-label="Waste: 1"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close stall', exact: true }).click();
  await page.getByLabel('Counted cash takings (₹)').fill('85');
  await page.getByRole('button', { name: 'Save close' }).click();
  await expect(page.getByText(/Closed · Counted ₹85.*Difference/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('distribution handles a partial dispatch of a bulk case commitment', async ({ page }) => {
  await page.goto('/?tool=ice-cream-distribution#/cold-chain');
  await page.getByLabel('Freezer or depot').fill('Freezer A');
  await page.getByLabel('Product SKU or flavor').fill('VAN-24');
  await page.getByLabel('Factory batch').fill('LOT-1');
  await page.getByLabel('Cases', { exact: true }).fill('5000');
  await page.getByLabel('Batch expiry').fill('2099-12-31');
  await page.getByRole('button', { name: 'Save receipt' }).click();
  await expect(page.getByText(/5,000 case/)).toBeVisible();
  await page.getByRole('button', { name: 'Commit cases', exact: true }).click();
  await page.getByLabel('Cases', { exact: true }).fill('3200');
  await page.getByLabel('Customer order reference').fill('OUTLET-10');
  await page.getByLabel('Customer or outlet').fill('City outlet');
  await page.getByRole('button', { name: 'Save commitment' }).click();
  await expect(page.getByText(/0 of 3200 dispatched/)).toBeVisible();
  await page.getByRole('button', { name: 'Dispatch cases', exact: true }).click();
  await page.getByLabel('Factory batch').fill('LOT-1');
  await page.getByLabel('Cases', { exact: true }).fill('2200');
  await page.getByLabel('Customer order reference').fill('OUTLET-10');
  await page.getByRole('button', { name: 'Save dispatch' }).click();
  await expect(page.getByText(/2200 of 3200 dispatched · 1000 open/)).toBeVisible();
  const chart = page.getByRole('region', { name: 'Committed and dispatched cases over 7 days' });
  await expect(chart.locator('[aria-label="Committed: 3200"]')).toHaveCount(1);
  await expect(chart.locator('[aria-label="Dispatched: 2200"]')).toHaveCount(1);
});
