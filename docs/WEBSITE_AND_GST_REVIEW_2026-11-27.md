# Website, Firebase and GST review — 27 November 2026

## Firebase Hosting

The supplied public website is https://atlas-os-8328y.web.app/ and the project ID is atlas-os-8328y. The homepage, pricing, features and GST calculator returned HTTP 200 during this review. The website is an Astro static build and is compatible with classic Firebase Hosting. Its existing firebase.json serves atlas-os-website/dist; .firebaserc now records the supplied default project. No live deployment was made and project ownership/CLI authorization was not established. The Firebase CLI was not on PATH.

Build and deploy the public website from atlas-os-website after installing and authenticating the Firebase CLI:

```powershell
npm run build
firebase deploy --only hosting --project atlas-os-8328y
```

A Git push alone does not deploy Hosting unless an explicit deployment integration exists. No deployment workflow or credentials were added. Use Firebase's GitHub integration if automated preview/live releases are later wanted: https://firebase.google.com/docs/hosting/github-integration

The ERP is a separate Vite SPA with its existing Supabase backend. firebase.erp.json prepares SPA rewrites and public PWA cache headers. Its named hosting target, erp, intentionally has no site mapping. To deploy it, create/select a distinct Hosting site and map it; never map erp to the marketing website's existing site:

```powershell
npm run build
firebase target:apply hosting erp YOUR_SEPARATE_ERP_SITE_ID --project atlas-os-8328y
firebase deploy --config firebase.erp.json --only hosting:erp --project atlas-os-8328y
```

Confirm the deployed ERP URL and configure PUBLIC_APP_URL before rebuilding the website's install/open actions. The website's default build leaves those actions unavailable when an ERP URL is not configured. Hosted authentication redirect URLs and enquiry endpoint/Turnstile settings require their actual deployed values. No secrets, paid services, database migrations or changes to user records were introduced.

## Industry and product menus

The Industries menu now contains all ten requested industries, five columns by two rows at wide desktop widths, with an Explore Atlas OS column. Smaller widths use fewer columns. The Products menu contains eight cards, including three editions, the web/PWA, and implemented specialty/import-export workflow descriptions. Desktop hover, keyboard/Escape and mobile disclosure behavior are covered by browser tests. Preview images were visually inspected.

## Website content

Reviewed the 53 generated HTML routes through their shared templates, source copy and generated main content. This includes 18 main/error pages, eight calculator detail pages, ten industry pages, ten installation/tool pages and seven invoice-format detail pages. Corrected unsupported production-ready/AI/native hardware claims, invented contact addresses and a placeholder phone number, unsupported support hours/SLA, unverified competitor comparisons, edition names, security guarantees and historic-tax wording. Example invoices and worksheets remain explicitly illustrative; rates and invoice particulars require transaction-specific review. Native installers and branch coordination remain planned. Supported arithmetic is not statutory certification, GST portal verification, or a production security attestation.

## Proposed quotation

All figures are INR per organization, excluding applicable taxes, with final scope and terms to be agreed. There is no checkout or automatic subscription change.

- Atlas Sprout: 499/month or 4,990/year. Shop stock, orders, invoices, payment recording, customer receipts, daily totals and browser/PWA access.
- Atlas Stride: 999/month or 9,990/year. Sprout plus purchasing/receiving, supplier quotes/rates, supported reporting and two-copy receipts. Specialty rollout requires review.
- Atlas Summit: indicative 1,999/month or 19,990/year budget. Planned branch functionality; not available for purchase.

Annual proposals equal ten monthly payments. These are introductory quotations chosen for the current product scope, not a profitability or market-share forecast. Existing server plan IDs and entitlements remain unchanged. Display names were updated in website and owner/permission screens. No unreleased feature was activated.

## CGST, SGST, UTGST and IGST

The public calculator and accounting-export split now share integer-paise allocation. For an explicitly selected ordinary local supply, total GST is divided between CGST and SGST or UTGST. Inter-state allocation uses IGST. A 1,000 taxable value at 18% gives 180 GST: 90 CGST plus 90 SGST/UTGST, total 1,180; tax-inclusive 1,180 extracts the same 1,000 base and 180 GST. The existing rounding convention assigns an odd paise to the regional component to preserve the recorded total; it is a software policy, not a claim that every filing system rounds identically.

