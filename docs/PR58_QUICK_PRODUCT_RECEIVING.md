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
