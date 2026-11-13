import { expect, test } from '@playwright/test';

test('opens Purchase Orders from inventory and directs demo users to cloud sign-in', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/');
  await page.getByRole('link', { name: 'Purchase Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchase Orders', exact: true })).toBeVisible();
  await expect(page.getByText('Sign in to a cloud workspace to use Purchase Orders.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New purchase order' })).toHaveCount(0);
});
