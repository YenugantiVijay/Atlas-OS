# PR #58 — One-screen Goods Receiving: New Products and Smart Lookup

## Operator problem (Atlas OS 4)

During lorry intake, an item may not yet exist in the catalog. Previously, the operator had to leave **Bulk Goods Receiving** to create the product. Search suggestions showed stock but not the item's selling price, and a uniform carton receipt required typing a `5x12` shorthand rather than entering *Cases* and *Units/case* in separate fields.

## Changes

- **Create new product inside the GRN screen**: a permission-gated modal collects SKU, product name, company/brand, category, UOM, supplier purchase rate, selling price, GST rate, and optional HSN. Pre-fills the operator's search term as the product name.
- Uses existing `productsService.createProduct()` and guarded `create_product_atomic` Supabase RPC; **opening stock is always 0**. The new catalog master persists immediately even if the receipt draft is later abandoned; the UI discloses this explicitly. No direct `products` writes or new SQL migration.
- After successful creation, the product is added directly to the current receipt worksheet. Duplicate SKU and permission/entitlement failures remain server-authoritative.
- Product autocomplete shows live on-hand units and catalog **selling price**, as well as name, SKU and UOM. Search is tenant-scoped, bounded, and keyboard-selectable. Purchase costs stay out of general search suggestions.
- Worksheet now has auto-numbered **Sl., Product, Cases, Units/case, Variable cartons, Loose units, Total units, Unit, Purchase rate, Line value** fields. Uniform cartons are translated into the existing canonical `NxM` format; mixed carton-size entry remains supported and **never assumes a fixed carton size**.
- Enter key advances from cases → units/case → loose units → purchase rate → product search.
- Adds catalog UOM choices **Bags, Kg, Litres, Packs** (the underlying text UOM column already permits them).

## Database authority and safety

- The new-product RPC creates the master with **zero opening stock**; it does not silently post inventory, book supplier payables or change historical cost.
- Saving an incomplete draft must not increment inventory. Posting a GRN is still the sole authoritative `post_goods_receipt` stock change, with server-side validation, idempotency, audit and PR57 supplier purchase-rate snapshot.
- Other company prices remain supplier-specific snapshots; changing the purchase rate does not silently update the master selling price.
- The UI checks both `products:create` and `inventory:receive`; RPC re-verifies live session, org membership/role and write entitlement.
- Demo Mode cannot claim cloud product creation or stock posting.

## Tests and release gates

- Unit tests for new product validation and Cases × Units/case conversion.
- Component tests assert `create_product_atomic` service invocation with zero opening stock and rejection/error handling.
- Playwright Demo Mode verifies buttons stay disabled and new table headings appear.
- CI must pass lint, TypeScript, disposable PostgreSQL acceptance, Vitest, build and Playwright.
- Supervised authenticated cloud UI smoke test remains necessary before claiming end-to-end production readiness; no live production tenant writes are authorized by this PR.
- The 200-entry industrial Demo Mode test remains paused.

## Scope limitations

- No automatic supplier price prediction, no full warehouse/godown, batch/expiry or unit conversion engine.
- Excel/TSV paste still requires known SKU; an unmatched item is created via the new-product dialog, then added to the sheet.
- Search-with-stock-and-price is implemented here in the **receiving** workflow. Extending this shared pattern to the sales counter, quotations and all global search surfaces is separately tracked.
- Existing Stock Movements fix in PR #55 is unchanged; live-browser error reproduction/verification remains a separate check.

## BUSY positioning

BUSY already offers broad GST, POS, batch, inventory, ERP reports, integrations and configurable price lists. Atlas OS should prioritize a noticeably faster distributor first-run journey: find or create an item without changing screens, enter actual cartons/loose units from a lorry, review draft, post once, see immediate stock and source-specific price history. Differentiate through **measurable reduction in steps/errors**, modern keyboard-first use and transparent approval/audit trails—not unsupported claims of feature parity.

## Extended gap closure — Atlas OS 4 five-item audit (November 11, 2026)

| User-reported gap | Code/evidence in this PR or earlier | Remaining limitation |
|---|---|---|
| Company/supplier price changes | PR57 append-only quoted and posted purchase rates; receiving now fetches **last recorded supplier rate for the specific supplier/product as of receipt date** and highlights ≥5% change next to current entry | Supplier/manufacturer notices must still be entered manually. No upstream automatic polling; no selling-price rewrite |
| Google-style stock and selling autocomplete | Existing retail counter and Ctrl+K results; PR58 receiving autocomplete; **catalog page now offers clickable/keyboard product suggestions** (name, SKU, brand, HSN, stock and selling price) with stale-request guarding | Quotation and order editors retain their older selection UI and should be upgraded separately |
| Notepad / spreadsheet receiving | Four-column mixed-carton TSV or **five-column Product, Cases, Units/case, Loose, Rate**, optional header, up to 50 product rows, exact SKU or unique exact name. Lookup runs in five-request batches, validates all before replacing worksheet | Unknown products require in-place creation first; automatic fuzzy product master creation is deliberately prohibited |
| Stock Movements errors | PR55 composite product foreign-key embed. New restricted fallback for PostgREST relationship cache errors (`PGRST200/PGRST201`) returns the **same RLS-scoped stock movements without join**. Page keeps movements visible when separate product catalog fetch fails; non-relationship/permission errors still show retryable failures | Live authenticated browser session verification is still required |
| BUSY differentiation | Fewer operator context switches: lookup → new product as needed → cases/variable cartons → compare supplier rate → draft → explicit atomic post → stock & source-specific price history | No unsupported claims of parity for batch/expiry, full finance, supplier payable and BUSY data migrations |

No financial ledger, inventory authority, RLS or production data is modified by these UI/read-only improvements. New tests cover five-column notebook parsing, tenant-scoped retry failure behavior, independent stock-ledger rendering, and contextual rate advisory.
