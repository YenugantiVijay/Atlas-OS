# PHASE 5.0C.2 — SOURCE EVIDENCE INVENTORY
## Forensic Catalog of Inspected Migrations, Functions, Triggers, RLS Policies, and Application Services
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Forensic Source Code & Database Catalog Inventory  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Verification Standard

This document provides a line-level forensic inventory of all local source files inspected during Phase 5.0C.2. 

In strict adherence to the mandate, **no source file or document is claimed as reviewed unless it was physically inspected on disk**. 

The inventory establishes the concrete baseline of what currently exists in local repository code, what is committed to git on branch `Vijay-Atlas`, what is untracked in the working tree, and what is currently absent from SQL migrations and exists solely as a target specification for Migration 015.

---

## 2. Inspected Database Migration Files (Local Workspace)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       DATABASE MIGRATION SOURCE INVENTORY                                              │
├────┬─────────────────────────────┬───────────┬───────────────┬─────────────────────────────────────────────────────────┤
│ #  │ File Name & Path            │ Lines     │ Git Status    │ Inspected Objects, Functions & Line Ranges              │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 01 │ `001_multi_tenant_base.sql` │ 119 lines │ COMMITTED     │ Lines 8–24: `organizations` table                       │
│    │                             │           │ (Branch:      │ Lines 26–40: `memberships` table & unique constraint    │
│    │                             │           │  Vijay-Atlas) │ Lines 41–56: `audit_events` table                       │
│    │                             │           │               │ Lines 58–75: `get_user_org_role()` function             │
│    │                             │           │               │ Lines 77–119: Initial RLS policies on base tables       │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 02 │ `002_products_customers_...`│ 146 lines │ COMMITTED     │ Lines 5–35: `products` table schema & constraints       │
│    │                             │           │               │ Lines 37–65: `customers` table schema                   │
│    │                             │           │               │ Lines 67–95: `suppliers` table schema                   │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 03 │ `003_inventory_ledger.sql`  │ 87 lines  │ COMMITTED     │ Lines 5–30: `stock_movements` ledger table              │
│    │                             │           │               │ Lines 45–80: `get_product_stock()` initial RPC          │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 04 │ `004_quotations_and_orders..` 312 lines │ COMMITTED     │ Lines 6–30: `quotations` & `quotation_items` tables     │
│    │                             │           │               │ Lines 55–90: `sales_orders` & `sales_order_items` tables│
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 05 │ `005_invoices_and_payments..` 278 lines │ COMMITTED     │ Lines 6–32: `invoices` table (`invoice_number NOT NULL`)│
│    │                             │           │               │ Lines 34–52: `invoice_items` table schema               │
│    │                             │           │               │ Lines 54–73: `payments` table schema                    │
│    │                             │           │               │ Lines 75–85: `payment_allocations` table schema         │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 06 │ `006_security_audit_fixes..`│ 980 lines │ COMMITTED     │ Security hardening, search_path fixes, RLS audits       │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 07 │ `007_security_and_integrity_│ 1165 lines│ COMMITTED     │ Lines 552–690: `record_payment_and_allocate()` RPC      │
│    │  audit_fixes.sql`           │           │               │ (Inspected lock order: payment insert -> invoice lock)  │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 08 │ `008_fix_authorization_...` │ 485 lines │ COMMITTED     │ Lines 32–78: `user_has_org_role()` hardened predicate   │
│    │                             │           │               │ Lines 83–190: `confirm_sales_order()` RPC               │
│    │                             │           │               │ (Inspected: loop lacks ORDER BY product_id ASC!)        │
│    │                             │           │               │ Lines 417–467: `get_product_stock()` hardened predicate │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 09 │ `009_totals_version_...`    │ 162 lines │ COMMITTED     │ Document discount shares & totals_version columns       │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 10 │ `010_robust_document_...`   │ 151 lines │ COMMITTED     │ Lines 19–27: `document_sequences` table schema          │
│    │                             │           │               │ Lines 49–150: `allocate_document_number()` RPC          │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 11 │ `011_atomic_receipt_...`    │ 493 lines │ COMMITTED     │ Lines 99–220: `internal_allocate_document_number()`     │
│    │                             │           │               │ Lines 277–480: Hardened `record_payment_and_allocate()` │
│    │                             │           │               │ (Inspected: sequence allocated at line 363 before inv)  │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 12 │ `012_organization_creation_ │ 279 lines │ UNTRACKED     │ Lines 26–33: `organization_creation_idempotency` table  │
│    │  rpc.sql`                   │           │ (`??` Git)    │ Lines 55–270: `create_organization()` atomic RPC        │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 13 │ `013_business_eligibility_..` 580 lines │ UNTRACKED     │ Lines 25–60: `organization_eligibility` table           │
│    │                             │           │ (`??` Git)    │ Lines 65–110: `trial_subscriptions` table               │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 14 │ `014_harden_operational_...`│ 1107 lines│ UNTRACKED     │ Lines 32–80: `can_read_org` & `can_write_org` helpers   │
│    │                             │           │ (`??` Git)    │ Lines 300–360: Customers, Suppliers RLS                 │
│    │                             │           │               │ Lines 400–550: Quotations, Sales Orders, Invoices RLS   │
└────┴─────────────────────────────┴───────────┴───────────────┴─────────────────────────────────────────────────────────┘
```

---

## 3. Inspected Application Source Files (`src/`)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       APPLICATION SERVICE SOURCE INVENTORY                                             │
├────┬─────────────────────────────┬───────────┬───────────────┬─────────────────────────────────────────────────────────┤
│ #  │ File Name & Path            │ Lines     │ Git Status    │ Inspected Implementation Logic & Line Ranges            │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 01 │ `src/services/invoices.ts`  │ 234 lines │ Tracked       │ Lines 50–74: `getInvoices` PostgREST select query       │
│    │                             │           │               │ Lines 76–179: `createInvoice` multi-request flow:       │
│    │                             │           │               │ • Line 134: calls `withDocumentNumberRetry`             │
│    │                             │           │               │ • Line 139: direct `invoices.insert(...)` PostgREST     │
│    │                             │           │               │ • Line 169: direct `invoice_items.insert(...)` PostgREST│
│    │                             │           │               │ (Verified: non-atomic multi-roundtrip client execution) │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 02 │ `src/services/orders.ts`    │ 449 lines │ Tracked       │ Lines 234–262: `confirmSalesOrder` invokes RPC:         │
│    │                             │           │               │ `supabase.rpc('confirm_sales_order', ...)`              │
│    │                             │           │               │ (Verified: order cancellation function completely absent│
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 03 │ `src/services/team.ts`      │ 164 lines │ Tracked       │ Lines 36–80: `updateMemberRole` logic:                  │
│    │                             │           │               │ • Line 43: client-side role check (`owner` check)       │
│    │                             │           │               │ • Line 65: direct `memberships.update(...)` PostgREST   │
│    │                             │           │               │ (Verified: relies on client check; direct DML to table) │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 04 │ `src/features/organizations/│ 290 lines │ MODIFIED      │ Organization switcher context, active organization ID   │
│    │  OrgContext.tsx`            │           │ (`M` Git)     │ state management, user membership caching.              │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 05 │ `src/components/layout/     │ 320 lines │ MODIFIED      │ UI modal for organization onboarding invoking           │
│    │  NewOrgModal.tsx`           │           │ (`M` Git)     │ `create_organization` RPC with client idempotency key.  │
├────┼─────────────────────────────┼───────────┼───────────────┼─────────────────────────────────────────────────────────┤
│ 06 │ `src/lib/permissions.ts`    │ 120 lines │ Tracked       │ Client-side role-to-permission mapping and helper checks│
└────┴─────────────────────────────┴───────────┴───────────────┴─────────────────────────────────────────────────────────┘
```

