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

## 4. Local Development

### Prerequisites
- Node.js >= 18.18.0
- npm >= 9.0.0

### Installation
From the website directory:
```bash
cd atlas-os-website
npm install
```

### Running Locally
```bash
npm run dev
```
The development server will launch at `http://localhost:4321`.

### Typechecking & Production Build
```bash
npm run typecheck    # Runs tsc --noEmit
npm run check        # Runs astro check (validates Astro templates & scripts)
npm run build        # Generates production static output in ./dist
npm run preview      # Serves the static ./dist build locally
```

---

## 5. Deployment to Firebase Hosting

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
