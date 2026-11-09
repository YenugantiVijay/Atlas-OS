import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

console.log('--- Starting Atlas OS Website Static Verification ---');

const expectedRoutes = [
  { path: 'index.html', titleKeyword: 'Atlas OS', descKeyword: 'Distributors' },
  { path: 'product/index.html', titleKeyword: 'Product Overview', descKeyword: 'Atlas OS' },
  { path: 'features/index.html', titleKeyword: 'Features', descKeyword: 'capabilities' },
  { path: 'solutions/index.html', titleKeyword: 'Industry Solutions', descKeyword: 'Wholesale' },
  { path: 'download/index.html', titleKeyword: 'Download Atlas OS', descKeyword: 'Distribution' },
  { path: 'pricing/index.html', titleKeyword: 'Pricing', descKeyword: 'pricing' },
  { path: 'request-demo/index.html', titleKeyword: 'Request a Personalized Live Demo', descKeyword: 'walkthrough' },
  { path: 'about/index.html', titleKeyword: 'About Us', descKeyword: 'Story' },
  { path: 'security/index.html', titleKeyword: 'Security, Privacy', descKeyword: 'Row-Level Security' },
  { path: 'support/index.html', titleKeyword: 'Help Center', descKeyword: 'documentation' },
  { path: 'contact/index.html', titleKeyword: 'Contact Sales', descKeyword: 'team' },
  { path: '404.html', titleKeyword: 'Page Not Found', descKeyword: 'Error 404' },
];

let failedChecks = 0;

