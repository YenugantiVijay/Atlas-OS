# Atlas OS — Editions, Navigation, and Commercial Entitlements

Status: **Two-edition website presentation + simpler navigation implemented; paid-plan enforcement NOT implemented**.
Source of truth: `docs/ATLAS_OS_MASTER_FEATURE_REGISTER.md`.

## Approved product structure

The Atlas OS user experience has two independent axes:

| Axis | Choices | Meaning | Security authority |
|---|---|---|---|
| Workspace layout | **Simple View / Full Navigation** | Controls how authorized navigation is grouped and displayed. A user with Professional features may prefer Simple View. | Existing permissions and database RLS remain the same. |
| Commercial edition | **Atlas Essentials / Atlas Professional** | Determines which paid modules an organization has acquired when commercial billing is implemented. | Server-verified organization entitlement, not browser state. |

Do **not** use `localStorage` workspace view to grant modules, change permissions, or decide whether an API can run. Do **not** infer an entitlement from a price card or a query-string `tier` parameter.

## Intended commercial positioning

- **Atlas Essentials** — smaller electrical/electronics/hardware shops that want reliable products, basic stock, orders, invoices, payments, customers and everyday reports.
- **Atlas Professional** — distributors with quotations, more complex order workflows, receivables, allocations, audit and advanced financial reports; more specialized purchasing, credit and automation capabilities are **planned**, not current guarantees.
- **Enterprise requirements** — handle as a conversation / design request until multi-branch governance, approval hierarchies, dedicated deployments, SLAs and support operations are built and tested.

No approved prices, seat caps, product limits, discounts, release dates, or service-level guarantees exist yet. The website must not advertise them as current commitments.

**Security and financial integrity remain the same for all editions**: no edition may relax organization isolation, auditability, backups, tax calculation safety or legal access to historical data.

## Implementation stages

**Stage 1 (now, UI)**:
- Compact navigation layout selector `Simple View / Full Navigation`.
- Simple View has five clearly understood groups: Dashboard, Sales, Inventory, Finance, Settings.
- Sales, Inventory and Finance expand on demand; authorization filters navigation *before* grouping.
- Preference remains per-user, per-organization, demo/cloud isolated.
- Website shows two proposed editions with a clear "pricing to be announced" state and no fake purchase button.
- Existing trial, subscriptions, RLS, and billing behavior are unchanged.

**Stage 2 (after feature dependencies and accounting requirements are signed off)**:
- Define a versioned edition-to-module capability matrix, including dependencies between modules.
- Add authoritative organization entitlement tables with status, effective/expiry timestamps, and audit history.
- Enforce entitlements server-side in a narrow RPC / trusted backend layer; keep roles, ownership, org eligibility and subscription state separately authoritative.
- Verify failure and downgrade behavior. Disabling a module must not remove access to legally required historical records or break previously issued documents.
- Add billing provider integration only after approval of pricing and renewal policy.
- Add tests: missing/expired entitlement, downgraded subscription, cross-org isolation, inactive membership, bypassed UI, historical record retrieval, race/retry behavior and grace-period policies.
- Make website price claims, checkout and available-plan CTAs live only after backend functionality and real contact-form delivery are tested.

## Seven-step development sequence (retain across all subsequent work)

| Order | Work | Tracking status |
|---|---|---|
| 1 | Master feature register | Complete; update continuously |
| 2 | Report preview inconsistencies | Implemented, CI passed |
| 3 | Independent website CI | Added and verified working |
| 4 | Restore compatible website dependency baseline | Implemented; verify latest website checks |
| 5 | Direct financial-table access review / least-privilege | Pending (SEC-01) |
| 6 | Consistent financial export snapshot | Pending (FIN-01) |
| 7 | Atlas Universal Search | Pending (B2 / F-069 to F-073) |

New sidebar/edition usability work is recorded alongside this sequence but must **not replace steps 5–7**.

## Release rules

- One permanent development branch: `Vijay-Atlas`, integrating to `main` by reviewed PR.
- CI must cover **both** the ERP and independent website on appropriate changes.
- Do not merge a red check or release unverified entitlements.
- Do not alter production Supabase without explicit approval.
- The separate 200-entry Demo Mode stress test stays paused until development completion.