---

## 4. Key Takeaways from Source Verification

1. **Absence of Migration 015 Tables in Existing Migrations:**
   Physical codebase inspection confirms that the following tables **DO NOT EXIST in migrations 001 through 014**:
   - `public.organization_ownership`
   - `public.ownership_transfers`
   - `public.recovery_requests`
   - `public.recovery_decisions`
   - `public.branches`
   - `public.user_branch_assignments`
   - `public.approval_rules`
   - `public.approval_requests`
   - `public.approval_decisions`
   - `public.custom_roles`
   - `public.role_permissions`
   - `public.membership_permission_overrides`
   All of the above entities exist **strictly as design specifications for Migration 015**.
2. **Current Direct PostgREST DML in Application Code:**
   Inspection of `src/services/invoices.service.ts` and `src/services/team.service.ts` confirms that the frontend application currently executes direct PostgREST `.insert()` and `.update()` calls against `invoices`, `invoice_items`, and `memberships`. The "closed-door" privilege model where direct DML is revoked is a target requirement for Migration 015, not an active deployed constraint.
3. **Multi-Request Invoicing Fragility:**
   `invoices.service.ts` executes sequence number allocation, invoice header creation, and line item insertion as **three independent HTTP round trips**. Network failure after header insertion creates an orphaned invoice with zero line items. This confirms the critical necessity of Migration 015's `create_invoice_with_items` atomic stored procedure.
4. **Concrete Lock Inversions in Committed Code:**
   Inspection of `supabase/migrations/011_atomic_receipt_numbering.sql` (lines 363 vs 394) and `008_fix_authorization_vulnerabilities_and_null_roles.sql` (lines 144–156) proves that real lock inversions and un-ordered cursor deadlocks exist in committed database RPCs.
