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
    level: 1, name: /See Supplier Rate Changes.*Review Quotes Before You Send/i,
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    level: 2, name: /supplier rate change/i,
  })).toBeVisible();
  await expect(page.getByText('Quotes are not silently repriced.', { exact: false })).toBeVisible();
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

test('Industries opens on desktop hover and stays open while moving to its links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Industries' });
  const panel = page.locator('#industries-panel');
  await expect(panel).toBeHidden();
  await toggle.hover();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const browse = panel.getByRole('link', { name: 'Feature directory' });
  const trigger = (await toggle.boundingBox())!;
  const link = (await browse.boundingBox())!;
  const x = trigger.x + trigger.width / 2;
  const y = link.y + link.height / 2;
  await page.mouse.move(x, y, { steps: 20 });
  await page.mouse.move(link.x + link.width / 2, y, { steps: 20 });
  await expect(browse).toBeVisible();
  await page.mouse.move(4, 620);
  await expect(panel).toBeHidden();
});

test('Industries spans the desktop header and supports keyboard dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Industries' });
  const panel = page.locator('#industries-panel');
  await expect(panel).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('link', { name: /Fertilizers & Agri Inputs/ })).toBeVisible();
  const bounds = await panel.boundingBox();
  const header = await page.locator('#site-header').boundingBox();
  expect(bounds?.x).toBe(header?.x);
  expect(bounds?.width).toBe(header?.width);
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('link', { name: 'Feature directory' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await panel.getByRole('link', { name: /Fertilizers & Agri Inputs/ }).click();
  await expect(page).toHaveURL(/\/solutions\/agricultural-inputs\/?$/);
});

test('on mobile the industry cards expand inside the navigation drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Navigation Menu' }).click();
  const drawer = page.locator('#mobile-nav-menu');
  const shop = drawer.getByRole('link', { name: 'Small Shops' });
  await expect(shop).toBeHidden();
  await drawer.locator('summary').filter({ hasText: 'Industries' }).click();
  await expect(shop).toBeVisible();
  await shop.click();
  await expect(page).toHaveURL(/\/solutions\/small-business\/?$/);
});

test('feature and security pages state the distributor advantage and deployment limits', async ({ page }) => {
  await page.goto('/features');
  await expect(page.getByRole('heading', {
    level: 2, name: 'Supplier Rate History & Quote Review',
  })).toBeVisible();
  await expect(page.getByText(/does not silently reprice quotations/i)).toBeVisible();

  await page.goto('/security');
  await expect(page.getByRole('heading', {
    level: 1, name: /Security controls, clearly scoped/i,
  })).toBeVisible();
  await expect(page.getByText(/test a restore before relying on them for production/i)).toBeVisible();
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
  await expect(page).toHaveURL(/\/solutions\/agricultural-inputs\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('fertilizer and agri-input dealers');
  await expect(page.getByRole('form', { name: 'Request a demo' }).getByLabel('Business type')).toHaveValue('agricultural_inputs');
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

test('industry pages have dedicated content and preselect the relevant demo business', async ({ page }) => {
  for (const [id, audience, demo] of [
    ['electrical', 'electrical distributors', 'electrical_wholesale'],
    ['electronics', 'electronics wholesalers', 'electronics'],
    ['hardware', 'hardware suppliers', 'hardware'],
    ['retail-wholesale', 'retail and wholesale counters', 'general_wholesale'],
    ['agricultural-inputs', 'fertilizer and agri-input dealers', 'agricultural_inputs'],
    ['small-business', 'small shops and general trade', 'general_retail'],
  ]) {
    expect((await page.goto('/solutions/' + id + '/'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(audience);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp('/solutions/' + id + '/?$'));
    await expect(page.getByLabel('Business type')).toHaveValue(demo);
  }
});

test('industry detail tracks the sticky contents and supports keyboard workflow tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 950 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/solutions/retail-wholesale/');
  const rail = page.getByRole('navigation', { name: 'On this page' });
  await expect(rail.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'location');
  const railBox = (await rail.boundingBox())!;
  const headingBox = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(headingBox.x).toBeGreaterThan(railBox.x + railBox.width);
  await expect(page.getByRole('complementary', { name: 'Industry navigation' })).toHaveCSS('position', 'sticky');
  await rail.getByRole('link', { name: 'Features' }).click();
  await expect(rail.getByRole('link', { name: 'Features' })).toHaveAttribute('aria-current', 'location');
  const first = page.getByRole('tab', { name: 'Select Customer' });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await first.focus();
  await first.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Draft the Order' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Check quantities, discounts, and taxes');
  await page.getByText('Where do staff finish billing and record payment?', { exact: true }).click();
  await expect(page.getByText(/Use Retail Counter to draft/)).toBeVisible();
  await page.getByRole('navigation', { name: 'More industries', exact: true }).getByRole('link', { name: 'Small Shops' }).click();
  await expect(page).toHaveURL(/\/solutions\/small-business\/?$/);
});

test('industry detail fits a narrow phone and links to other industries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/solutions/small-business/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const related = page.getByRole('navigation', { name: 'Explore more industries' });
  await expect(related.getByRole('link', { name: 'Hardware & Tools' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('desktop header centers its links and the footer links to the Atlas OS repository', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  for (const width of [1024, 1536]) {
    await page.setViewportSize({ width, height: 800 });
    const navigation = (await page.getByRole('navigation', { name: 'Main Navigation' }).boundingBox())!;
    const header = (await page.locator('#site-header').boundingBox())!;
    const download = (await page.locator('#site-header').getByRole('link', { name: 'Download', exact: true }).boundingBox())!;
    expect(Math.abs(navigation.x + navigation.width / 2 - (header.x + header.width / 2))).toBeLessThan(2);
    expect(navigation.x + navigation.width).toBeLessThanOrEqual(download.x);
  }
  const social = page.getByRole('navigation', { name: 'Atlas OS social profiles' });
  await expect(social.getByRole('link', { name: 'Atlas OS on GitHub' })).toHaveAttribute('href', 'https://github.com/YenugantiVijay/Atlas-OS');
});

test('each industry sidebar scrolls independently on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 840 });
  await page.goto('/solutions/retail-wholesale/');
  const contents = page.getByRole('navigation', { name: 'On this page' }).getByRole('list');
  const more = page.getByRole('navigation', { name: 'More industries', exact: true }).getByRole('list');
  for (const list of [contents, more]) {
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  }
  await contents.hover();
  await page.mouse.wheel(0, 185);
  await expect.poll(() => contents.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await more.evaluate(el => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await more.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => more.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
