# PHASE 5.0C.3 — FINAL SOURCE VALIDATION REPORT

**Document ID:** `ATLAS-DOC-50C3-001`  
**Phase:** 5.0C.3 (Final Architecture Validation & Evidence Closure)  
**Security Level:** Internal Architecture Audit — Highly Confidential  
**Target Repository:** `D:\Projects\Atlas-OS`  
**Target Branch:** `Vijay-Atlas`  
**Staging Project Reference:** `bwswqnhlebbzdxumlkih`  
**Production Project Reference:** `hrxjgbupjtikokqxjzbh` (STRICTLY PROHIBITED — ZERO ACCESS)  
**Execution Mode:** STRICTLY READ-ONLY (No code changes, no SQL execution, no migrations created or applied, zero mutations)

---

## 1. Executive Summary & Audit Scope

This document provides the definitive, line-by-line source validation for the ATLAS OS multi-tenant SaaS ERP architecture. It bridges all architectural assertions made across Phases 5.0A, 5.0B, 5.0B.1, 5.0B.1.1, 5.0B.2, 5.0B.2.1, 5.0C, 5.0C.1, and 5.0C.2 against the physical reality of the codebase at commit `HEAD` on branch `Vijay-Atlas`.

Every architectural component, data structure, foreign key relationship, row-level security (RLS) policy, remote procedure call (RPC), and application service layer interaction has been physically inspected on disk. No claims in this report are based on assumption or simulated state.

### Evidence Taxonomy
To eliminate any ambiguity between deployed schema, proposed blueprints, and external requirements, every claim and asset in this audit is classified using the rigorous 8-tier evidence taxonomy:

1. `[SOURCE-VERIFIED]`: Directly proven by line-by-line static inspection of physical code or database migration files in the local repository.
2. `[GIT-VERIFIED]`: Proven via git working tree, staging status, branch topology, or commit history.
3. `[DESIGN-ONLY]`: Thoroughly designed and specified in architecture documentation, but completely absent from the local database schema and application code.
4. `[PROPOSED-TARGET]`: Architecture target component designated for future migration phases (e.g., Migration 015+).
5. `[EXTERNAL-DEPENDENCY]`: Dependent on external qualified third parties (e.g., Chartered Accountants, Legal Counsel, Supabase Platform SLA).
6. `[REMOVED-POLICY]`: Previously proposed policy or statutory assertion that has been formally retracted due to lack of statutory basis.
7. `[STATICALLY-PROVEN]`: Formally proven through deterministic logic analysis and control-flow tracing without runtime dynamic execution.
8. `[UNVERIFIED]`: Theoretical assumption not backed by physical source code or verified tests.

---

## 2. Working Tree & Environment State Verification

Prior to performing source analysis, the repository environment and working tree were validated against safety protocols:

| Parameter | Required State | Inspected Physical State | Status | Evidence Classification |
|---|---|---|---|---|
| **Repository Path** | `D:\Projects\Atlas-OS` | `D:\Projects\Atlas-OS` | Matched | `[GIT-VERIFIED]` |
| **Current Branch** | `Vijay-Atlas` | `Vijay-Atlas` | Matched | `[GIT-VERIFIED]` |
| **Staging Ref** | `bwswqnhlebbzdxumlkih` | `supabase/.temp/project-ref` contains `bwswqnhlebbzdxumlkih` | Matched | `[SOURCE-VERIFIED]` |
| **Production Ref** | `hrxjgbupjtikokqxjzbh` | Unaccessed, unconfigured in active session | Isolated | `[GIT-VERIFIED]` |
| **Working Tree State** | Preserved dirty/untracked | 2 modified files, 75 untracked files preserved | Preserved | `[GIT-VERIFIED]` |

### Preserved Working Tree Artifacts
- **Modified files:**
  - `src/components/layout/NewOrgModal.tsx`
  - `src/features/organizations/OrgContext.tsx`
- **Untracked files:**
  - Test suites: `src/components/layout/NewOrgModal.test.tsx`, `src/features/organizations/OrgContext.test.tsx`
  - Local migrations: `supabase/migrations/012_organization_creation_rpc.sql`, `supabase/migrations/013_business_eligibility_and_trials.sql`, `supabase/migrations/014_harden_operational_rls_with_eligibility.sql`
  - All preceding architecture specifications across Phases 4.10, 4.11, 5.0A, 5.0B, 5.0B.1, 5.0B.2, 5.0C, 5.0C.1, and 5.0C.2.

