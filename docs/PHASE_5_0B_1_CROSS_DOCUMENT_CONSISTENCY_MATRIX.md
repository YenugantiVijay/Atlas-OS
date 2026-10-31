# PHASE 5.0B.1 — CROSS-DOCUMENT CONSISTENCY MATRIX
## Systematic Adversarial Reconciliation of Phase 5.0B Specifications across Governance, RBAC, Multi-Branch, Approvals, and Concurrency Contracts
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Cross-Specification Consistency & Reconciliation Matrix — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Master Consistency & Cross-Reference Matrix

This matrix maps every inter-document dependency across the Phase 5.0B architecture suite, identifying contradictions, ambiguities, missing invariants, and technical reconciliations:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                   CROSS-DOCUMENT ARCHITECTURAL CONSISTENCY MATRIX                                                      │
├─────────┬────────────────────────┬────────────────────────┬────────────────────────────────────────────────┬───────────────────────────────────────────┤
│ Issue ID│ Source Document(s)     │ Target Document(s)     │ Architectural Inconsistency / Discrepancy      │ Definitive Engineering Reconciliation     │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-01**│ Doc 1 (Ownership)      │ Doc 6 (Database Sec)   │ **Index Enforces $\le 1$, NOT $= 1$ Primary:** │ Add deferred constraint trigger           │
│         │ Section 3.2            │ Section 3.1            │ Partial unique index on `PRIMARY_OWNER` allows │ `trg_assert_primary_owner_exists` to      │
│         │                        │                        │ an org to have 0 Primary Owners.               │ assert count = 1 at transaction commit.   │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-02**│ Doc 1 (Ownership)      │ Doc 2 (RBAC)           │ **Missing Foreign Key to Memberships:**        │ Add compound foreign key on               │
│         │ Section 3.2            │ Section 4.1            │ `organization_ownership` stores bare `user_id`;│ `organization_ownership(org_id, user_id)` │
│         │                        │                        │ user could be deleted/deactivated in member-   │ referencing `memberships(org_id, user_id)`.│
│         │                        │                        │ ships while remaining Primary Owner in DB.     │                                           │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-03**│ Doc 4 (Approvals)      │ Doc 6 (Database Sec)   │ **Lock Inversion Risk in Approval Path:**      │ Formalize `approval_requests` at          │
│         │ Section 6.2            │ Section 3.1            │ Path 1: Invoices (L3.5) -> Approvals (L3.2);   │ **Level 3.2**; require consistent order:  │
│         │                        │                        │ Path 2: Approvals (L3.2) -> Invoices (L3.5).   │ Org (L2) -> Appr (L3.2) -> Inv (L3.5).    │
│         │                        │                        │ Classical circular wait deadlock (`40P01`)!    │                                           │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-04**│ Doc 3 (Multi-Branch)   │ Migration 010          │ **Sequence Number Uniqueness Collision:**      │ Update `document_sequences` constraint    │
│         │ Section 5.1            │ (Committed Code)       │ Mig 010 enforces sequence uniqueness on org    │ to include nullable `branch_id`:          │
│         │                        │                        │ level; parallel branch GST sequences block!    │ `UNIQUE(org_id, doc_type, branch_id, FY)`.│
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-05**│ Doc 4 (Approvals)      │ Doc 7 (Master ADR)     │ **Unapproved Approval Thresholds:**            │ Explicitly label ₹25K/₹100K/₹500K values  │
│         │ Section 3.1            │ Section 2              │ Numerical monetary thresholds were stated as   │ as **configurable template defaults**     │
│         │                        │                        │ confirmed rather than configurable defaults.   │ requiring Product Owner sign-off.         │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-06**│ Doc 5 (Recovery)       │ Doc 7 (Master ADR)     │ **Unapproved Recovery Parameters:**            │ Decouple the principle of Verified Recov- │
│         │ Section 3.2            │ Section 2              │ 14-day time-lock and 66% quorum were repre-    │ ery (DEC-12) from specific numerical      │
│         │                        │                        │ sented as fixed decisions instead of proposals.│ parameters (14 days, 66% quorum).         │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-07**│ Doc 1 (Ownership)      │ Doc 5 (Account Life)   │ **Unclear Inactive Owner Transition:**         │ Inactive owner is demoted to `admin` or   │
│         │ Section 5.2            │ Section 3.3            │ When recovery executes, does incumbent Primary │ `inactive_owner` in `org_ownership`;      │
│         │                        │                        │ Owner retain Co-Owner status or get revoked?   │ membership marked `is_active = FALSE`.    │
├─────────┼────────────────────────┼────────────────────────┼────────────────────────────────────────────────┼───────────────────────────────────────────┤
│ **X-08**│ Doc 2 (RBAC)           │ Doc 1 (Ownership)      │ **Terminology Ambiguity on "Owner Role":**     │ Reconcile: `role = 'owner'` is retained   │
│         │ Section 4.1            │ Section 4              │ Doc 1 says ownership is decoupled; Doc 2 still │ purely for backward compatibility, mapped │
│         │                        │                        │ references legacy `'owner'` in role check.     │ internally to `system_admin` + ownership. │
└─────────┴────────────────────────┴────────────────────────┴────────────────────────────────────────────────┴───────────────────────────────────────────┘
```

---

## 2. In-Depth Reconciliation of Critical Inconsistencies

### 2.1 Issue X-01: Enforcement of the "Exactly One Primary Owner" Invariant
- **The Problem:** In `PHASE_5_0B_OWNERSHIP_GOVERNANCE_DESIGN.md` Section 3.2, the schema enforces:
  ```sql
  CREATE UNIQUE INDEX idx_single_primary_owner_per_org 
  ON public.organization_ownership(organization_id) 
  WHERE ownership_tier = 'PRIMARY_OWNER';
  ```
  A PostgreSQL partial unique index only guarantees that the number of matching rows is $\le 1$. It **does not guarantee that an active organization has $\ge 1$ Primary Owner**.
- **The Risk:** If a faulty transaction deletes the Primary Owner row or an import script creates an organization without inserting into `organization_ownership`, the organization enters an ownerless state with zero database errors.
- **Definitive Reconciliation:**
  1. Maintain the partial unique index to enforce $\le 1$ with B-tree performance.
  2. Deploy a deferred constraint trigger on `public.organizations`:
     ```sql
     CREATE OR REPLACE FUNCTION public.trg_assert_primary_owner_invariant()
     RETURNS TRIGGER LANGUAGE plpgsql AS $$
     DECLARE v_count INT;
     BEGIN
         IF NEW.is_active THEN
             SELECT COUNT(*) INTO v_count
             FROM public.organization_ownership
             WHERE organization_id = NEW.id AND ownership_tier = 'PRIMARY_OWNER';
             
             IF v_count <> 1 THEN
                 RAISE EXCEPTION 'INVARIANT_VIOLATION: Organization % must have exactly one Primary Owner (Found: %)', NEW.id, v_count
                     USING ERRCODE = '23514';
             END IF;
         END IF;
         RETURN NEW;
     END;
     $$;

     CREATE CONSTRAINT TRIGGER trg_check_org_primary_owner
         AFTER INSERT OR UPDATE ON public.organizations
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION public.trg_assert_primary_owner_invariant();
     ```
  3. Deploy a complementary deferred trigger on `public.organization_ownership` checking the same condition on `UPDATE` or `DELETE`.

---

### 2.2 Issue X-02: Relationship Between Ownership and Membership
- **The Problem:** In Document 1, `organization_ownership` has `user_id UUID NOT NULL` but lacks a foreign key to `memberships`. In Document 2, a user can be deactivated in `memberships` (`is_active = FALSE`).
- **The Contradiction:** A Primary Owner could have their membership deactivated by an administrator or through a bug, leaving them with legal Primary Ownership in `organization_ownership` but blocked from logging in or passing tenant RLS in `memberships`.
- **Definitive Reconciliation:**
  1. Add compound foreign key constraint:
     ```sql
     ALTER TABLE public.organization_ownership
     ADD CONSTRAINT fk_org_ownership_membership
     FOREIGN KEY (organization_id, user_id)
     REFERENCES public.memberships(organization_id, user_id)
     ON DELETE RESTRICT;
     ```
  2. Add an invariant trigger on `public.memberships`:
     ```sql
     -- Prevents deactivating a user who is currently the Primary Owner
     IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
         IF EXISTS (
             SELECT 1 FROM public.organization_ownership
             WHERE organization_id = NEW.organization_id 
               AND user_id = NEW.user_id 
               AND ownership_tier = 'PRIMARY_OWNER'
         ) THEN
             RAISE EXCEPTION 'Cannot deactivate membership: User is the active Primary Owner. Transfer ownership first.'
                 USING ERRCODE = '23514';
         END IF;
     END IF;
     ```

---

### 2.3 Issue X-03: The Approval / Financial Document Lock Inversion Deadlock
- **The Problem:** 
  - Path 1 (`create_invoice_with_items`): Client submits high-value invoice. Function creates invoice row (`L3.5`), determines approval is needed, and inserts `approval_requests` (`L3.2`).
  - Path 2 (`submit_approval_decision`): Approver reviews request. Function locks `approval_requests` (`L3.2`) to record decision, then updates `invoices` (`L3.5`) status to `ISSUED`.
  - **Deadlock Condition:** If Path 1 locks Invoice $I$ and prepares to write Request $R$, while concurrent Path 2 locks Request $R$ and attempts to lock Invoice $I$, PostgreSQL raises error `40P01 (deadlock_detected)`!
- **Definitive Reconciliation:**
  Standardize the lock acquisition order across **ALL** approval-bearing workflows:
  ```
  Level 2.0 (organizations FOR UPDATE)
      │
      ▼
  Level 3.2 (approval_requests FOR UPDATE)
      │
      ▼
  Level 3.5 (Commercial Documents: invoices / sales_orders FOR UPDATE)
  ```
  In `create_invoice_with_items`: The transaction pre-evaluates whether approval is required. If required, it reserves the approval slot at Level 3.2 *before* acquiring row locks on related document headers, strictly preserving the descending lock graph.

---

### 2.4 Issue X-04: Multi-Branch Document Sequence Collisions
- **The Problem:** In `010_robust_document_numbering_sequences.sql`, sequence uniqueness is enforced globally per tenant:
  ```sql
  CONSTRAINT uq_document_sequences_org_type_fy UNIQUE (organization_id, document_type, financial_year)
  ```
  In Document 3, multi-branch operations specify that branches may issue their own distinct invoice number series (e.g., `INV/DEL/...` vs `INV/MUM/...`).
- **Definitive Reconciliation:**
  Update `document_sequences` schema to support optional branch partitioning:
  ```sql
  ALTER TABLE public.document_sequences 
  ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT;

  ALTER TABLE public.document_sequences 
  DROP CONSTRAINT IF EXISTS uq_document_sequences_org_type_fy;

  -- Nullable branch_id: NULL represents central organization-wide sequence; UUID represents branch sequence
  CREATE UNIQUE INDEX uq_doc_seq_org_branch_type_fy 
  ON public.document_sequences(organization_id, document_type, financial_year, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
  ```

---

## 3. Summary of Reconciled Design Principles

By addressing issues `X-01` through `X-08`:
1. The **Primary Owner Invariant** is promoted from a passive partial index to an active, database-enforced deferred assertion ($= 1$).
2. The **Ownership-Membership Link** is cemented via compound foreign key and mutual deactivation locks.
3. The **Global Lock Hierarchy** is updated to include `approval_requests` at Level 3.2, mathematically eliminating the last remaining deadlock vector.
4. Numerical parameters (thresholds, time-locks, quorums) are cleanly separated from confirmed architectural principles.
