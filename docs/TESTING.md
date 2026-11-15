# ATLAS OS — Testing Strategy & Quality Gates

## 1. Quality Gates

Before any milestone is declared complete, the following gates must be met:
1. `npm run typecheck` — Strict TypeScript compile passes without errors.
2. `npm test` — Vitest unit and integration suite passes.
3. `npm run build` — Production Vite bundle compiles cleanly.
4. Tenant isolation verified (cross-tenant access rejected).
5. Transactional inventory safeguards verified (stock cannot go negative via standard orders).

## 2. Test Suites

### Unit Tests
- Financial math (`src/lib/money.test.ts`): tax calculation, discount allocation, rounding rules, integer/decimal conversions.
- Permission engine (`src/lib/permissions.test.ts`): RBAC matrix enforcement across roles.
- Validation schemas (`src/lib/validation.test.ts`): input validation for products, customers, orders, payments.

### Integration / Engine Tests
- Atomic order confirmation: checks available stock, deducts via movements, prevents double confirmation.
- Payment allocation: prevents overpayments, calculates remaining receivables accurately.
- Multi-tenant boundary verification: confirms queries with Org A credentials cannot leak Org B records.

## 3. Hosted migration history

From the intended release checkout, export a fresh list of applied migrations for the target project using the [Supabase Management API migration history endpoint](https://supabase.com/docs/reference/api/v1-list-migration-history) or the Supabase list-migrations connector. Keep the project reference and capture time with the release evidence. Save only the migration history rows as JSON, then run:

```sh
npm run check:migrations -- /path/to/staging-migration-history.json
```

The checker reads the release checkout and supplied history. It fails on missing, unexpected, duplicate, malformed, or out-of-order entries. It accepts the historical naming conventions where Supabase recorded a timestamp different from the filename prefix. CI tests the checker against fixtures and the current checked-in filenames. Hosted release verification uses a fresh export because CI does not connect to a hosted database. Record the result with the release commit. Migration history confirms recorded application order. Check deployed SQL definitions and run the staging workflow tests to verify runtime behavior.