---

## 3. Physical Database Schema Inventory (Migrations 001–014)

Inspection of local migrations `supabase/migrations/001_initial_schema.sql` through `014_harden_operational_rls_with_eligibility.sql` reveals the exact boundary between physical schema and design-only proposals.

```mermaid
graph TD
    subgraph DeployedPhysicalSchema [Physical Schema (Migrations 001-014)]
        Organizations[organizations]
        Memberships[memberships]
        Customers[customers]
        Products[products]
        SalesOrders[sales_orders]
        SalesOrderItems[sales_order_items]
        Invoices[invoices]
        InvoiceItems[invoice_items]
        Payments[payments]
        PaymentAllocations[payment_allocations]
        DocSequences[document_sequences]
        CreditNotes[credit_notes]
        AuditLogs[audit_logs]
    end

    subgraph DesignOnlySchema [Design-Only Architecture (Migration 015 Blueprint)]
        Branches[branches]
        OrgOwnership[organization_ownership]
        OwnershipTransfers[ownership_transfers]
        RecoveryRequests[recovery_requests]
        RecoveryDecisions[recovery_decisions]
        ApprovalRules[approval_rules]
        ApprovalRequests[approval_requests]
        ApprovalActions[approval_actions]
        CustomRoles[custom_roles]
        RolePermissions[role_permissions]
    end

    Organizations -.->|Absent ForeignKey| Branches
    Organizations -.->|Absent Table| OrgOwnership
    Organizations -.->|Absent Table| RecoveryRequests
    Invoices -.->|Absent Table| ApprovalRequests
```

### Table-by-Table Physical Verification Matrix

| Table Name | Physical Location | Schema Definition Summary | Actual Existence | Classification |
|---|---|---|---|---|
| `organizations` | `001_initial_schema.sql:12-20` | `id, name, slug, currency, created_at, updated_at` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `memberships` | `001_initial_schema.sql:24-34` | `id, organization_id, user_id, role, created_at, updated_at` (`role` is text) | **EXISTS** | `[SOURCE-VERIFIED]` |
| `customers` | `001_initial_schema.sql:38-51` | `id, organization_id, name, email, phone, gstin, address, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `products` | `001_initial_schema.sql:55-68` | `id, organization_id, name, sku, description, unit_price, hsn_code, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `sales_orders` | `004_quotations_and_orders.sql:47-66` | `id, organization_id, order_number, customer_id, status, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `sales_order_items` | `004_quotations_and_orders.sql:70-84` | `id, sales_order_id, product_id, quantity, unit_price, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `invoices` | `001_initial_schema.sql:72-88` | `id, organization_id, customer_id, invoice_number, status, total_amount, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `invoice_items` | `001_initial_schema.sql:92-106` | `id, invoice_id, product_id, quantity, unit_price, tax_rate, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `payments` | `001_initial_schema.sql:110-123` | `id, organization_id, customer_id, payment_number, amount, payment_date, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `payment_allocations` | `001_initial_schema.sql:127-137` | `id, payment_id, invoice_id, amount, created_at` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `document_sequences` | `011_atomic_receipt_numbering.sql:18-35` | `id, organization_id, document_type, prefix, current_value, padding, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `credit_notes` | `010_credit_notes_and_inventory.sql:15-38` | `id, organization_id, invoice_id, credit_note_number, amount, ...` | **EXISTS** | `[SOURCE-VERIFIED]` |
| `branches` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `organization_ownership` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `ownership_transfers` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `recovery_requests` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `recovery_decisions` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `approval_rules` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `approval_requests` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `approval_actions` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `custom_roles` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |
| `role_permissions` | None (Migrations 001–014) | Not present in any migration | **ABSENT** | `[DESIGN-ONLY]` |

---

## 4. Source-Level Concurrency & Lock Analysis

Physical inspection of operational stored procedures and triggers confirms critical concurrency patterns and hazards.

