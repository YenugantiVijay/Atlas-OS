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

  test('2. Interactive Concept Preview on Homepage switches tabs and displays realistic data', async ({ page }) => {
    await page.goto('/');

    // Verify top window chrome and badges
    await expect(page.locator('text=Bharat Electricals & Hardware Ltd.')).toBeVisible();
    await expect(page.locator('text=Atlas OS Desktop Edition Preview')).toBeVisible();

    // Verify initial dashboard tab is rendered with KPI cards and ₹ amounts
    await expect(page.locator('text=Executive Dashboard').first()).toBeVisible();
    await expect(page.locator('text=₹48,24,500')).toBeVisible();
    await expect(page.locator('text=₹12,40,250')).toBeVisible();
    await expect(page.locator('text=₹36,18,900')).toBeVisible();
    await expect(page.locator('text=₹14,92,000')).toBeVisible();

    // Verify monthly revenue progression chartlet
    await expect(page.locator('text=Revenue Progression (FY 26-27)')).toBeVisible();

    // Verify recent commercial transactions and status badges
    await expect(page.locator('text=Gayatri Electrical Contractors').first()).toBeVisible();
    await expect(page.locator('text=Paid in Full').first()).toBeVisible();
    await expect(page.locator('text=Partially Paid (₹1.5L Rec.)').first()).toBeVisible();

    // Click on Commercial Invoicing tab
    await page.click('button:has-text("Commercial Invoicing")');
    await expect(page.locator('text=Statutory Tax Invoice Details')).toBeVisible();
    await expect(page.locator('text=Polycab 2.5 sq mm FR-LSH Copper Wire (Red)')).toBeVisible();

    // Click on Multi-UOM Inventory tab
    await page.click('button:has-text("Multi-UOM Inventory")');
    await expect(page.locator('text=Polycab 2.5mm Wire (Red 90m)')).toBeVisible();
    await expect(page.locator('text=Schneider Acti9 32A 3-Pole MCB')).toBeVisible();

    // Click on Customer Receivables tab
    await page.click('button:has-text("Customer Receivables")');
    await expect(page.locator('text=Total Active Debtors')).toBeVisible();
    await expect(page.locator('text=32 Accounts')).toBeVisible();

    // Click on 1-Click Excel Exports tab
    await page.click('button:has-text("1-Click Excel Exports")');
    await expect(page.locator('text=One-Click Statutory Export Engine')).toBeVisible();
    await expect(page.locator('text=FY 2026-27')).toBeVisible();
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
    await expect(page.getByText(/seven-day trial for eligible businesses/i)).toBeVisible();
  });

  test('5. Request Demo form validates contact details and shows the server reference', async ({ page }) => {
    await mockLeadAcknowledgement(page, 'demo');
    await page.goto('/request-demo');
    const form = page.getByRole('form', { name: 'Request a demo' });
    const submit = form.getByRole('button', { name: 'Confirm Demonstration Request' });
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
    await expect(page.locator('text=Page Not Found')).toBeVisible();
    await page.click('a:has-text("Return to Homepage")');
    await expect(page).toHaveURL('http://127.0.0.1:4321/');
  });

  test('8. Brand workflow showcase animation continues on hover and respects container height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
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

    const storytelling = page.locator('section:has-text("One Place for Your Daily Business")');
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

      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(isOverflowing).toBe(false);
    }
  });

  test('11. Final CTA banner displays high-contrast buttons and updated headline copy', async ({ page }) => {
    await page.goto('/');

    const ctaSection = page.locator('section:has-text("Your Business Deserves a Smarter Way to Work.")');
    await expect(ctaSection).toBeVisible();

    // Check headline and subtitle copy
    await expect(ctaSection.locator('text=Your Business Deserves a Smarter Way to Work.')).toBeVisible();
    await expect(ctaSection.locator('text=Bring stock, sales, invoices, and payments together with Atlas OS. See how it can simplify your daily business.')).toBeVisible();

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
    const ctaSection = page.locator('section:has-text("Your Business Deserves a Smarter Way to Work.")');
    const primaryBtn = ctaSection.locator('a:has-text("Request a Demo")');
    const classes = await primaryBtn.getAttribute('class');
    expect(classes).toContain('btn-shimmer');
    expect(classes).toContain('btn-shimmer-teal');

    // Hero button has shimmer class
    const heroBtn = page.locator('a:has-text("Explore Atlas OS")').first();
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