// 1. Verify existence and content of each route
for (const route of expectedRoutes) {
  const filePath = path.join(distDir, route.path);
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] Missing expected route file: ${route.path}`);
    failedChecks++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length < 500) {
    console.error(`[FAIL] Route file ${route.path} seems unexpectedly truncated (${content.length} bytes)`);
    failedChecks++;
    continue;
  }

  if (!content.includes('<title>') || !content.includes(route.titleKeyword)) {
    console.error(`[FAIL] Route ${route.path} missing expected title keyword: "${route.titleKeyword}"`);
    failedChecks++;
  }

  if (!content.includes('<meta name="description"')) {
    console.error(`[FAIL] Route ${route.path} missing meta description tag`);
    failedChecks++;
  }

  if (!content.includes('<meta property="og:title"')) {
    console.error(`[FAIL] Route ${route.path} missing OpenGraph title tag`);
    failedChecks++;
  }

  console.log(`[PASS] Route ${route.path} validated (${(content.length / 1024).toFixed(1)} KB)`);
}

// 2. Verify static assets (robots.txt, sitemap, favicon)
const assets = ['robots.txt', 'sitemap-index.xml', 'sitemap-0.xml', 'favicon.svg'];
for (const asset of assets) {
  const assetPath = path.join(distDir, asset);
  if (!fs.existsSync(assetPath)) {
    console.error(`[FAIL] Missing asset: ${asset}`);
    failedChecks++;
  } else {
    const size = fs.statSync(assetPath).size;
    console.log(`[PASS] Static asset ${asset} validated (${size} bytes)`);
  }
}

// 3. Verify sitemap contents
const sitemapPath = path.join(distDir, 'sitemap-0.xml');
if (fs.existsSync(sitemapPath)) {
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  const expectedUrls = [
    '/product',
    '/features',
    '/solutions',
    '/download',
    '/pricing',
    '/request-demo',
    '/about',
    '/security',
    '/support',
    '/contact',
  ];
  for (const u of expectedUrls) {
    if (!sitemapContent.includes(u)) {
      console.error(`[FAIL] Sitemap missing expected URL path: ${u}`);
      failedChecks++;
    }
  }
  console.log('[PASS] Sitemap URL coverage validated.');
}

// 4. Verify firebase.json configuration
const firebaseConfigPath = path.resolve(__dirname, '../firebase.json');
if (!fs.existsSync(firebaseConfigPath)) {
  console.error('[FAIL] Missing firebase.json');
  failedChecks++;
} else {
  const fb = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  if (fb.hosting?.public !== 'dist') {
    console.error('[FAIL] firebase.json hosting.public is not "dist"');
    failedChecks++;
  }
  if (!fb.hosting?.cleanUrls) {
    console.error('[FAIL] firebase.json cleanUrls is not enabled');
    failedChecks++;
  }
  if (!fb.hosting?.headers || fb.hosting.headers.length === 0) {
    console.error('[FAIL] firebase.json missing security and cache headers');
    failedChecks++;
  } else {
    console.log('[PASS] firebase.json deployment configuration validated.');
  }
}

// 5. Check desktop installer integrity rule: NO fake .exe or .msi download links
const downloadHtml = fs.readFileSync(path.join(distDir, 'download/index.html'), 'utf8');
const fakeInstallerRegex = /href=["'][^"']*\.(exe|msi)["']/i;
if (fakeInstallerRegex.test(downloadHtml)) {
  console.error('[FAIL] Packaging honesty violation: Found unverified .exe or .msi download link in download page!');
  failedChecks++;
} else {
  console.log('[PASS] Packaging honesty verified: Zero fake .exe or .msi binaries linked.');
}

// 6. Verify the public edition presentation is readable and truthful.
const pricingHtml = fs.readFileSync(path.join(distDir, 'pricing/index.html'), 'utf8');
for (const edition of ['Atlas Essentials', 'Atlas Professional']) {
  if (!pricingHtml.includes(edition)) {
    console.error(`[FAIL] Pricing page missing edition: ${edition}`);
    failedChecks++;
  }
}
for (const prematureClaim of ['Save 20% on Launch', '99.9% uptime SLA', 'Unlimited SKUs, branches']) {
  if (pricingHtml.includes(prematureClaim)) {
    console.error(`[FAIL] Pricing page contains unapproved commercial claim: ${prematureClaim}`);
    failedChecks++;
  }
}
if (!pricingHtml.includes('Pricing to be announced')) {
  console.error('[FAIL] Pricing page does not clearly state commercial prices are not yet available');
  failedChecks++;
} else {
  console.log('[PASS] Honest two-edition pricing presentation verified.');
}

// 7. Protect the zero-server index.html preview from the old dead-link launcher.
const localIndexPath = path.resolve(__dirname, '../index.html');
if (!fs.existsSync(localIndexPath)) {
  console.error('[FAIL] Standalone homepage index.html is missing');
  failedChecks++;
} else {
  const page = fs.readFileSync(localIndexPath, 'utf8');
  const checks = [
    [/<title>Atlas OS — Run Your Business/i, 'Direct Atlas OS homepage title'],
    [/<h1>Run Your Business\./i, 'Visible homepage hero'],
    [/id="product"/, 'Interactive product section'],
    [/id="features"/, 'Feature section'],
    [/id="solutions"/, 'Solutions section'],
    [/id="pricing"/, 'Pricing section'],
    [/id="demo"/, 'Informative demo section'],
    [/src="\.\/public\/favicon\.svg"/, 'Local brand logo'],
    [/role="tablist"/, 'Demo workspace tabs'],
  ];
  for (const [pattern, label] of checks) {
    if (!pattern.test(page)) {
      console.error('[FAIL] Standalone homepage missing: ' + label);
      failedChecks++;
    }
  }
  for (const match of page.matchAll(/href="#([a-z0-9-]+)"/gi)) {
    if (!page.includes('id="' + match[1] + '"')) {
      console.error('[FAIL] Broken standalone homepage anchor: #' + match[1]);
      failedChecks++;
    }
  }
  if (/Open Live Website|Website Live Preview<\/title>|href="http:\/\/localhost:4321\/"/i.test(page)) {
    console.error('[FAIL] Dead localhost launcher UI must not return to index.html');
    failedChecks++;
  }
  if (!fs.existsSync(path.resolve(__dirname, '../public/favicon.svg'))) {
    console.error('[FAIL] Local homepage favicon is missing');
    failedChecks++;
  }
  console.log('[PASS] Direct homepage entry and local anchors verified.');
}

// 8. The one-click launcher must wait until the real Astro site is reachable.
const commandPath = path.resolve(__dirname, '../preview-website.cmd');
const readinessPath = path.resolve(__dirname, 'wait-for-website.mjs');
const command = fs.readFileSync(commandPath, 'utf8');
if (!command.includes('node scripts\\wait-for-website.mjs') ||
    !command.includes('if errorlevel 1') ||
    !command.includes('start "" "http://127.0.0.1:4321/"') ||
    !fs.existsSync(readinessPath)) {
  console.error('[FAIL] One-click website launcher no longer verifies readiness before opening');
  failedChecks++;
} else {
  console.log('[PASS] One-click launcher checks the Astro homepage before opening browser.');
}

console.log('----------------------------------------------------');
if (failedChecks > 0) {
  console.error(`Verification FAILED with ${failedChecks} errors.`);
  process.exit(1);
} else {
  console.log('ALL WEBSITE VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  process.exit(0);
}
