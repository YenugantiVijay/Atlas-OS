import { test, expect } from '@playwright/test';
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

test.describe('Atlas OS Official Website E2E Tests', () => {
  test('1. Core routes load successfully with proper titles', async ({ page }) => {
    const routes = [
      { path: '/', titleContains: 'Atlas OS' },
      { path: '/product', titleContains: 'Product Overview' },
      { path: '/features', titleContains: 'Features' },
      { path: '/solutions', titleContains: 'Industry Solutions' },
      { path: '/download', titleContains: 'Download' },
      { path: '/pricing', titleContains: 'Pricing' },
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

    // Verify initial dashboard tab is rendered
    await expect(page.locator('text=Executive Dashboard').first()).toBeVisible();

    // Click on Commercial Invoicing tab
    await page.click('button:has-text("Commercial Invoicing")');
    await expect(page.locator('text=Statutory Tax Invoice Details')).toBeVisible();
    await expect(page.locator('text=Polycab 2.5 sq mm FR-LSH Copper Wire (Red)')).toBeVisible();

    // Click on Multi-UOM Inventory tab
    await page.click('button:has-text("Multi-UOM Inventory")');
    await expect(page.locator('text=Polycab 2.5mm Wire (Red 90m)')).toBeVisible();
    await expect(page.locator('text=Schneider Acti9 32A 3-Pole MCB')).toBeVisible();

    // Click on 1-Click Excel Exports tab
    await page.click('button:has-text("1-Click Excel Exports")');
    await expect(page.locator('text=One-Click Statutory Export Engine')).toBeVisible();
    await expect(page.locator('text=FY 2026-27')).toBeVisible();
  });

  test('3. Download center displays honest packaging preview and email registration works', async ({ page }) => {
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
    const emailInput = page.locator('input[placeholder="Enter work email..."]');
    await emailInput.fill('hardware.dealer@example.com');
    await page.click('button:has-text("Notify Me")');

    await expect(page.locator('text=You are registered for release notifications!')).toBeVisible();
  });

  test('4. Pricing interval toggle updates plan amounts and shows annual discount', async ({ page }) => {
    await page.goto('/pricing');

    // Verify plans and launch discount badge
    await expect(page.locator('text=Starter Edition')).toBeVisible();
    await expect(page.locator('text=Professional Edition')).toBeVisible();
    await expect(page.locator('text=Save 20% on Launch')).toBeVisible();

    // Toggle to Annual
    await page.click('button:has-text("Annual Billing")');
    await expect(page.locator('text=Save 20% on Launch')).toBeVisible();

    // Verify commercial trial promise
    await expect(page.locator('text=7-day complimentary commercial trial')).toBeVisible();
  });

  test('5. Request Demo form enforces validation and accepts genuine submission', async ({ page }) => {
    await page.goto('/request-demo');

    // Submit empty form to trigger validation errors
    await page.click('button:has-text("Confirm Demonstration Request")');
    await expect(page.locator('text=Please enter your full name.')).toBeVisible();
    await expect(page.locator('text=Please enter your enterprise or trade name.')).toBeVisible();

    // Fill valid submission details
    await page.locator('#fullName').fill('Suresh Kumar');
    await page.locator('#businessName').fill('Kumar Electrical Wholesale');
    await page.locator('#email').fill('suresh@kumarelectrical.com');
    await page.locator('#phone').fill('9876543210');
    await page.locator('#city').fill('Ahmedabad');

    await page.click('button:has-text("Confirm Demonstration Request")');

    // Verify success confirmation card
    await expect(page.locator('text=Demonstration Request Received')).toBeVisible();
    await expect(page.locator('text=Suresh Kumar').first()).toBeVisible();
  });

  test('6. Contact form handles validation and message delivery', async ({ page }) => {
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
  test('8. Brand workflow showcase appears and respects reduced-motion preferences', async ({ page }) => {
    await page.goto('/');
    const orbit = page.locator('.capability-orbit');
    await expect(orbit).toBeVisible();
    await expect(orbit.locator('.orbit-chip')).toHaveCount(6);
    for (const capability of ['Inventory', 'Sales Orders', 'Invoices', 'Payments', 'Reports', 'AI Insights']) {
      await expect(orbit.getByText(capability, { exact: true })).toBeVisible();
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const animationName = await orbit.locator('.orbit-chip').first().evaluate((element) =>
      getComputedStyle(element).animationName
    );
    expect(animationName).toBe('none');

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

});