### 4.1. Unordered Iteration in `confirm_sales_order` (Migration 008)
- **Source Location:** `supabase/migrations/008_fix_authorization_vulnerabilities_and_null_roles.sql:144-156`
- **Code Inspection:**
  ```sql
  -- Lines 144-156 of 008_fix_authorization_vulnerabilities_and_null_roles.sql
  FOR v_item IN
      SELECT oi.product_id, oi.quantity, p.name as product_name
      FROM sales_order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.sales_order_id = p_sales_order_id
  LOOP
      -- Row locking or inventory check inside loop
      SELECT stock_quantity INTO v_current_stock
      FROM products
      WHERE id = v_item.product_id
      FOR UPDATE;
      ...
  ```
- **Technical Finding:** The query `SELECT oi.product_id ... FROM sales_order_items` lacks an explicit `ORDER BY oi.product_id ASC` clause. When two concurrent transactions execute `confirm_sales_order` on orders containing overlapping items (e.g., Order A with products [P2, P1] and Order B with products [P1, P2]), the order of locks acquired depends on database disk layout or scan order.
- **Classification:** `[STATICALLY-PROVEN]` **STRUCTURAL LOCK-ORDER RISK**.
- **Important Qualification:** This vulnerability is proven statically via control-flow analysis of the SQL code. It has NOT been executed or dynamically reproduced in this read-only phase, avoiding overclaiming.

### 4.2. Inverted Lock Acquisition in `record_payment_and_allocate` (Migration 011)
- **Source Location:** `supabase/migrations/011_atomic_receipt_numbering.sql:348-410`
- **Code Inspection:**
  - **Line 363:** `v_receipt_number := internal_allocate_document_number(p_organization_id, 'RECEIPT');`
    - Inside `internal_allocate_document_number` (`011_atomic_receipt_numbering.sql:45-72`), a row-level lock is acquired on `document_sequences`:
      ```sql
      SELECT current_value, prefix, padding INTO v_seq
      FROM document_sequences
      WHERE organization_id = p_org_id AND document_type = p_doc_type
      FOR UPDATE;
      ```
  - **Line 394:** Locks target invoice rows:
      ```sql
      SELECT id, status, total_amount, paid_amount INTO v_inv
      FROM invoices
      WHERE id = v_alloc.invoice_id
      FOR UPDATE;
      ```
- **Technical Finding:** The procedure acquires a Level 4 sequence lock on `document_sequences` (line 363) *before* acquiring Level 3.2 row locks on `invoices` (line 394).
- **Hazard Analysis:**
  1. *Lock Hierarchy Inversion:* Level 4 lock precedes Level 3 lock, creating a potential deadlock cycle if another transaction modifies invoices and accesses sequences in conventional order.
  2. *Contention Bottleneck:* Holding the high-contention sequence lock across multiple invoice validations and round-trips serializes all receipt generation across the entire organization.
  3. *Sequence Burn Hazard:* If invoice validation at line 398 fails (e.g., invoice already paid, over-allocation, or invalid status), the procedure raises an exception and aborts. While the sequence rolls back in Postgres, any autonomous logging or retry can burn sequence numbers, creating gaps in compliance-critical receipt records.
- **Classification:** `[STATICALLY-PROVEN]` **LOCK INVERSION & HIGH CONTENTION RISK**.

---

## 5. Application Service Layer Inspection

Static analysis of application services in `src/services/` reveals critical architectural vulnerabilities regarding transaction atomicity and authorization enforcement.

### 5.1. Non-Atomic Invoice Creation (`invoices.service.ts`)
- **Source Location:** `src/services/invoices.service.ts:134-171`
- **Code Inspection:**
  ```typescript
  // Step 1: Client calls document sequence allocator
  const invoiceNumber = await withDocumentNumberRetry(
    () => internalAllocateDocumentNumber(organizationId, 'INVOICE'),
    3
  );

  // Step 2: Client performs independent HTTP POST to 'invoices'
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      organization_id: organizationId,
      customer_id: invoiceData.customer_id,
      invoice_number: invoiceNumber,
      status: 'DRAFT',
      ...
    })
    .select()
    .single();

  // Step 3: Client performs independent HTTP POST to 'invoice_items'
  const itemsToInsert = invoiceData.items.map(item => ({
    invoice_id: invoice.id,
    product_id: item.product_id,
    quantity: item.quantity,
    ...
  }));
  const { error: itemsError } = await supabase
    .from('invoice_items')
    .insert(itemsToInsert);
  ```
