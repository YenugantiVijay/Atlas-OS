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
    level: 1, name: /Manage stock, sales, and payments together/i,
  })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /Request a Demo/ }).first().click();
  await expect(page).toHaveURL(/\/request-demo\/?$/);
  await expect(page).toHaveTitle(/Request a Personalized Live Demo/i);
});

test('header buttons and footer establish a readable hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const ctas = page.locator('#site-header .site-header-cta:visible');
  await expect(ctas).toHaveCount(2);
  for (const cta of await ctas.all()) {
    const style = await cta.evaluate((element) => {
      const { paddingInlineStart, paddingInlineEnd, gap } = getComputedStyle(element);
      return { paddingInlineStart, paddingInlineEnd, gap, height: element.getBoundingClientRect().height };
    });
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.paddingInlineStart).toBe(style.paddingInlineEnd);
    expect(parseFloat(style.paddingInlineStart)).toBeGreaterThanOrEqual(16);
    expect(parseFloat(style.gap)).toBeGreaterThanOrEqual(8);
  }
  const footer = page.locator('footer');
  const headingSize = await footer.locator('.footer-heading').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  const linkSize = await footer.locator('.footer-link').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(headingSize).toBeGreaterThan(linkSize);
  const headingRows = await footer.locator('.footer-heading').evaluateAll((elements) => elements.map((heading) => heading.getBoundingClientRect().top));
  expect(new Set(headingRows).size).toBe(1);
});

test('the home introduction and scroll motion respect reduced motion', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  const workflow = page.getByText('Connected Business Workflow', { exact: true }).locator('..');
  await expect(heading).toHaveCSS('animation-name', 'atlas-enter');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
  await expect(workflow).toHaveClass(/atlas-pending/);
  await page.mouse.move(700, 350);
  await page.mouse.wheel(0, 360);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await workflow.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(workflow).toHaveClass(/atlas-revealed/);
  await expect(workflow).toHaveCSS('animation-name', 'atlas-scroll-reveal');
  await expect(workflow).toHaveCSS('opacity', '1');
  const progress = page.locator('.atlas-scroll-progress');
  if (await page.evaluate(() => CSS.supports('animation-timeline', 'scroll(root block)'))) {
    await expect.poll(() => progress.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeGreaterThan(0);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(workflow).toHaveClass(/atlas-revealed/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(heading).toHaveCSS('animation-name', 'none');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  await expect(progress).toBeHidden();
  await expect(workflow).toHaveCSS('opacity', '1');
  await expect(workflow).not.toHaveClass(/atlas-revealed/);
});

test('mobile cards reveal as they enter the screen and anchors clear the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.getByRole('heading', { name: 'Understand Your Business' }).locator('..').locator('..');
  await expect(card).toHaveClass(/atlas-pending/);
  await card.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(card).toHaveClass(/atlas-revealed/);
  await expect(card).toHaveCSS('--atlas-reveal-distance', '12px');
  await expect(card).toHaveCSS('opacity', '1');

  await page.goto('/solutions#agricultural-inputs');
  await expect.poll(() => page.locator('#agricultural-inputs').evaluate((target) => {
    const offset = target.getBoundingClientRect().top - document.getElementById('site-header')!.getBoundingClientRect().bottom;
    return offset >= 0 && offset <= 32;
  })).toBe(true);
});

test('receipt template preview updates branding, layout and copies on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/receipt-templates');
  const customer = page.getByRole('article', { name: 'Customer copy' });
  await expect(customer.locator('img')).toHaveAttribute('src', '/favicon.svg');
  await page.getByLabel('Layout').selectOption('compact');
  await page.getByLabel('Business name').fill('Vijay Farm Supplies');
  await page.getByLabel('Receipt message').fill('Thanks for shopping with us.');
  await page.getByLabel('Upload your logo').setInputFiles({
    name: 'sample.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZEAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(customer.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await page.getByRole('checkbox', { name: /preview customer and counter copies/i }).check();
  await expect(customer).toHaveClass(/atlas-receipt--compact/);
  const counter = page.getByRole('article', { name: 'Counter copy' });
  await expect(counter).toContainText('Vijay Farm Supplies');
  await expect(counter).toContainText('Thanks for shopping with us.');
  await page.getByRole('button', { name: 'Use default logo' }).click();
  await expect(counter.locator('img')).toHaveAttribute('src', '/favicon.svg');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('pricing plans and industry links lead to the right workflows', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByText('₹999', { exact: true })).toBeVisible();
  await expect(page.getByText('₹2,499', { exact: true })).toBeVisible();
  await expect(page.getByText('Custom quote', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Discuss Professional' }).click();
  await expect(page.getByRole('form', { name: 'Request a demo' })).toContainText('Discuss Atlas Professional');
  await page.locator('footer').getByRole('link', { name: 'Fertilizers & Agri Inputs' }).click();
  await expect(page).toHaveURL(/\/solutions#agricultural-inputs$/);
  await expect(page.getByRole('heading', { name: 'Fertilizer & Agri-Input Dealers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Small Shops & General Trade' })).toBeVisible();
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
