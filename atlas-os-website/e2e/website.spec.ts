import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

let server: http.Server;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let reqPath = req.url?.split('?')[0] || '/';
    let filePath = path.join(distDir, reqPath);

    if (fs.existsSync(filePath)) {
      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } else {
      if (fs.existsSync(filePath + '.html')) {
        filePath += '.html';
      } else {
        filePath = path.join(distDir, '404.html');
        res.statusCode = 404;
      }
    }

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise<void>((resolve) => {
    server.listen(4321, '127.0.0.1', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

async function mockLeadAcknowledgement(page: Page, expectedKind: string) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: "window.turnstile = { render: (_element, opts) => { queueMicrotask(() => opts.callback('ci-verified-token')); return 'ci-widget'; }, remove: () => {} };",
  }));
  await page.route('https://api.example.test/**', (route) => {
    const request = route.request().postDataJSON();
    expect(request.kind).toBe(expectedKind);
    expect(request.token).toBe('ci-verified-token');
    return route.fulfill({
      json: { ok: true, reference: 'atlas-ci-reference' },
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321' },
    });
  });
}

test.describe('Atlas OS Official Website E2E Tests', () => {
  test('1. Core routes load successfully with proper titles', async ({ page }) => {
    const routes = [
      { path: '/', titleContains: 'Atlas OS' },
      { path: '/product', titleContains: 'Product Overview' },
      { path: '/features', titleContains: 'Features' },
      { path: '/solutions', titleContains: 'Industry Solutions' },
      { path: '/download', titleContains: 'Download' },
      { path: '/pricing', titleContains: 'Pricing' },
      { path: '/receipt-templates', titleContains: 'Receipt Templates' },
      { path: '/request-demo', titleContains: 'Request a Personalized Live Demo' },
      { path: '/about', titleContains: 'About Us' },
      { path: '/security', titleContains: 'Security' },
      { path: '/support', titleContains: 'Help Center' },
      { path: '/contact', titleContains: 'Contact' },
    ];

    for (const route of routes) {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(new RegExp(route.titleContains, 'i'));
    }
  });

  test('industry photos load as responsive local images', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const examples = [
      { path: '/solutions/electronics/', labels: [/worker checking parts/] },
      { path: '/solutions/small-business/', labels: [/small general store/] },
    ];
    for (const example of examples) {
      await page.goto(example.path);
      for (const label of example.labels) {
        const image = page.getByRole('img', { name: label });
        await image.scrollIntoViewIfNeeded();
        await expect(image).toBeVisible();
        await expect(image).toHaveAttribute('srcset', /400w|480w/);
        await image.evaluate(async (image: HTMLImageElement) => image.decode());
        const source = await image.evaluate((image: HTMLImageElement) => image.currentSrc);
        expect(new URL(source).origin).toBe('http://127.0.0.1:4321');
        expect((await image.boundingBox())!.width).toBeLessThanOrEqual(390);
      }
    }
  });

  test('2. Interactive workspace preview switches between empty views', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Atlas OS Desktop Edition Preview', { exact: true })).toBeVisible();
    await expect(page.getByText('No sales recorded yet.', { exact: true })).toBeVisible();
    await expect(page.getByText('Bharat Electricals & Hardware Ltd.', { exact: false })).toHaveCount(0);

    for (const [tab, state] of [
      ['Commercial Invoicing', 'No invoices created yet.'],
      ['Multi-UOM Inventory', 'No products added yet.'],
      ['Customer Receivables', 'No customer balances yet.'],
      ['1-Click Excel Exports', 'No records available to export.'],
    ]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByText(state, { exact: true })).toBeVisible();
    }
  });

  test('About and search metadata describe verified capabilities and trial availability', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'How we test Atlas OS' })).toBeVisible();
    await expect(page.getByText('Guaranteed in production.', { exact: false })).toHaveCount(0);
    const metadata = await page.locator('script[type="application/ld+json"]').first().textContent();
    const software = JSON.parse(metadata!)['@graph'].find((entry: { '@type': string }) => entry['@type'] === 'SoftwareApplication');
    expect(software.offers).toBeUndefined();
  });

  test('3. Download center displays honest packaging preview and email registration works', async ({ page }) => {
    await mockLeadAcknowledgement(page, 'release');
    await page.goto('/download');

    // Verify packaging preview status badge
    await expect(page.locator('span:has-text("Packaging Preview")')).toBeVisible();
    await expect(page.locator('text=Standalone Windows Desktop Package In Active Development')).toBeVisible();

    // Verify system requirements table
    await expect(page.locator('text=Minimum System Requirements')).toBeVisible();
    await expect(page.locator('text=Windows 10').first()).toBeVisible();

    // Verify NO unverified direct .exe download link exists
    const fakeLinks = page.locator('a[href$=".exe"], a[href$=".msi"]');
    expect(await fakeLinks.count()).toBe(0);
    await expect(page.getByRole('heading', { name: 'Desktop Software Installation Guide' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Try the interactive preview' })).toHaveAttribute('href', '/#product-preview');

    // Test notification signup form
    const notify = page.getByRole('button', { name: 'Notify Me' });
    await expect(notify).toBeEnabled();
    const emailInput = page.locator('input[placeholder="Enter work email..."]');
    await emailInput.fill('hardware.dealer@example.com');
    await notify.click();

    await expect(page.getByText('Your notification request was accepted for email delivery.')).toBeVisible();
  });

  test('4. Pricing shows the three proposed editions and their receipt options', async ({ page }) => {
    await page.goto('/pricing');
    const plans = page.locator('#tiers article');
    await expect(plans).toHaveCount(3);
    await expect(plans.nth(0)).toContainText('Branded customer receipt and daily totals');
    await expect(plans.nth(1)).toContainText('Customer and counter receipts on one sheet');
    await expect(plans.nth(2)).toContainText('Customer and counter receipts on one sheet');
    await expect(page.getByText(/proposed launch pricing/i)).toBeVisible();
    await expect(page.getByText(/ask about trial availability/i)).toBeVisible();
  });

  test('5. Request Demo form validates contact details and shows the server reference', async ({ page }) => {
    await mockLeadAcknowledgement(page, 'demo');
    await page.goto('/request-demo');
    const form = page.getByRole('form', { name: 'Request a demo' });
    const submit = form.getByRole('button', { name: 'Send demo request' });
    await expect(submit).toBeEnabled();
    await expect(form.locator('#fullName')).toHaveJSProperty('required', true);
    await expect(form.locator('#businessName')).toHaveJSProperty('required', true);
    await page.locator('#fullName').fill('Suresh Kumar');
    await page.locator('#businessName').fill('Kumar Farm Supplies');
    await page.locator('#email').fill('suresh@example.com');
    await page.locator('#city').fill('Ahmedabad');
    await page.locator('#phone').fill('12345');
    await submit.click();
    await expect(form.getByRole('alert')).toContainText('10 to 15 digits');
    await page.locator('#phone').fill('9876543210');
    await submit.click();
    await expect(page.getByText('Demonstration Request Received')).toBeVisible();
    await expect(page.getByText('atlas-ci-reference')).toBeVisible();
  });

  test('6. Contact form handles validation and message delivery', async ({ page }) => {
    await mockLeadAcknowledgement(page, 'contact');
    await page.goto('/contact');

    // Trigger validation
    await page.click('button:has-text("Send Message")');
    await expect(page.locator('text=Please provide your name.')).toBeVisible();

    // Fill valid message
    await page.locator('#contact_name').fill('Anand Verma');
    await page.locator('#contact_email').fill('anand@vermatraders.com');
    await page.locator('#contact_message').fill('We are looking to migrate from BusyWin to Atlas OS for our 3 branch counters.');

    await page.click('button:has-text("Send Message")');

    // Verify success
    await expect(page.locator('text=Message Received Successfully!')).toBeVisible();
  });

  test('7. 404 page renders and provides working navigation back to home', async ({ page }) => {
    await page.goto('/non-existent-page-test-404');
    await expect(page.getByRole('heading', { name: 'Page Not Found', level: 1 })).toBeVisible();
    await page.click('a:has-text("Return to Homepage")');
    await expect(page).toHaveURL('http://127.0.0.1:4321/');
  });

  test('8. Brand workflow showcase animation continues on hover and respects container height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/product');
    const orbit = page.locator('.capability-orbit');
    await expect(orbit).toBeVisible();

    // Check desktop container min-height is within 540px - 580px (560px)
    const minHeight = await orbit.evaluate((el) => {
      return parseInt(getComputedStyle(el).minHeight, 10);
    });
    expect(minHeight).toBeGreaterThanOrEqual(540);
    expect(minHeight).toBeLessThanOrEqual(580);

    // Verify all 6 chips
    await expect(orbit.locator('.orbit-chip')).toHaveCount(6);
    for (const capability of ['Inventory', 'Sales Orders', 'Invoices', 'Payments', 'Reports', 'AI Insights']) {
      await expect(orbit.getByText(capability, { exact: true })).toBeVisible();
    }

    // Verify animation does NOT pause on hover
    await orbit.hover();
    const playState = await orbit.locator('.orbit-chip').first().evaluate((el) => {
      return getComputedStyle(el).animationPlayState;
    });
    expect(playState).not.toBe('paused');

    // Reduced motion check
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const animationName = await orbit.locator('.orbit-chip').first().evaluate((element) =>
      getComputedStyle(element).animationName
    );
    expect(animationName).toBe('none');

    // Mobile layout check
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(orbit).toBeVisible();
    await expect(orbit.locator('.orbit-chip')).toHaveCount(6);
  });

  test('9. Product storytelling section displays all 5 connected workflow steps', async ({ page }) => {
    await page.goto('/');

    const storytelling = page.locator('section:has-text("Tools for each step of a sale")');
    await expect(storytelling).toBeVisible();
    await expect(storytelling.getByRole('heading', { name: 'Keep Track of Your Stock' })).toBeVisible();
    await expect(storytelling.getByRole('heading', { name: 'Manage Customer Orders' })).toBeVisible();
    await expect(storytelling.getByRole('heading', { name: 'Handle Your Invoices' })).toBeVisible();
    await expect(storytelling.getByRole('heading', { name: 'Track Customer Payments' })).toBeVisible();
    await expect(storytelling.getByRole('heading', { name: 'Understand Your Business' })).toBeVisible();
  });

  test('10. Mobile and tablet viewports render without horizontal scroll overflow', async ({ page }) => {
    const viewports = [
      { width: 390, height: 844 }, // Mobile
      { width: 768, height: 1024 }, // Tablet
      { width: 1280, height: 800 }, // Desktop
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('/');

      const heroColumns = await page.locator('#home-overview .hero-grid').evaluate((grid) =>
        getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      );
      expect(heroColumns).toBe(vp.width >= 900 ? 2 : 1);

      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(isOverflowing).toBe(false);
    }
  });

  test('11. Final CTA banner displays high-contrast buttons and updated headline copy', async ({ page }) => {
    await page.goto('/');

    const ctaSection = page.locator('section:has-text("See Atlas OS with your workflow")');
    await expect(ctaSection).toBeVisible();

    // Check headline and subtitle copy
    await expect(ctaSection.locator('text=See Atlas OS with your workflow')).toBeVisible();
    await expect(ctaSection.locator('text=Bring a sample invoice, order, or stock delivery to the walkthrough.')).toBeVisible();

    // Check Primary Button (Request a Demo)
    const primaryBtn = ctaSection.locator('a:has-text("Request a Demo")');
    await expect(primaryBtn).toBeVisible();
    await expect(primaryBtn).toHaveAttribute('href', '/request-demo');

    // Contrast check: primary button must have dark text on light background (not white on white)
    const primaryColors = await primaryBtn.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
      };
    });
    // Color should NOT be white rgb(255, 255, 255)
    expect(primaryColors.color).not.toBe('rgb(255, 255, 255)');

    // Check Secondary Button (Explore Atlas OS)
    const secondaryBtn = ctaSection.locator('a:has-text("Explore Atlas OS")');
    await expect(secondaryBtn).toBeVisible();
    await expect(secondaryBtn).toHaveAttribute('href', '/product');
  });

  test('12. Global button shimmer animation classes are applied properly', async ({ page }) => {
    await page.goto('/');

    // Primary CTA button has shimmer class
    const ctaSection = page.locator('section:has-text("See Atlas OS with your workflow")');
    const primaryBtn = ctaSection.locator('a:has-text("Request a Demo")');
    const classes = await primaryBtn.getAttribute('class');
    expect(classes).toContain('btn-shimmer');
    expect(classes).toContain('btn-shimmer-teal');

    // Hero button has shimmer class
    const heroBtn = page.getByRole('link', { name: 'See Atlas OS in action' });
    const heroClasses = await heroBtn.getAttribute('class');
    expect(heroClasses).toContain('btn-shimmer');
  });

  test('13. Footer typography displays prominent headings and distinct links', async ({ page }) => {
    await page.goto('/');

    const footerHeading = page.locator('.footer-heading').first();
    await expect(footerHeading).toBeVisible();

    const headingStyles = await footerHeading.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: parseFloat(style.fontSize),
        fontWeight: parseInt(style.fontWeight, 10),
      };
    });
    // Heading must be >= 17px and bold (>= 600)
    expect(headingStyles.fontSize).toBeGreaterThanOrEqual(17);
    expect(headingStyles.fontWeight).toBeGreaterThanOrEqual(600);

    const footerLink = page.locator('.footer-link').first();
    await expect(footerLink).toBeVisible();

    const linkStyles = await footerLink.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: parseFloat(style.fontSize),
      };
    });
    // Link must be >= 14px
    expect(linkStyles.fontSize).toBeGreaterThanOrEqual(14);
  });
});