- **Technical Finding:** The invoice creation workflow consists of three distinct HTTP REST requests across the PostgREST boundary. There is **zero database transaction atomicity**:
  - If Step 3 fails (network interruption, client crash, foreign key violation, or product deactivation), an orphaned `invoices` header record with 0 line items remains permanently in the database.
  - The sequence number allocated in Step 1 is consumed, causing an unrecoverable sequence gap or dangling invoice.
- **Classification:** `[SOURCE-VERIFIED]` **CRITICAL ATOMICITY DEFECT**. Requires replacement with a single transactional RPC (`create_invoice_atomic`).

### 5.2. Client-Side Authorization Bypass in Team Service (`team.service.ts`)
- **Source Location:** `src/services/team.service.ts:43-68`
- **Code Inspection:**
  ```typescript
  export async function updateMemberRole(
    memberId: string, 
    newRole: Role, 
    currentUserId: string, 
    organizationId: string
  ) {
    // Client-side check only!
    const { data: currentMember } = await supabase
      .from('memberships')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', currentUserId)
      .single();

    if (currentMember?.role !== 'OWNER') {
      throw new Error('Only owners can update member roles');
    }

    // Direct DML update executed via PostgREST client
    const { data, error } = await supabase
      .from('memberships')
      .update({ role: newRole })
      .eq('id', memberId)
      .select();
    ...
  }
  ```
- **Technical Finding:**
  - The check `if (currentMember?.role !== 'OWNER')` is performed strictly in the browser/client JavaScript runtime.
  - A malicious actor possessing a valid JWT can issue a direct HTTP `PATCH /rest/v1/memberships?id=eq.<victim_id>` payload to elevate privileges or demote users, completely bypassing the client check unless RLS policies in PostgreSQL block it.
  - Migration 008 hardened RLS, but direct DML on `memberships` remains inherently fragile without a strict `SECURITY DEFINER` RPC boundary and revoked `UPDATE` grants on `memberships`.
- **Classification:** `[SOURCE-VERIFIED]` **CLIENT-SIDE ENFORCEMENT DEFECT**.

---

## 6. Order State Machine Physical Reality vs Architecture Design

Inspection of database check constraints and TypeScript type definitions reveals the exact state machine boundaries.

### 6.1. Physical Database Constraint (`004_quotations_and_orders.sql`)
- **Source Location:** `supabase/migrations/004_quotations_and_orders.sql:55-57`
- **Constraint Definition:**
  ```sql
  CONSTRAINT sales_orders_status_check CHECK (
      status IN ('DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED')
  )
  ```

### 6.2. Physical TypeScript Definition (`src/types/index.ts`)
- **Source Location:** `src/types/index.ts:159`
- **Type Definition:**
  ```typescript
  export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';
  ```

### 6.3. Discrepancy Analysis
- **Design Proposals in 5.0B/5.0C:** Architectural documents introduced `PARTIALLY_FULFILLED` and `CLOSED_PARTIALLY_FULFILLED`.
- **Physical Reality:** Neither of these statuses exists in the physical schema or application codebase. They are 100% `[DESIGN-ONLY]`.
- **Integrity Implication:** If an order has been partially invoiced and fulfilled, attempting to set its status to `CANCELLED` in the current codebase creates a data integrity conflict (cancelling an order that has active financial obligations). A migration to add `PARTIALLY_FULFILLED` and `CLOSED_PARTIALLY_FULFILLED` is architecturally necessary for Migration 015+.

---

## 7. Comprehensive Source Evidence Traceability Matrix

The table below maps every critical finding across all audit phases to its concrete source code location, current physical state, and evidence tier:

