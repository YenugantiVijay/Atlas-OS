# PR #53 — Atlas OS Retail Counter Workstation & Profile Refinement

**Status:** Design and functional code on `Vijay-Atlas`; CI and merge required. No database migration or hosted deployment.

## What changed

The original draft-only Retail Counter used a two-column stack of large cards and one nested card per product. PR #53 keeps the existing bounded cloud/local search, product master, customer directory and authoritative sales-order service, while rebuilding the visual workflow as a compact counter workstation.

### Retail Counter

- Compact header with a persistent **Draft only** status, not an invoice or payment claim.
- Product search and customer lookup side by side on desktop, stacked on mobile; bounded, debounced, tenant-scoped services are reused.
- F2 focuses product search; **ArrowUp/ArrowDown + Enter** chooses a search result; Tab moves among editable fields; Ctrl+Enter saves a valid draft while focus is within the workstation. The Save Draft button remains fully accessible.
- An accessible, horizontally scrollable billing table includes serial number, product/SKU/brand, HSN (when present), quantity +/- and direct edit, UOM, read-only selling rate, line discount, read-only GST rate, line total, last-known stock and remove.
- Row totals and aggregate subtotal/discount/taxable/GST/grand total use **`summarizePosCart` / `calculateDocumentTotals`**. No second, UI-only tax formula. Discount and quantity update the same underlying cart draft.
- At most 50 product lines and 1,000,000 whole units per line; existing `buildPosOrderDraft` performs validation again at submit.
- Low-stock warning does not imply a stock reservation. The existing confirmation authority rechecks inventory.
- Saved draft returns the authoritative order number and a link to Sales Orders. Failed network retries reuse the same idempotency key until the payload changes.

### Header

- The top-right user trigger now shows avatar, **full user name with a title fallback for narrow widths**, and role. It no longer repeats the organization name in a second cramped chip; the organization is already in its dedicated switcher.
- Click-outside, Escape, full profile menu, edit-profile, org and role actions remain unchanged. No new permissions or navigation routes are introduced.

## Strict scope boundaries

- This is an **editable DRAFT sales-order worksheet**, not retail payment completion, statutory invoicing, printed receipt or stock reduction.
- No direct stock SQL writes; no direct confirmation, GST invoice, payment allocation or automatic credit approval.
- Product selling price, HSN and tax rate are read-only master-data snapshots; altering them or adding unit conversions requires explicit audited domain workflows in later PRs.
- CGST/SGST vs IGST presentation is **not** determined by this UI (supply place/customer state not yet collected here). The worksheet shows total GST only; statutory splits remain for authoritative invoice generation.
- POS search does not yet cover full barcode workflow, frequently sold products or the complete universal-search feature set; PR #54 handles search completion.
- Walk-in customers, held bills, draft recall, purchase/GRN, GST invoice, receipts, multiple units and full-payment/credit policies remain planned.
- The 200-entry Demo Mode industrial test is deliberately paused until project development completion.

## Acceptance

Vitest:
- Existing authoritative order save, idempotent retry, permission denial and invalid-quantity tests retained.
- New billing-grid tests for columns, master-data fields, exact shared money amounts, quantity/discount callbacks, low-stock and disabled state.
- Page tests for product/customer keyboard selection, workspace totals, role guard and draft-only actions.
- Profile test for complete name, duplicate organization removal, role, accessible dropdown and Escape.

Playwright:
- Demo Mode worksheet, product selection and quantity edit.
- Mobile horizontal table scrolling isolated from document.
- Profile control and dropdown.
- Existing ERP E2E and authorization acceptance remain required.

**Release note:** Successful GitHub CI verifies the code and Demo Mode checks, not a new production POS billing/payment journey. Cloud customer search still depends on previously introduced migrations deployed to the target cloud environment.
