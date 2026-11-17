import { expect, test } from '@playwright/test';
import { INDUSTRY_TOOLS } from '../src/lib/industry-tools';

test('each industry link opens its own dashboard and keeps specialised modules in the correct tool', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  for (const [id, tool] of Object.entries(INDUSTRY_TOOLS)) {
    await page.goto('/?tool=' + id + '#/');
    await expect(page.getByRole('heading', { name: tool.headline })).toBeVisible();
    const workflows = page.getByRole('region', { name: id === 'small-business' ? 'Shop essentials' : 'Daily workflows' });
    for (const task of tool.tasks) await expect(workflows.getByRole('button', { name: new RegExp('^' + task.label, 'i') })).toBeVisible();
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByRole('link', { name: 'Counter Shift' })).toHaveCount(id === 'retail-wholesale' ? 1 : 0);
    await expect(sidebar.getByRole('link', { name: 'E-commerce Orders' })).toHaveCount(id === 'ecommerce' ? 1 : 0);
  }
  await page.goto('/?tool=ecommerce#/pos');
  await expect(page.getByRole('heading', { name: INDUSTRY_TOOLS.ecommerce.headline })).toBeVisible();
  await page.getByRole('button', { name: 'New Online Order', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create Online Order' })).toBeVisible();
  await page.goto('/?tool=retail-wholesale#/ecommerce');
  await expect(page.getByRole('heading', { name: INDUSTRY_TOOLS['retail-wholesale'].headline })).toBeVisible();
  await page.getByRole('button', { name: 'Open Retail Counter', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Retail Counter', exact: true })).toBeVisible();
});