Fixed the Tally-oriented draft export to label confirmed local supplies in UTGST territories as Output UTGST rather than Output SGST. Delhi, Puducherry, Jammu and Kashmir, Andhra Pradesh and Telangana retain SGST treatment for ordinary local supplies. Tests cover odd-paise conservation, zero, inclusive/exclusive prices, mixed rates, discounts, inter-state allocation, territory allocation, supported 40% arithmetic, large amounts and invalid inputs. Existing invoice total/rate snapshots remain unchanged; missing historical component snapshots remain missing. No historical tax split was fabricated.

Classification still depends on confirmed supplier/place-of-supply details. This is not a complete SEZ, import/export, reverse-charge, cess or special place-of-supply engine. It does not choose the legal HSN/rate, file returns, or generate a live IRN/e-way bill. Export drafts require accounting review before import.

Official references reviewed:

- IGST Act, nature of supply: https://cbic-gst.gov.in/hindi/IGST-bill-e.html
- UTGST Act: https://www.indiacode.nic.in/bitstream/123456789/2252/1/A2017_14.pdf
- E-invoicing turnover notification: https://gstcouncil.gov.in/node/4365
- Income-tax scope/slabs: https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1
- Income-tax Act 2025 as amended in 2026: https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf

## Route coverage

- /404.html
- /
- /about/
- /calculators/
- /contact/
- /download/
- /features/
- /gst-calculator/
- /gst-documents/
- /invoice-formats/
- /pricing/
- /product/
- /receipt-templates/
- /request-demo/
- /resources/
- /security/
- /solutions/
- /support/
- /calculators/annual-tax-balance/
- /calculators/emi/
- /calculators/eway-bill-template/
- /calculators/gstin-check/
- /calculators/income-tax/
- /calculators/input-tax-credit/
- /calculators/inventory-turnover/
- /calculators/profit-margin/
- /download/agricultural-inputs/
- /download/banner-print-studio/
- /download/ecommerce/
- /download/electrical/
- /download/electronics/
- /download/hardware/
- /download/ice-cream-distribution/
- /download/ice-cream-stalls/
- /download/retail-wholesale/
- /download/small-business/
- /invoice-formats/electrical-hardware/
- /invoice-formats/electronics-mobile/
- /invoice-formats/gst-wholesale/
- /invoice-formats/hotel/
- /invoice-formats/professional-services/
- /invoice-formats/retail/
- /invoice-formats/transport/
- /solutions/agricultural-inputs/
- /solutions/banner-print-studio/
- /solutions/ecommerce/
- /solutions/electrical/
- /solutions/electronics/
- /solutions/hardware/
- /solutions/ice-cream-distribution/
- /solutions/ice-cream-stalls/
- /solutions/retail-wholesale/
- /solutions/small-business/

## Validation

- Root lint and TypeScript/production builds passed; owner console built separately.
- Vitest: 918 passed, 39 skipped (97 passing files, two skipped files).
- Website: 53 generated pages, static verification/type checking passed; 52 browser tests passed.
- ERP browser suite: 75/75 passed in the final sequential run. An earlier concurrent run had one payment-modal cancellation failure; the exact test passed ten consecutive isolated runs before the complete sequential pass. No product change or assertion weakening was made for that transient failure.
- Lead endpoint contract tests: 16/16; preview isolation: 3/3; supplementary harness checks: 11/11.
- PWA public-cache security: 5/5; real Chromium installability, cache exclusion, offline/reconnect and deferred update lifecycle passed.
- Both menu preview screenshots were visually inspected.
- No database migration was added. Live Firebase deployment and hosted-environment verification remain outside these local results.

CI follow-up: The first cloud unit run exposed a test import across the separately installed Astro project. Calculator arithmetic and decimal parsing now live in dependency-free core modules; website entry points re-export them. Root tests no longer require Astro dependencies. The arithmetic and public module APIs are unchanged.
