# Atlas OS — Essentials Workspace and Industry Expansion Decision

Status: **Essentials navigation implemented on Vijay-Atlas (PR #34); cross-industry product expansion deferred.**
Updated: 2026-11-07

## Customer problem

Different businesses have different operational complexity. A small electrical shop may need
products, stock, customers, invoices, collections and simple reports; a larger hardware
distributor may need quotations, sophisticated order lifecycles, credit control, advanced
reports and team governance. A non-inventory service provider may eventually require a
different product workflow entirely.

**Simple-to-use does not mean weak financial controls.**

## Decision

Build **one Atlas OS platform**, not multiple disconnected ERP codebases.

1. **Essentials workspace**: a focused navigation view showing common workflows the
   current user is already authorized to use.
2. **All Tools workspace**: the complete navigation the user is already authorized to use.
3. **Industry capability profiles** (future): organization configuration controlling which
   modules and workflows are truly supported and relevant. This is distinct from hiding
   navigation and must be enforced in backend permissions and business workflows.
4. **Subscription entitlements** (future): billing and commercial plan configuration; never
   conflate workspace appearance with authorization or paid feature access.

The initial market remains **electrical, electronics and hardware businesses**.
Do not market Atlas OS as supporting arbitrary sectors based solely on Essentials.

## Implemented, safe first increment

- Default Essentials navigation with prominent switch to All Tools.
- User + organization + demo/cloud scoped preference persistence.
- Permissions filtered before constructing either navigation view.
- Existing routes, database RLS, document lifecycle and financial rules unchanged.
- No new database migrations or production data changes.
- Accessible explanation clarifies the difference between the two views.

## Future research and validation, not authorized for implementation now

- Interviews with small shops and distributors: which 3–5 tasks are used daily,
  which screens cause confusion, and what setup time is acceptable?
- Service-only businesses: define non-stock service items, HSN/SAC handling, tax
  applicability, invoice workflows, returns and reporting before enabling support.
- Optional modules: define dependencies and protect historical records when a module
  is disabled or later re-enabled. Do not delete data or silently bypass safeguards.
- Industry-specific requirements: validate with users and qualified legal/tax advisors
  where appropriate before claiming coverage.
- Onboarding wizard: select industry and business needs; provide sensible default
  workspace layout, with reversible changes.
- Feature usage and onboarding metrics: measure task completion, setup friction, and
  whether Essentials genuinely improves usability for actual business operators.

## Release acceptance gates

1. No user sees navigation actions beyond their role's authorized permissions.
2. Switching workspace view never changes RLS, permissions, API access or billing.
3. Preferences cannot leak across users or organizations.
4. Full workflow pages remain accessible via authorized direct links.
5. Responsive, collapsed and expanded sidebar work without overflow.
6. Existing operational and security acceptance tests pass; no regression to invoices,
   stock or payments.
7. Test with representative operators before treating this as production-ready.
8. Scope to current supported sectors until additional industry workflows are proven.

## Near-term sequence

- Review PR #34, verify its latest CI, merge into main after review.
- Continue remaining B1 financial reporting direct-data access and snapshot consistency.
- Finish practical retail, billing, inventory and payment flows for initial sectors.
- Then explore configurable industry modules with explicit product and compliance design.

## Git workflow

Active development: `Vijay-Atlas`; integration: `main`.
Open pull requests from `Vijay-Atlas`, merge reviewed changes into `main`, then
synchronize `Vijay-Atlas` with `main`. Delete stale auxiliary branches only
after verifying changes have been merged and preserving anything still needed.
