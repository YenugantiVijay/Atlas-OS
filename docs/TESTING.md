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
