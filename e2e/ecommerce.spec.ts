import { expect, test } from './workspace-fixture';

test('online order references, dispatch and workspace filtering use the normal sales workflow', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/#/ecommerce');
  await expect(page.getByRole('heading', { name: 'E-commerce Orders' })).toBeVisible();
  const addOrder = async (reference: string) => {
    await page.getByRole('button', { name: 'New Online Order' }).click();
    const form = page.getByRole('dialog', { name: 'Create Online Order' });
    await form.getByLabel('Sales channel').selectOption('marketplace');
    await form.getByLabel('External order reference').fill(reference);
    await form.getByRole('button', { name: 'Save Online Order' }).click();
  };
  await addOrder('WEB-DEMO-1042');
  const row = page.getByRole('row').filter({ hasText: 'WEB-DEMO-1042' });
  await expect(row).toBeVisible();
  await addOrder('web-demo-1042');
  await expect(page.getByText('An order with this sales channel and reference already exists.')).toBeVisible();
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: /confirm/i }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confirm Order & Deduct Inventory' });
  await confirmation.getByRole('button', { name: /confirm/i }).click();
  await expect(row).toContainText('CONFIRMED');
  await row.getByRole('button', { name: /view/i }).click();
  const detail = page.getByRole('dialog', { name: /^Sales Order/ });
  await detail.getByLabel('Carrier').fill('Sample courier');
  await detail.getByLabel('Tracking reference').fill('AWB-DEMO-001');
  await detail.getByRole('button', { name: 'Save dispatch' }).click();
  await expect(detail.getByText(/Dispatch recorded.*AWB-DEMO-001/i)).toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: 'Search sales orders' }).fill('WEB-DEMO-1042');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /view/i }).click();
  await expect(detail.getByText(/Dispatch recorded.*AWB-DEMO-001/i)).toBeVisible();
});
