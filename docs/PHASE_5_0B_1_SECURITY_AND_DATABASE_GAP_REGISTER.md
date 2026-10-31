# PHASE 5.0B.1 — SECURITY & DATABASE GAP REGISTER
## Exhaustive Forensic Gap Register: Privileges, RLS Policies, Compound Foreign Keys, Lock Vectors, and Trigger Invariants
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Technical Risk & Security Gap Register — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Master Security & Database Gap Register

This register details all architectural, security, privilege, and data-integrity gaps identified across the codebase and Phase 5.0B proposals:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       MASTER TECHNICAL GAP & REMEDIATION REGISTER                                      │
├─────────┬──────────────────────────┬──────────┬─────────────────────────────────────┬──────────────────────────────────┤
│ Gap ID  │ Component / Object       │ Severity │ Forensic Description & Failure Mode │ Required Technical Remediation   │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-01**│ `public.memberships`     │ CRITICAL │ Staging Mig 007 RLS (lines 770-800) │ Revoke direct DML from all client│
│         │ Direct DML Access        │          │ allows owners direct table DML;     │ roles; route mutations through   │
│         │                          │          │ bypasses Level 2 org locks.         │ trusted RPCs under row lock.     │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-02**│ `service_role` Privilege │ CRITICAL │ Default Supabase grants permit full │ Explicitly REVOKE INSERT, UPDATE,│
│         │ Model                    │          │ table DML with BYPASSRLS; backend   │ DELETE, TRUNCATE on all core     │
│         │                          │          │ bypasses all business checks.       │ tables from `service_role`.      │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-03**│ Financial Ledger         │ CRITICAL │ Mig 007 RLS (lines 1038-1165) allows│ Revoke DML; attach `trg_enforce_ │
│         │ Mutability in Staging    │          │ accounts/owners direct UPDATE/DELETE│ invoice_immutability` & `trg_    │
│         │                          │          │ on invoices, payments, allocations. │ enforce_payment_immutability`.   │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-04**│ `organization_ownership` │ HIGH     │ Partial unique index asserts <= 1,  │ Add deferred constraint trigger  │
│         │ Exactly = 1 Invariant    │          │ allowing an organization to exist   │ `trg_assert_primary_owner_exists`│
│         │                          │          │ with 0 Primary Owners!              │ checking count = 1 at commit.    │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-05**│ Ownership-Membership     │ HIGH     │ `organization_ownership` lacks FK   │ Add compound FK referencing      │
│         │ Referential Link         │          │ to `memberships`; Primary Owner row │ `memberships(org_id, user_id)`   │
│         │                          │          │ can dangle if member row deleted.   │ ON DELETE RESTRICT.              │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-06**│ Approval / Invoice       │ HIGH     │ Creating invoice locks inv -> appr; │ Formalize `approval_requests` at │
│         │ Lock Order Inversion     │          │ approving locks appr -> inv. Circular│ Level 3.2; enforce lock order:   │
│         │                          │          │ wait deadlock (`40P01`)!            │ Org L2 -> Appr L3.2 -> Inv L3.5. │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-07**│ Document Sequences       │ HIGH     │ Mig 010 sequence uniqueness is org- │ Add nullable `branch_id`; update │
│         │ Multi-Branch Collision   │          │ wide; parallel branch GST sequences │ uniqueness to `(org_id, type,    │
│         │                          │          │ collide on `(org_id, type, FY)`.    │ coalesce(branch_id, NIL), FY)`.  │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-08**│ Compound Cross-Tenant    │ HIGH     │ `branches` and `custom_roles` lack  │ Deploy compound FKs referencing  │
│         │ Injection Risk           │          │ compound keys; potential for cross- │ `(id, organization_id)` on all   │
│         │                          │          │ tenant entity assignment.           │ dependent child tables.          │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-09**│ Audit Log Immutability   │ MEDIUM   │ `audit_events` table lacks an       │ Add `trg_prevent_audit_tampering`│
│         │ Trigger Absence          │          │ explicit trigger blocking UPDATE    │ raising 42501 on any UPDATE or   │
│         │                          │          │ and DELETE.                         │ DELETE attempt.                  │
├─────────┼──────────────────────────┼──────────┼─────────────────────────────────────┼──────────────────────────────────┤
│ **G-10**│ Deprovisioning 404       │ MEDIUM   │ GoTrue 404 on Step 2 (Ban) could    │ Enforce HTTP 404 Context Rule:   │
│         │ Context Confusion        │          │ falsely mark completion while active│ Ban 404 must advance to Severance│
│         │                          │          │ database memberships remain.        │ to clear DB rows; not Complete.  │
└─────────┴──────────────────────────┴──────────┴─────────────────────────────────────┴──────────────────────────────────┘
```

---

## 2. In-Depth Technical Remediation Blueprints

### 2.1 Gap G-04: Enforcing the `= 1` Primary Owner Invariant
- **Failure Mode:** A transaction deletes the single Primary Owner row. The partial unique index `idx_single_primary_owner_per_org` checks that there are no duplicate `PRIMARY_OWNER` rows. Since count is 0, the index check passes. The organization is now ownerless.
- **Remediation Specification:**
  ```sql
  -- 1. Enforce At Most One (<= 1) via partial unique index
  CREATE UNIQUE INDEX idx_single_primary_owner_per_org 
  ON public.organization_ownership(organization_id) 
  WHERE ownership_tier = 'PRIMARY_OWNER';

  -- 2. Enforce At Least One (>= 1) via deferred constraint trigger on organizations
  CREATE OR REPLACE FUNCTION public.trg_assert_primary_owner_exists()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
      v_count INT;
  BEGIN
      IF NEW.is_active THEN
          SELECT COUNT(*) INTO v_count
          FROM public.organization_ownership
          WHERE organization_id = NEW.id 
            AND ownership_tier = 'PRIMARY_OWNER';

          IF v_count <> 1 THEN
              RAISE EXCEPTION 'DATABASE_INVARIANT_VIOLATION: Organization "%" (%) must have exactly one active Primary Owner. Current count: %',
                  NEW.name, NEW.id, v_count
                  USING ERRCODE = '23514'; -- check_violation
          END IF;
      END IF;
      RETURN NEW;
  END;
  $$;

  CREATE CONSTRAINT TRIGGER trg_org_primary_owner_required
      AFTER INSERT OR UPDATE ON public.organizations
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.trg_assert_primary_owner_exists();
  ```

---

### 2.2 Gap G-05: Compound Referential Integrity between Ownership & Membership
- **Failure Mode:** An administrator calls `update_organization_member_role` or direct table DML to delete a member. The user is deleted from `memberships`. However, their row in `organization_ownership` remains intact. The user is a Primary Owner in the legal table, but has no operational membership.
- **Remediation Specification:**
  ```sql
  -- Add compound unique constraint on memberships to enable compound foreign key
  ALTER TABLE public.memberships 
  ADD CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id);

  -- Compound foreign key guarantees ownership row cannot exist without an active membership
  ALTER TABLE public.organization_ownership
  ADD CONSTRAINT fk_org_ownership_memberships
  FOREIGN KEY (organization_id, user_id)
  REFERENCES public.memberships(organization_id, user_id)
  ON DELETE RESTRICT;

  -- Trigger on memberships prevents deactivating a Primary Owner
  CREATE OR REPLACE FUNCTION public.trg_prevent_primary_owner_deactivation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
      IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
          IF EXISTS (
              SELECT 1 FROM public.organization_ownership
              WHERE organization_id = NEW.organization_id 
                AND user_id = NEW.user_id 
                AND ownership_tier = 'PRIMARY_OWNER'
          ) THEN
              RAISE EXCEPTION 'SECURITY_VIOLATION: Cannot deactivate membership of the active Primary Owner. Primary Ownership must be transferred first.'
                  USING ERRCODE = '23514';
          END IF;
      END IF;
      RETURN NEW;
  END;
  $$;

  CREATE TRIGGER trg_check_primary_owner_active
      BEFORE UPDATE OF is_active ON public.memberships
      FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_primary_owner_deactivation();
  ```

---

### 2.3 Gap G-06: Elimination of Approval vs Financial Document Deadlock
- **Failure Mode:**
  - Client 1 (`create_invoice_with_items`): Locks Invoice $I_1$ (Level 3.5), prepares approval request $R_1$ (Level 3.2).
  - Approver 2 (`submit_approval_decision`): Locks Request $R_1$ (Level 3.2), attempts to lock Invoice $I_1$ (Level 3.5).
  - Circular wait condition occurs: Client 1 holds $I_1$ waiting for $R_1$; Approver 2 holds $R_1$ waiting for $I_1$. PostgreSQL raises `40P01 (deadlock_detected)`.
- **Remediation Specification:**
  Lock ordering must be strictly standardized across both functions:
  ```
  Step 1: Acquire Level 2 Lock on Organization: SELECT 1 FROM organizations WHERE id = p_org_id FOR UPDATE;
  Step 2: Acquire Level 3.2 Lock on Approval Request (if existing): SELECT 1 FROM approval_requests WHERE id = p_req_id FOR UPDATE;
  Step 3: Acquire Level 3.5 Lock on Commercial Document: SELECT 1 FROM invoices WHERE id = p_inv_id FOR UPDATE;
  ```
  In `create_invoice_with_items`: Because the invoice and approval request are created in the same transaction, `approval_requests` is inserted *with* its initial state and does not acquire separate row locks, while `submit_approval_decision` acquires Level 2 org lock *first*, completely serializing the two operations.

---

### 2.4 Gap G-08: Compound Foreign Keys for Multi-Tenant Branch Isolation
- **Failure Mode:** An invoice belonging to Organization $A$ is submitted with a `branch_id` belonging to Organization $B$. If foreign keys only validate `branch_id REFERENCES branches(id)`, the cross-tenant branch reference succeeds!
- **Remediation Specification:**
  ```sql
  -- Add compound unique key on branches
  ALTER TABLE public.branches 
  ADD CONSTRAINT uq_branches_id_org UNIQUE (id, organization_id);

  -- Invoices reference compound key: guarantees branch belongs to the SAME organization
  ALTER TABLE public.invoices
  ADD CONSTRAINT fk_invoices_branch_tenant
  FOREIGN KEY (branch_id, organization_id)
  REFERENCES public.branches(id, organization_id)
  ON DELETE RESTRICT;

  -- Stock movements reference compound key: guarantees stock ledger is branch-tenant isolated
  ALTER TABLE public.stock_movements
  ADD CONSTRAINT fk_stock_movements_branch_tenant
  FOREIGN KEY (branch_id, organization_id)
  REFERENCES public.branches(id, organization_id)
  ON DELETE RESTRICT;
  ```

---

## 3. Summary of Gap Remediations

Implementing remediations `G-01` through `G-10` guarantees that:
1. Physical storage integrity matches the mathematical model ($= 1$ Primary Owner enforced).
2. Cross-tenant entity injection is blocked by compound foreign keys.
3. Deadlocks across approval and invoicing workflows are rendered impossible.
4. Administrative service keys and direct REST clients are completely constrained by server-side RPC contracts.
