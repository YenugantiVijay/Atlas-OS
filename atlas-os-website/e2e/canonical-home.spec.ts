import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
let server: http.Server;

// Serve only generated Astro output: no duplicate source-root index.html.
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const relative = requested.replace(/^\/+/, '');
    let file = path.resolve(dist, relative);
    if (file !== dist && !file.startsWith(dist + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(4321, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('homepage is the original Astro experience, not the temporary HTML replica', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Atlas OS/);
  await expect(page.getByRole('heading', {
    level: 1, name: /Run Your Business.*Without the Complications/i,
  })).toBeVisible();
  await expect(page.locator('.capability-orbit')).toBeVisible();
  await expect(page.locator('.capability-orbit .orbit-chip')).toHaveCount(6);
  await expect(page.getByText('Connected Business Workflow', { exact: true })).toBeVisible();
  await expect(page.getByText('Atlas OS Desktop Edition Preview', { exact: true })).toBeVisible();
  await expect(page.locator('astro-island')).not.toHaveCount(0);
  await expect(page.getByText('Website Preview', { exact: true })).toHaveCount(0);
});

test('interactive product preview really hydrates and changes content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Recognized Sales (FY)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Commercial Invoicing' }).click();
  await expect(page.getByText('Statutory Tax Invoice Details', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Multi-UOM Inventory' }).click();
  await expect(page.getByText('Polycab 2.5mm Wire (Red 90m)')).toBeVisible();
});

test('homepage CTAs navigate to the actual Astro pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Explore Atlas OS/ }).first().click();
  await expect(page).toHaveURL(/\/product\/?$/);
  await expect(page.getByRole('heading', {
    level: 1, name: /Business Software Re-engineered/i,
  })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /Request a Demo/ }).first().click();
  await expect(page).toHaveURL(/\/request-demo\/?$/);
  await expect(page).toHaveTitle(/Request a Personalized Live Demo/i);
});

test('responsive mobile keeps the real navigation and orbit layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open Navigation Menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mobile-nav-menu')).toBeVisible();
  await expect(page.locator('.capability-orbit')).toBeVisible();
  const pageWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.viewport + 1);
});
