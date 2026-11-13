import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
let server: http.Server;

// Build-time PUBLIC_LEAD_ENDPOINT is fake for CI. All network calls are
// intercepted by Playwright; no real email, CAPTCHA or Supabase is used.
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    const safe = pathname.replace(/^\/+/, '');
    let file = path.resolve(root, safe);
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) file = path.join(root, '404.html');
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.json': 'application/json',
    };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(4321, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: "window.turnstile = { render: (_el, opts) => { queueMicrotask(() => opts.callback('ci-verified-token')); return 'ci-widget'; }, remove: () => {} };",
    });
  });
});

test('Contact form submits to server and only reports success after acknowledgement', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('https://api.example.test/**', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321' },
      body: JSON.stringify({ ok: true, reference: 'receipt-51' }) });
  });
  await page.goto('/contact');
  await page.locator('#contact_name').fill('Ravi Kumar');
  await page.locator('#contact_email').fill('ravi@example.com');
  await page.locator('#contact_message').fill('We would like a demonstration of the inventory features.');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message Received Successfully!')).toBeVisible();
  expect(requests).toHaveLength(1);
  const payload = requests[0] as { kind: string; token: string; data: { email: string } };
  expect(payload.kind).toBe('contact');
  expect(payload.token).toBe('ci-verified-token');
  expect(payload.data.email).toBe('ravi@example.com');
  expect(await page.evaluate(() => localStorage.getItem('atlas_contact_inquiries'))).toBeNull();
});

test('Contact form reports server failure without false success or localStorage fallback', async ({ page }) => {
  await page.route('https://api.example.test/**', async (route) =>
    route.fulfill({ status: 503, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321' },
      body: JSON.stringify({ ok: false, error: 'Enquiry service is temporarily unavailable.' }) }));
  await page.goto('/contact');
  await page.locator('#contact_name').fill('Ravi Kumar');
  await page.locator('#contact_email').fill('ravi@example.com');
  await page.locator('#contact_message').fill('The counter billing service is needed for our company.');
  await page.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByText('Message Received Successfully!')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('atlas_contact_inquiries'))).toBeNull();
});

test('Demo Request only confirms genuine server acknowledgement', async ({ page }) => {
  const requests: Array<{ kind: string; data: { industry: string; additionalMessage: string } }> = [];
  await page.route('https://api.example.test/**', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321' },
      body: JSON.stringify({ ok: true, reference: 'receipt-52' }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/request-demo?tier=professional');
  await expect(page.getByRole('form', { name: 'Request a demo' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Request a demo', exact: true })).toHaveCount(1);
  await page.locator('#fullName').fill('Suresh Rao');
  await page.locator('#businessName').fill('Rao Hardware');
  await page.locator('#email').fill('suresh@example.com');
  await page.locator('#phone').fill('9876543210');
  await page.locator('#city').fill('Guntur');
  await page.getByLabel('Business type').selectOption('agricultural_inputs');
  await page.getByRole('button', { name: 'Confirm Demonstration Request' }).click();
  await expect(page.getByText('Demonstration Request Received')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].kind).toBe('demo');
  expect(requests[0].data.industry).toBe('agricultural_inputs');
  expect(requests[0].data.additionalMessage).toContain('Atlas Professional');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => localStorage.getItem('atlas_saved_enquiries'))).toBeNull();
});

test('Desktop release signup requires an actual server acknowledgement', async ({ page }) => {
  let kind = '';
  await page.route('https://api.example.test/**', async (route) => {
    kind = route.request().postDataJSON().kind;
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321' },
      body: JSON.stringify({ ok: true, reference: 'receipt-53' }) });
  });
  await page.goto('/download');
  await page.getByPlaceholder('Enter work email...').fill('shop@example.com');
  await page.getByRole('button', { name: 'Notify Me' }).click();
  await expect(page.getByText('Your notification request was accepted for email delivery.')).toBeVisible();
  expect(kind).toBe('release');
  expect(await page.evaluate(() => localStorage.getItem('atlas_download_subscribers'))).toBeNull();
});
