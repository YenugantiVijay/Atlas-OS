# PR #55 — Stock Movements relationship ambiguity fix

**Status:** Code patch prepared and committed to `Vijay-Atlas`. No production or staging database writes, no migration.

## Confirmed evidence — read-only checks (10 November 2026)

The active Supabase project's `public.stock_movements` table has **two** foreign keys pointing to `public.products`:

1. `stock_movements_product_id_fkey`: `(product_id) → products(id)`.
2. `fk_stock_movements_product_org`: `(product_id, organization_id) → products(id, organization_id)` with `ON DELETE RESTRICT`.

The frontend `src/services/inventory.service.ts` issued `.select('*, products(*)')` in **two** code paths. This is ambiguous to PostgREST when multiple FK relationships exist, causing a potential `PGRST201` error (multiple choices). The exact error from the user's browser has **not** been supplied or reproduced with a real authenticated session; this is a strongly supported likely root cause, not a claim of a live incident reproduction.

## Corrective change

Both reads now use the same explicitly tenant-consistent embedded relationship:

```ts
const STOCK_MOVEMENT_WITH_PRODUCT_SELECT =
  '*, products:products!fk_stock_movements_product_org(*)';
```

- Ledger read: `getStockMovements(orgId, productId?, isMockAuth?, pagination?)`, retains `.eq('organization_id', orgId)`, optional product filter, reverse chronological order and existing bounded 100-row default/page logic.
- Post-adjustment read: `adjustStock` still invokes only `record_stock_adjustment` for the write; the subsequent lookup by returned movement ID uses the explicitly selected FK.
- Alias `products:` preserves the `mapDbStockMovement(row).product` behavior for product name, SKU, UOM, and the visible Inventory Movement Ledger.
- No stock movement insert, update, delete, sequence, GRN, valuation, receipt, or inventory balance changes.
- Existing authenticated membership/RLS gates still govern both `stock_movements` and the embedded `products` record; the selected composite key additionally conveys the intended org relationship.

## Verification

New `src/services/inventory-movement-join.test.ts` covers:

- The exact composite-FK embedding contract for ledger and post-adjustment lookup.
- Organization filter, product filter, newest-first order, bounded default and pagination.
- Mapping of joined product data and numeric quantities.
- Empty/error handling without fake success.
- Single invocation of atomic adjustment RPC; look-up-only follow-up; previously generated movement ID retained if the follow-up lookup fails.
- Null product embed does not crash mapping when RLS hides product data.

CI gate: root ESLint, TypeScript, disposable PostgreSQL acceptance, Vitest, production build and Playwright. Do **not** mark production verified from mocked browser tests alone.

## After CI merge — operator smoke test

1. Pull latest `main` locally and rebuild/run Atlas OS.
2. Sign in to an **authorized** organization with at least one real stock movement.
3. Open **Inventory → Stock Movements**. The ledger should load the product name, SKU, quantity, reference and timestamp without the ambiguous-relationship error.
4. Apply a safe adjustment **only in an approved staging/test organization** (with audit reason and authorized role), then confirm the movement appears exactly once.
5. As an unauthorized organization/user, verify no other tenant's movements can be read.
6. If the page still fails, capture browser console/network response (HTTP code, PostgREST `code` and `message`; redact authorization headers/tokens) to isolate a separate fault.

**Production live stock adjustments are not part of this PR or its acceptance.** The user-requested 200-entry industrial Demo Mode test remains paused until project development is complete.

## Follow-up backlog

- Supplier-wise price history and rate updates (do not overwrite valuation).
- Notepad/spreadsheet-style multi-product receiving with variable carton content.
- Authorized GRN posting, batch/expiry where relevant, and stronger product/stock suggestions.
