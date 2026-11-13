# Atlas OS — Official Software Website

Official public-facing marketing, product discovery, documentation, and download center for **Atlas OS** — the modern AI-native business operating system engineered for electrical, electronics, and hardware wholesale & retail enterprises.

---

## 1. Architectural Overview

The website is engineered as a standalone, high-performance static web application designed for global CDN distribution via Firebase Hosting:

- **Framework**: [Astro 4](https://astro.build/) with TypeScript in strict mode
- **Interactive Islands**: React 18 for interactive client components (interactive product concept previews, demo booking form, transparent download release cards, dynamic pricing toggle, FAQ accordion, contact forms)
- **Styling**: Tailwind CSS with custom Atlas OS brand tokens (Primary Violet `#8B5CF6`, Deep Violet `#6D28D9`, Soft Violet `#EDE9FE`, High-Contrast Slate typography, custom subtle grid background)
- **Icons**: Lucide React
- **Output Mode**: `output: 'static'` (Static Site Generation / SSG)
- **Deployment Target**: Firebase Hosting (clean URLs, immutable static asset caching, HSTS, frame protection, no-sniff headers)

---

## 2. Directory Structure

```
atlas-os-website/
├── astro.config.mjs           # Astro configuration (Tailwind, React, Sitemap, Static output)
├── firebase.json              # Firebase Hosting configuration (cleanUrls, caching, security headers)
├── package.json               # Dependencies and build scripts
├── tailwind.config.mjs        # Brand color palette, typography, animations
├── tsconfig.json              # Strict TypeScript configuration
├── public/                    # Static assets
│   ├── favicon.svg            # Hexagonal Atlas OS brand mark
│   └── robots.txt             # SEO crawler directives & sitemap reference
├── src/
│   ├── components/            # Reusable UI components
│   │   ├── common/            # Header, Footer, BrandLogo, Container, Button, Badge
│   │   ├── demo/              # RequestDemoForm (React with phone validation, honeypot)
│   │   ├── download/          # ReleaseCard (Transparent release manifest architecture)
│   │   ├── home/              # InteractivePreview (Realistic ERP workspace simulation)
│   │   ├── pricing/           # PricingTable (Monthly/Annual calculator with 7-day trial terms)
│   │   ├── support/           # FaqAccordion (Categorized interactive search & accordion)
│   │   └── contact/           # ContactForm (Direct message form with validation)
│   ├── data/                  # Authoritative typed data models
│   │   ├── faqs.ts            # Categorized FAQ entries
│   │   ├── features.ts        # Production, In-Development, and Planned feature directory
│   │   ├── industries.ts      # 4 core industry solutions & workflows
│   │   ├── navigation.ts      # Header and footer link structure
│   │   ├── pricing.ts         # Transparent pricing tiers & feature comparisons
│   │   └── releases.ts        # Typed release manifest & minimum system requirements
│   ├── layouts/               # Master layout with OpenGraph, JSON-LD, Twitter cards
│   │   └── BaseLayout.astro
│   ├── pages/                 # Multi-page website routes
│   │   ├── index.astro        # Homepage (Hero, Interactive preview, Feature highlights, CTA)
│   │   ├── product.astro      # Product architecture & Legacy ERP comparison
│   │   ├── features.astro     # Comprehensive feature matrix with honest development tags
│   │   ├── solutions.astro    # Wholesale Electrical, Electronics, Hardware, Trade Counters
│   │   ├── download.astro     # Official Download Center (Windows desktop preview & requirements)
│   │   ├── pricing.astro      # Transparent plans, commercial trial terms, pricing FAQs
│   │   ├── request-demo.astro # Dedicated live product walkthrough booking page
│   │   ├── about.astro        # Company mission, trade counter problems, engineering values
│   │   ├── security.astro     # Technical security controls, RLS, 6-tier RBAC matrix, PITR
│   │   ├── support.astro      # Help center, documentation directory, contact helpdesk
│   │   ├── contact.astro      # Direct departmental contacts, phone, hours, message form
│   │   └── 404.astro          # Custom 404 page with navigation shortcuts
│   ├── styles/
│   │   └── global.css         # Base typography, custom scrollbars, animations, reduced motion
│   └── types/
│       └── index.ts           # Central TypeScript interface contracts
```

---

## 3. Product & Architectural Principles

1. **Desktop Packaging Honesty**:
   The website never publishes non-existent, fake `.exe` or `.msi` installers. The download center openly labels Windows Desktop distribution as **"Packaging Preview / Coming Soon"**, displays official hardware requirements (Windows 10/11 64-bit, 4 GB RAM, 1080p display), and provides a typed release manifest with an email registration form.
2. **Realistic Business Workflows**:
   All interactive concept previews display genuine trade distributor data: Polycab copper cables, Schneider MCBs, Philips LED panels, Bosch power drills, multi-rate GST (18%, 28%), partial receipt allocations, and 1-click fiscal year Excel exports.
3. **No Marketing Exaggeration**:
   Security documentation avoids claiming unverified third-party certifications (e.g. SOC 2 or ISO 27001). Instead, it explains verified technical controls: PostgreSQL Row-Level Security, 6-tier RBAC matrix, immutable transactional ledger, continuous PITR backups, and spreadsheet formula injection sanitization.

---


### Brand alignment and workflow visual

The public website now follows the **actual ERP application's** brand tokens:
primary teal `#0D9488`, deep navy `#142B4D`, and soft canvas `#F5F7FA`.
The homepage includes a CSS-only *Connected Workflows* showcase with six labeled
capability chips. The icons move in, hold position, and move out, but become
static on smaller screens or when the user requests reduced motion. AI Insights
is explicitly labeled **In development**. The ERP application's own styles,
Supabase migrations, and business workflows are not changed.

## Real website enquiries (PR #51)

Contact, Demo Request, and desktop release notification forms now use a server-backed email delivery endpoint. **They no longer report success after saving data only in browser localStorage.**

To activate the forms you must deploy the Supabase `submit-website-lead` Edge Function, apply the service-only rate-limit migration, configure Resend and Cloudflare Turnstile, and provide `PUBLIC_LEAD_ENDPOINT` and `PUBLIC_TURNSTILE_SITE_KEY` at **website build time**. Without these settings the forms display an unavailable notice and do not fake delivery.

See [PR #51 Website Lead Delivery deployment and verification](../docs/PR51_WEBSITE_LEAD_DELIVERY.md) for secrets, staging tests, explicit deployment approval and real inbox verification. Neither the website build nor a merged PR deploys the service automatically.

## 4. Preview the REAL Website (one Astro design, no duplicate index.html)

**The only website design source is `src/pages/*.astro`**, starting with `src/pages/index.astro`. Do not maintain another standalone homepage at `atlas-os-website/index.html`: a duplicate used to show a different, simplified design in VS Code Live Server. It has been deleted.

### Windows — open the official website automatically

1. Open the `atlas-os-website` folder in File Explorer.
2. Double-click **`preview-website.cmd`**.
3. The script checks Node/npm, installs dependencies if needed, and opens **http://127.0.0.1:4321/** after verifying that Astro is serving this checkout and Git revision.
4. Keep the Astro server terminal open while previewing. Edits to `src/pages/`, `src/components/` and styles appear with hot reload.

After pulling updates or switching branches, close the previous **Atlas OS Website Live Server** terminal before reopening the launcher. If port 4321 is already serving a different checkout, an older revision, or a static build, the launcher identifies the conflict. Close the terminal serving that port and try again.

### VS Code — live preview (with hot reload)

Open the **website folder** in VS Code and run these commands in the terminal:

```bash
npm ci
npm run dev
```

Then open **http://127.0.0.1:4321/** in your browser. **Do not use "Open with Live Server" on an `index.html` in the source folder**: Live Server cannot compile `.astro` components and will not show the true website.

### Production build — the generated index.html you requested

```bash
npm run build
npm run verify
npm run preview
```

Astro automatically creates the real homepage at **`atlas-os-website/dist/index.html`**, plus matching pages/assets. This is the correct `index.html`; it is generated from the original Astro design, not independently edited. The production-style preview opens on port 4321 (stop the dev server first).

Firebase Hosting uses `dist/` as its website root; the original design and route structure are preserved.

## 5. Local Development & Verification

### Prerequisites
- Node.js >= 18.18.0
- npm >= 9.0.0

### Quality Verification Suite
```bash
cd atlas-os-website
npm run typecheck    # Strict TypeScript validation
npm run check        # Astro template and diagnostic check
npm run build        # Production static build to ./dist
npm test             # Playwright end-to-end regression tests
```

---

## 6. Deployment to Firebase Hosting

### Initial Setup
1. Install Firebase CLI globally if not already present:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in to Firebase:
   ```bash
   firebase login
   ```
3. Set your active Firebase project in `.firebaserc` or via CLI:
   ```bash
   firebase use <your-firebase-project-id>
   ```

### Deploying
```bash
# 1. Build the static site
npm run build

# 2. Deploy static distribution to Firebase Hosting
firebase deploy --only hosting
```

The configuration in `firebase.json` automatically handles:
- Static file serving from `dist/`
- Clean URLs (`/product` instead of `/product.html`)
- Immutable 1-year caching for fingerprinted assets (`/_astro/**`)
- 24-hour caching for XML sitemaps and favicon
- Strict HTTP security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`)
