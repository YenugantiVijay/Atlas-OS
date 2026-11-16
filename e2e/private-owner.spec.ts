import { test, expect } from '@playwright/test';

test('the private console is direct-only and demo workspaces cannot see owner controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  await expect(page.locator('a[href*="/owner"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Platform Admin' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Support', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Atlas OS Support' })).toBeVisible();
  await expect(page.getByText('Sign in to a cloud workspace to send a support report.')).toBeVisible();
  await page.goto('/owner/');
  await expect(page.getByRole('heading', { name: 'Private Console' })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('navigation', { name: 'Owner sections' })).toHaveCount(0);
});
