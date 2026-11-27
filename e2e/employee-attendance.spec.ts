import { test, expect } from './workspace-fixture';

test('employee attendance is reachable and never fabricates cloud punches in demo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('atlas_auth_mode_v2', 'demo'));
  await page.goto('/');
  await page.getByRole('link', { name: 'Employee Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Employee Attendance' })).toBeVisible();
  await expect(page.getByText('Sign in to a cloud workspace to use employee attendance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Employee Attendance' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
