import {openNavigationGroup} from './navigation';
import { expect, test } from './workspace-fixture';

test('opens Purchase Orders from inventory and offers browser-local demo orders', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/');
  await openNavigationGroup(page,'Inventory');
  await page.getByRole('link', { name: 'Purchase Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchase Orders', exact: true })).toBeVisible();
  await expect(page.getByText('Demo Mode: Purchase orders are saved in this browser.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New purchase order' })).toBeEnabled();
});
