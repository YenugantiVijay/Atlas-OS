import { expect, test } from '@playwright/test';
import { INDUSTRY_TOOLS, isSpecialtyToolId } from '../src/lib/industry-tools';

test('each industry link opens its own dashboard and keeps specialised modules in the correct tool', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  for (const [id, tool] of Object.entries(INDUSTRY_TOOLS)) {
    await page.goto('/?tool=' + id + '#/');
    await expect(page.getByRole('heading', { name: tool.headline })).toBeVisible();
    if (isSpecialtyToolId(id)) {
      await expect(page.getByRole('region', {name: /open print jobs by due date|stock received and sold|committed and dispatched/i})).toBeVisible();
    } else {
      const workflows = page.getByRole('region', { name: id === 'small-business' ? 'Shop essentials' : 'Daily workflows' });
      for (const task of tool.tasks) await expect(workflows.getByRole('button', { name: new RegExp('^' + task.label, 'i') })).toBeVisible();
    }
    const sidebar = page.getByRole('complementary');
    if (id === 'ice-cream-stalls' || id === 'ice-cream-distribution')
      await expect(sidebar.getByRole('link', { name: 'Customers', exact: true })).toHaveCount(id === 'ice-cream-stalls' ? 0 : 1);
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

test('the electrical workspace fits a phone and closes navigation after a link is selected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/?tool=electrical#/');

  const heading = page.getByRole('heading', { name: INDUSTRY_TOOLS.electrical.headline });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Quotation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ATLAS AI', exact: true })).toBeVisible();
  expect(await heading.evaluate((element) => {
    const banner = element.closest('header');
    const width = banner?.getBoundingClientRect().width ?? 0;
    return width > 0 && width <= document.documentElement.clientWidth;
  })).toBe(true);

  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  const openMenu = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(navigation).toBeHidden();
  await openMenu.click();
  await expect(navigation.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('link', { name: 'Quotations', exact: true }).click();
  await expect(page).toHaveURL(/#\/quotations$/);
  await expect(navigation).toBeHidden();
});