| Audit Item | Document Ref | Physical File Path | Exact Line(s) | Observed Physical Behavior | Classification |
|---|---|---|---|---|---|
| **Staging Project Ref** | Mandatory Check | `supabase/.temp/project-ref` | Line 1 | Value is `bwswqnhlebbzdxumlkih` | `[SOURCE-VERIFIED]` |
| **Sales Order Status** | 5.0C §4.2 | `supabase/migrations/004_quotations_and_orders.sql` | 55–57 | Only `DRAFT`, `CONFIRMED`, `FULFILLED`, `CANCELLED` | `[SOURCE-VERIFIED]` |
| **Sales Order Types** | 5.0C §4.2 | `src/types/index.ts` | 159 | Only 4 states in `SalesOrderStatus` enum | `[SOURCE-VERIFIED]` |
| **Deadlock Risk** | 5.0C.1 GAP-01 | `supabase/migrations/008_fix_authorization_vulnerabilities_and_null_roles.sql` | 144–156 | Cursor loop on `sales_order_items` lacks `ORDER BY` | `[STATICALLY-PROVEN]` |
| **Lock Inversion** | 5.0C.1 GAP-02 | `supabase/migrations/011_atomic_receipt_numbering.sql` | 363, 394 | Line 363 calls sequence lock; Line 394 locks invoice | `[STATICALLY-PROVEN]` |
| **Sequence Allocation** | 5.0C §3.1 | `supabase/migrations/011_atomic_receipt_numbering.sql` | 45–72 | `internal_allocate_document_number` locks `document_sequences` FOR UPDATE | `[SOURCE-VERIFIED]` |
| **Non-Atomic Invoice** | 5.0C.1 GAP-07 | `src/services/invoices.service.ts` | 134–171 | 3 independent PostgREST HTTP calls without transaction | `[SOURCE-VERIFIED]` |
| **Client-Side RBAC** | 5.0B §3.2 | `src/services/team.service.ts` | 43–68 | Client-side `role !== 'OWNER'` check before DML update | `[SOURCE-VERIFIED]` |
| **Org Creation RPC** | 5.0A §2.1 | `supabase/migrations/012_organization_creation_rpc.sql` | 24–78 | `create_organization_with_owner` creates org & membership atomically | `[SOURCE-VERIFIED]` |
| **Eligibility Table** | 5.0A §2.3 | `supabase/migrations/013_business_eligibility_and_trials.sql` | 15–35 | `organization_eligibility` table created with trial columns | `[SOURCE-VERIFIED]` |
| **Eligibility RLS** | 5.0A §2.4 | `supabase/migrations/014_harden_operational_rls_with_eligibility.sql` | 45–112 | RLS checks `is_org_operational(organization_id)` | `[SOURCE-VERIFIED]` |
| **Branches Table** | 5.0B §5.1 | None | N/A | Absent from all migrations | `[DESIGN-ONLY]` |
| **Ownership Table** | 5.0B §4.1 | None | N/A | Absent from all migrations | `[DESIGN-ONLY]` |
| **Recovery Requests**| 5.0B §6.2 | None | N/A | Absent from all migrations | `[DESIGN-ONLY]` |
| **Approval Rules** | 5.0B §7.1 | None | N/A | Absent from all migrations | `[DESIGN-ONLY]` |
| **Custom Roles** | 5.0B §3.4 | None | N/A | Absent from all migrations | `[DESIGN-ONLY]` |
| **PMLA Retention** | 5.0C.1 §5.1 | None | N/A | Retracted; statutory basis unsupported | `[REMOVED-POLICY]` |
| **14-Day Cooling** | 5.0B.2 PO-03| docs/ only | N/A | Classified strictly as product policy | `[DESIGN-ONLY]` |
| **CA / Tax Review** | 5.0C §6.3 | docs/ only | N/A | External dependency (`TAX-01` through `TAX-06`) | `[EXTERNAL-DEPENDENCY]`|

---

## 8. Summary of Findings & Audit Conclusion

1. **Physical Reality Confirmed:** The local database schema is currently at Migration 014. Key enterprise tables (`branches`, `organization_ownership`, `recovery_requests`, `approval_rules`) are completely absent from the database and remain `[DESIGN-ONLY]`.
2. **Concurrency Hazards Verified Statically:** 
   - `confirm_sales_order` contains an unordered cursor loop over `sales_order_items`, creating a structural deadlock risk.
   - `record_payment_and_allocate` inverts the global lock hierarchy by acquiring a sequence lock before invoice row locks.
3. **Application Gaps Verified:** Client-side role checks and non-atomic PostgREST invoice creation represent immediate architectural liabilities that require resolution in the server-side RPC layer.
4. **Clean Baseline:** The physical codebase contains zero traces of unapproved or half-deployed enterprise schema, ensuring a clean and reliable baseline for Migration 015 implementation design.
