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

test('a manager opens two stall forms and saves each closing amount separately on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?tool=ice-cream-stalls#/ice-cream-counter');
  await expect(page.getByRole('button', { name: 'Record waste', exact: true })).toHaveCount(0);
  const cash = page.getByRole('region', { name: 'Daily stall cash' });
  const form = cash.getByRole('form', { name: 'Stall cash form' });

  const saveOpening = form.getByRole('button', { name: 'Save opening cash' });
  const saveClosing = form.getByRole('button', { name: 'Save closing cash' });
  const closingCash = form.getByLabel('Closing cash (₹)');
  await expect(saveOpening).toBeDisabled();
  await expect(closingCash).toBeDisabled();
  await form.getByLabel('Stall name or location').fill('Market stall');
  await form.getByLabel('Stall maintainer').fill('   ');
  await form.getByLabel('Opening cash (₹)').fill('500');
  await expect(saveOpening).toBeDisabled();
  await form.getByLabel('Stall maintainer').fill('Lakshmi Rao');
  await expect(saveOpening).toBeEnabled();
  await expect(closingCash).toBeDisabled();
  await saveOpening.click();
  const market = cash.getByRole('button', { name: /Market stall.*Lakshmi Rao/i });
  await expect(market).toContainText('Closing cash pending');
  await expect(form.getByLabel('Stall maintainer')).toHaveValue('Lakshmi Rao');
  await expect(closingCash).toBeEnabled();
  await expect(closingCash).toHaveValue('');
  await expect(saveClosing).toBeDisabled();
  await form.getByRole('button', { name: 'Hide form' }).click();
  await expect(form).toBeHidden();
  await cash.getByRole('button', { name: 'Add stall' }).click();
  await form.getByLabel('Stall name or location').fill('Park gate');
  await form.getByLabel('Stall maintainer').fill('Ravi Kumar');
  await form.getByLabel('Opening cash (₹)').fill('0');
  await form.getByRole('button', { name: 'Save opening cash' }).click();
  const park = cash.getByRole('button', { name: /Park gate.*Ravi Kumar/i });
  await expect(park).toContainText('Closing cash pending');

  await page.reload();
  await market.click();
  await expect(form.getByLabel('Opening cash (₹)')).toHaveValue('500');
  await expect(form.getByLabel('Closing cash (₹)')).toHaveValue('');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
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
  await page.getByLabel('Graph unit').selectOption('scoop');
  const chart = page.getByRole('region', { name: 'Stock received and sold over 7 days' });
  await expect(chart.locator('[aria-label="Received: 20"]')).toHaveCount(1);
  await expect(chart.locator('[aria-label="Sold: 3"]')).toHaveCount(1);
  await expect(form.getByText(/Expected cash ₹590\.00/)).toBeVisible();

  await closingCash.fill('-1');
  await expect(saveClosing).toBeDisabled();
  await closingCash.fill('585');
  await expect(saveClosing).toBeEnabled();
  await saveClosing.click();
  await expect(market).toContainText('Closed');
  await expect(park).toContainText('Closing cash pending');

  await park.click();
  await expect(form.getByLabel('Stall maintainer')).toHaveValue('Ravi Kumar');
  await expect(form.getByLabel('Closing cash (₹)')).toHaveValue('');
  await expect(saveClosing).toBeDisabled();
  await closingCash.fill('0');
  await expect(saveClosing).toBeEnabled();
  await saveClosing.click();
  await expect(park).toContainText('Closed');

  await page.reload();
  await market.click();
  await expect(form.getByLabel('Closing cash (₹)')).toHaveValue('585');
  await expect(form.getByText('Difference -₹5.00', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save closing cash' })).toHaveCount(0);
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
