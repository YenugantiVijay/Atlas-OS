# PHASE 4.10.3 — ORGANIZATION OWNERSHIP & MEMBERSHIP INVARIANT AUDIT

## 1. Verified Environment & Read-Only Pre-Flight Checks

This audit was conducted in **STRICTLY READ-ONLY** mode. Zero application files were modified, zero migrations were created or applied, zero database mutations were executed, and zero production systems were accessed.

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas` (verified; uncommitted changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx` preserved untouched).
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (`ATLAS-OS-Staging`). Verified via `supabase/.temp/project-ref`.
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — STRICTLY FORBIDDEN (0 queries executed, 0 network requests initiated).
- **Audit Scope:** Systematic inspection of migrations `001` through `014`, RLS policies on `organizations` and `memberships`, helper functions (`get_user_org_role`, `get_user_organizations`), `team.service.ts`, `TeamPage.tsx`, and `OrgContext.tsx`.

---

## 2. Existing Organization Ownership Model

### 2.1 How Ownership is Represented
Inspection of `supabase/migrations/001_multi_tenant_base.sql` reveals that **the `public.organizations` table contains NO `owner_id` column**:
```sql
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    gstin VARCHAR(15),
    pan VARCHAR(10),
    phone VARCHAR(50),
    email VARCHAR(255),
    address_line1 TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    currency VARCHAR(3) DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
- **Representation:** Ownership is represented **strictly as a membership role** in the `public.memberships` table where `role = 'owner'`.
- **Table Definition (`memberships`):**
  ```sql
  CREATE TABLE IF NOT EXISTS memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
      user_id UUID NOT NULL,
      role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(organization_id, user_id)
  );
  ```

### 2.2 Creation of the First Owner
- In Migration `012_organization_creation_rpc.sql` (`create_organization` RPC), lines 198–213:
  ```sql
  INSERT INTO public.memberships (
      organization_id, user_id, role, is_active, created_at, updated_at
  ) VALUES (
      v_org_id, v_uid, 'owner', true, v_now, v_now
  );
  ```
- **Atomicity:** Initial organization creation and owner membership assignment **are atomic** within the `create_organization` database transaction.

### 2.3 Critical Structural Deficiencies in Existing Schema
1. **Multiple Owners are Permitted:**
   The only uniqueness constraint on `memberships` is `UNIQUE(organization_id, user_id)`. There is **NO unique constraint on `(organization_id, role)`** and **NO partial unique index on `(organization_id) WHERE role = 'owner'`**. An organization can currently have 2, 5, or 10 simultaneous owners.
2. **Organizations Can Exist with Zero Owners:**
   There is **NO check constraint, foreign key, or trigger** requiring an organization to have at least one owner.
3. **Inactive Owners Can Exist:**
   The schema permits `role = 'owner'` with `is_active = FALSE`. While `get_user_org_role` ignores inactive memberships, the row remains an "inactive owner" in the database.
4. **Sole Active Owners Can Be Deleted or Demoted:**
   As audited below, PostgreSQL RLS policies permit an owner to delete their own membership row or cross-demote each other.

---

## 3. Inventory of All Membership Mutation Paths

| Mutation Path | Entry Point / File | Caller Authorization | Database Mechanism | Transaction Boundary | Database Row Locks | Audit Log Generated? | Can Leave Zero Active Owners? |
| :-: | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **M-01** | Add Member (Invite) | Owner only (client & RLS) | Direct PostgREST `INSERT INTO memberships` | Single HTTP request | RowExclusiveLock on `memberships` | Yes (separate REST call) | No |
| **M-02** | Update Member Role | Owner only (client & RLS) | Direct PostgREST `UPDATE memberships SET role = ...` | Single HTTP request | RowExclusiveLock on `memberships` | Yes (separate REST call) | **YES** (Can create 0 owners via race or demotion) |
| **M-03** | Deactivate Member | Owner only (client & RLS) | Direct PostgREST `UPDATE memberships SET is_active = false` | Single HTTP request | RowExclusiveLock on `memberships` | Yes (separate REST call) | **YES** (Can deactivate sole owner via API bypass) |
| **M-04** | Reactivate Member | Owner only (client & RLS) | Direct PostgREST `UPDATE memberships SET is_active = true` | Single HTTP request | RowExclusiveLock on `memberships` | Yes (separate REST call) | No |
| **M-05** | Delete Member | Owner only (RLS `FOR DELETE`) | Direct PostgREST `DELETE FROM memberships` | Single HTTP request | RowExclusiveLock on `memberships` | None in client | **YES** (Owner can delete their own membership row!) |
| **M-06** | Transfer Ownership | **DOES NOT EXIST** | N/A | N/A | None | N/A | **YES** (Simulated multi-step transfers fail midway) |
| **M-07** | `service_role` Direct DML | Backend Service (`BYPASSRLS`) | Direct SQL `UPDATE / DELETE` | Per query | Default PostgreSQL | Optional | **YES** (Bypasses all checks) |

### Forensic Analysis of Path M-05 (Owner Self-Deletion Vulnerability)
In `supabase/migrations/007_security_and_integrity_audit_fixes.sql`:
```sql
CREATE POLICY "Owners can delete organization memberships"
ON memberships FOR DELETE
USING (get_user_org_role(organization_id) = 'owner');
```
1. In PostgreSQL, a `DELETE` policy only evaluates the `USING` clause. It does **NOT** support a `WITH CHECK` clause.
2. When an owner issues: `DELETE FROM memberships WHERE user_id = auth.uid() AND organization_id = $org_id;`
3. PostgreSQL evaluates `USING (get_user_org_role(organization_id) = 'owner')`.
4. Prior to deletion, the caller is an active owner. The `USING` clause evaluates to `TRUE`.
5. The row is physically deleted from the table.
6. **Result:** The organization is left with **ZERO OWNERS**. Because non-owners cannot manage memberships, the organization is permanently orphaned.

### Forensic Analysis of Path M-02 (Client-Side Check Bypass)
In `src/features/team/TeamPage.tsx`, lines 94–100:
```typescript
if (member.role === 'owner' && selectedRole !== 'owner') {
  const activeOwners = memberships.filter((m) => m.role === 'owner' && m.isActive);
  if (activeOwners.length <= 1) {
    showToast('error', 'Operation Blocked', 'Cannot demote the sole active owner of the organization.');
    return;
  }
}
```
- This check exists **ONLY in React client-side code**.
- Any HTTP client issuing a `PATCH /rest/v1/memberships?id=eq.<member_id>` with role `'viewer'` completely bypasses this React check.
- If two owners exist, both can demote each other concurrently.

---

## 4. Invariant Enforcement Matrix

| Invariant # | Invariant Description | Enforcement Level | Current Implementation Details | Gaps / Vulnerabilities |
| :-: | :--- | :---: | :--- | :--- |
| **INV-01** | Every active organization must have at least one active owner. | **ABSENT** | Enforced only upon creation via `create_organization`. | Zero database constraints or triggers prevent subsequent deletion or demotion to 0 owners. |
| **INV-02** | An inactive or removed membership cannot hold ownership. | **ABSENT** | Database allows `role = 'owner'` and `is_active = FALSE`. | Inactive members can remain labeled as owners in the database. |
| **INV-03** | The last active owner cannot be demoted, deactivated, or removed. | **PARTIAL (Client Only)** | Enforced strictly in React (`TeamPage.tsx` lines 94-100 & 124-130). | **Zero database-level enforcement**. REST DML or Postman calls can bypass and delete the last owner. |
| **INV-04** | Ownership transfer must be atomic. | **ABSENT** | No ownership transfer RPC exists in the repository. | Manual multi-step client updates (promote B, demote A) can leave 2 owners if step 2 fails. |
| **INV-05** | New owner must be an existing active member of the same tenant. | **ABSENT** | No transfer RPC exists. | Unchecked role promotions. |
| **INV-06** | New owner and old owner must be different users. | **ABSENT** | No transfer RPC exists. | N/A |
| **INV-07** | Old owner must be demoted only after new owner is promoted. | **ABSENT** | No transfer RPC exists. | Reversing steps leaves 0 owners midway. |
| **INV-08** | Concurrent ownership transfers must serialize safely. | **ABSENT** | No row locks on `organizations` exist during membership updates. | Concurrent updates can interleave destructively. |
| **INV-09** | A member cannot promote themselves without authorization. | **ENFORCED** | Enforced by RLS: `WITH CHECK (get_user_org_role(organization_id) = 'owner')`. | Non-owners cannot update memberships. |
| **INV-10** | Platform reviewers cannot bypass organization ownership rules. | **ENFORCED** | Migration 013 grants reviewers access strictly to `organization_eligibility`. | Reviewers cannot alter memberships. |

---

## 5. Concurrency & Race Condition Scenarios

### Scenario 1: Two Owners Attempt Simultaneous Cross-Demotion
- **Initial State:** Organization has Owner 1 and Owner 2.
- **Transaction A (Owner 1 demoting Owner 2 to 'admin'):**
  - Evaluates `USING (get_user_org_role(...) = 'owner')` $\to$ TRUE.
  - Updates Owner 2 row: `role = 'admin'`.
- **Transaction B (Owner 2 demoting Owner 1 to 'admin'):**
  - Evaluates `USING (get_user_org_role(...) = 'owner')` $\to$ TRUE.
  - Updates Owner 1 row: `role = 'admin'`.
- **Under PostgreSQL `READ COMMITTED`:** Both transactions read the snapshot where the other is still owner. Both updates commit successfully.
- **Final State:** **ZERO OWNERS REMAIN.** The organization is permanently orphaned.

### Scenario 2: Owner Demotion Races with Owner Deactivation
- **Initial State:** Organization has Owner 1 and Owner 2.
- **Transaction A:** Owner 1 demotes Owner 2 to `'admin'`.
- **Transaction B:** Owner 2 deactivates Owner 1 (`is_active = FALSE`).
- **Final State:** Owner 1 is inactive. Owner 2 is `'admin'`.
- **Final Active Owners:** **0**. Organization is orphaned.

### Scenario 3: Two Owners Attempt to Transfer Ownership to Different Members
- **Initial State:** Owner 1 and Owner 2.
- **Transaction A:** Owner 1 promotes Member X to `'owner'` and demotes Owner 1.
- **Transaction B:** Owner 2 promotes Member Y to `'owner'` and demotes Owner 2.
- **Final State:** Both Member X and Member Y are promoted to `'owner'`.
- **Final Active Owners:** **2** (Expected: exactly 1).

### Scenario 4: Network Loss During Manual Ownership Transfer
- **Initial State:** Owner 1 wishes to transfer ownership to Member 2.
- **Step 1 (Client Request 1):** `UPDATE memberships SET role = 'owner' WHERE id = Member2` $\to$ **Succeeds**.
- **Network Partition:** Client drops connection before Request 2 is transmitted.
- **Step 2 (Client Request 2):** `UPDATE memberships SET role = 'admin' WHERE id = Owner1` $\to$ **Never sent**.
- **Final State:** **TWO ACTIVE OWNERS** permanently persist in the database.

---

## 6. Proposed Ownership RPC Contracts (Design Specification)

> [!IMPORTANT]
> The following functions are **CONCEPTUAL SPECIFICATIONS ONLY**. In accordance with read-only instructions, they are **NOT IMPLEMENTED OR DEPLOYED**.

### 6.1 `transfer_organization_ownership`
```sql
-- CONCEPTUAL SPECIFICATION ONLY (Do NOT deploy in this phase)
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(
    p_org_id UUID,
    p_new_owner_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_current_role VARCHAR(50);
    v_target_record RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Identity & Caller Authorization
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Caller must be authenticated' USING ERRCODE = '28000';
    END IF;

    -- 2. Deterministic Row Locking (Level 1: Organization Row)
    -- Serializes ALL ownership and membership operations for this organization
    PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_ORG_NOT_FOUND: Organization % does not exist', p_org_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Verify caller is an ACTIVE OWNER
    SELECT role INTO v_current_role
    FROM public.memberships
    WHERE organization_id = p_org_id AND user_id = v_uid AND is_active = TRUE
    FOR UPDATE;

    IF v_current_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Only an active organization owner can transfer ownership'
            USING ERRCODE = '42501';
    END IF;

    -- 4. Invariant: Cannot transfer to self
    IF v_uid = p_new_owner_user_id THEN
        RAISE EXCEPTION 'ERR_SELF_TRANSFER: Cannot transfer ownership to yourself' USING ERRCODE = '22023';
    END IF;

    -- 5. Validate Target Member (Must be existing, active member of the SAME organization)
    SELECT id, role, is_active INTO v_target_record
    FROM public.memberships
    WHERE organization_id = p_org_id AND user_id = p_new_owner_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_TARGET_NOT_MEMBER: Target user is not a member of this organization'
            USING ERRCODE = '22023';
    END IF;

    IF NOT v_target_record.is_active THEN
        RAISE EXCEPTION 'ERR_TARGET_INACTIVE: Cannot transfer ownership to an inactive member'
            USING ERRCODE = '22023';
    END IF;

    -- 6. Atomic Mutation (Promote New Owner FIRST, Demote Old Owner SECOND)
    UPDATE public.memberships
    SET role = 'owner', updated_at = v_now
    WHERE organization_id = p_org_id AND user_id = p_new_owner_user_id;

    UPDATE public.memberships
    SET role = 'admin', updated_at = v_now
    WHERE organization_id = p_org_id AND user_id = v_uid;

    -- 7. Invariant Guard: Assert exactly one active owner exists
    IF (SELECT COUNT(*) FROM public.memberships WHERE organization_id = p_org_id AND role = 'owner' AND is_active = TRUE) <> 1 THEN
        RAISE EXCEPTION 'ERR_INVARIANT_VIOLATION: Organization must have exactly one active owner'
            USING ERRCODE = '23514';
    END IF;

    -- 8. Write Audit Event
    INSERT INTO public.audit_events (
        organization_id, actor_id, action, entity_type, entity_id, details, created_at
    ) VALUES (
        p_org_id, v_uid, 'TRANSFER_OWNERSHIP', 'MEMBERSHIP', v_target_record.id,
        jsonb_build_object('old_owner_id', v_uid, 'new_owner_id', p_new_owner_user_id),
        v_now
    );

    RETURN jsonb_build_object('success', true, 'new_owner_id', p_new_owner_user_id);
END;
$$;
```

### 6.2 `update_organization_member`
```sql
-- CONCEPTUAL SPECIFICATION ONLY (Do NOT deploy in this phase)
CREATE OR REPLACE FUNCTION public.update_organization_member(
    p_org_id UUID,
    p_member_id UUID,
    p_new_role VARCHAR(50),
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role VARCHAR(50);
    v_target RECORD;
    v_other_owners_count INTEGER;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Authentication required' USING ERRCODE = '28000';
    END IF;

    -- Lock organization row to serialize membership admin
    PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;

    -- Verify caller is active owner
    SELECT role INTO v_caller_role
    FROM public.memberships
    WHERE organization_id = p_org_id AND user_id = v_uid AND is_active = TRUE;

    IF v_caller_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Only organization owners can modify members' USING ERRCODE = '42501';
    END IF;

    -- Lock target member
    SELECT * INTO v_target
    FROM public.memberships
    WHERE id = p_member_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_MEMBER_NOT_FOUND: Member not found' USING ERRCODE = 'P0002';
    END IF;

    -- Invariant: If promoting to owner, reject! (Must use transfer_organization_ownership)
    IF p_new_role = 'owner' AND v_target.role <> 'owner' THEN
        RAISE EXCEPTION 'ERR_MULTIPLE_OWNERS_FORBIDDEN: Multiple owners are forbidden. Use transfer_organization_ownership instead.'
            USING ERRCODE = '22023';
    END IF;

    -- Invariant: Sole active owner protection (demotion or deactivation)
    IF v_target.role = 'owner' AND (p_new_role <> 'owner' OR p_is_active = FALSE) THEN
        SELECT COUNT(*) INTO v_other_owners_count
        FROM public.memberships
        WHERE organization_id = p_org_id AND role = 'owner' AND is_active = TRUE AND id <> p_member_id;

        IF v_other_owners_count = 0 THEN
            RAISE EXCEPTION 'ERR_LAST_OWNER_PROTECTION: Cannot demote or deactivate the sole active owner of the organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Execute update
    UPDATE public.memberships
    SET role = p_new_role,
        is_active = p_is_active,
        updated_at = v_now
    WHERE id = p_member_id;

    -- Write Audit Event
    INSERT INTO public.audit_events (
        organization_id, actor_id, action, entity_type, entity_id, details, created_at
    ) VALUES (
        p_org_id, v_uid, 'UPDATE_MEMBER', 'MEMBERSHIP', p_member_id,
        jsonb_build_object('new_role', p_new_role, 'is_active', p_is_active),
        v_now
    );

    RETURN jsonb_build_object('success', true);
END;
$$;
```

### 6.3 `remove_organization_member`
```sql
-- CONCEPTUAL SPECIFICATION ONLY (Do NOT deploy in this phase)
CREATE OR REPLACE FUNCTION public.remove_organization_member(
    p_org_id UUID,
    p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid UUID;
    v_caller_role VARCHAR(50);
    v_target RECORD;
    v_other_owners_count INTEGER;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHENTICATED: Authentication required' USING ERRCODE = '28000';
    END IF;

    -- Lock organization
    PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;

    -- Verify caller is active owner
    SELECT role INTO v_caller_role
    FROM public.memberships
    WHERE organization_id = p_org_id AND user_id = v_uid AND is_active = TRUE;

    IF v_caller_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Only organization owners can remove members' USING ERRCODE = '42501';
    END IF;

    -- Lock target member
    SELECT * INTO v_target
    FROM public.memberships
    WHERE id = p_member_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_MEMBER_NOT_FOUND: Member not found' USING ERRCODE = 'P0002';
    END IF;

    -- Invariant: Sole active owner protection
    IF v_target.role = 'owner' THEN
        SELECT COUNT(*) INTO v_other_owners_count
        FROM public.memberships
        WHERE organization_id = p_org_id AND role = 'owner' AND is_active = TRUE AND id <> p_member_id;

        IF v_other_owners_count = 0 THEN
            RAISE EXCEPTION 'ERR_LAST_OWNER_PROTECTION: Cannot remove the sole active owner of the organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Execute delete
    DELETE FROM public.memberships WHERE id = p_member_id;

    -- Write Audit Event
    INSERT INTO public.audit_events (
        organization_id, actor_id, action, entity_type, entity_id, details
    ) VALUES (
        p_org_id, v_uid, 'REMOVE_MEMBER', 'MEMBERSHIP', p_member_id,
        jsonb_build_object('removed_user_id', v_target.user_id, 'role', v_target.role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;
```

---

## 7. Frontend Compatibility & Transition Requirements

To integrate with the proposed ownership contract:

1. **`src/services/team.service.ts`:**
   - Deprecate direct REST `.update()` on `public.memberships`.
   - Implement wrapper methods calling RPCs:
     - `teamService.transferOwnership(orgId, targetUserId)` $\to$ `supabase.rpc('transfer_organization_ownership', { p_org_id: orgId, p_new_owner_user_id: targetUserId })`
     - `teamService.updateMember(orgId, memberId, newRole, isActive)` $\to$ `supabase.rpc('update_organization_member', ...)`
     - `teamService.removeMember(orgId, memberId)` $\to$ `supabase.rpc('remove_organization_member', ...)`
2. **`src/features/team/TeamPage.tsx`:**
   - Remove the client-only `selectedRole !== 'owner'` branch.
   - Introduce an explicit **"Transfer Ownership" Modal** with two-step confirmation ("This will transfer primary control of this organization to another member and demote you to Admin").
   - Catch and translate database error codes:
     - `ERR_LAST_OWNER_PROTECTION` $\to$ Toast: "Cannot demote or remove the sole active owner."
     - `ERR_MULTIPLE_OWNERS_FORBIDDEN` $\to$ Toast: "Multiple owners are not permitted. Please use Transfer Ownership."
     - `ERR_TARGET_INACTIVE` $\to$ Toast: "Cannot transfer ownership to an inactive member."
     - `ERR_UNAUTHORIZED` $\to$ Toast: "You do not have owner permissions."

---

## 8. Prioritized Remediation Plan

| Priority | Finding ID | Issue Description | Existing Code | Recommended Remediation |
| :-: | :-: | :--- | :--- | :--- |
| **CRITICAL** | **OWN-01** | **Owner Self-Deletion via REST** allows owners to delete their row, leaving 0 owners. | Migration 007 (`Owners can delete organization memberships`) | Revoke direct `DELETE` and `UPDATE` on `memberships` from `authenticated`. Route all membership changes through RPCs. |
| **CRITICAL** | **OWN-02** | **Simultaneous Cross-Demotion** allows two owners to demote each other to 0 owners. | Direct PostgREST DML | Enforce Level 1 `organizations FOR UPDATE` row lock inside all membership RPCs. |
| **HIGH** | **OWN-03** | **Multiple Owners Permitted** by database schema. | Migration 001 (`memberships` table constraints) | Add partial unique index: `CREATE UNIQUE INDEX uq_single_active_owner ON public.memberships(organization_id) WHERE role = 'owner' AND is_active = TRUE;` |
| **HIGH** | **OWN-04** | **Absence of Atomic Ownership Transfer RPC**. | Whole codebase | Author and deploy `transfer_organization_ownership` in Migration 015. |
| **MEDIUM** | **OWN-05** | **Inactive Owners Permitted** in schema. | Migration 001 | Add CHECK constraint or trigger rejecting `role = 'owner' AND is_active = FALSE`. |

---

## 9. Unverified Assumptions and Limitations

1. **Third-Party Supabase Auth:** This audit assumes Supabase Auth user management (`auth.users`) is isolated and does not trigger unhandled cascade deletions of `memberships` without foreign key enforcement.
2. **Read-Only Verification:** In strict accordance with execution boundaries, no SQL mutations or RLS exploits were run against the staging database. All vulnerabilities were established via static code analysis of SQL migrations and PostgreSQL RLS semantics.
3. **Dirty Git Working Tree:** Branch `Vijay-Atlas` retains uncommitted working tree modifications in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx`.

---

## 10. Final Architecture Verdict

```text
===============================================================================
FINAL VERDICT:
CRITICAL OWNERSHIP INVARIANT VIOLATION
===============================================================================
```

### Explanatory Summary
- **Why This Verdict:**
  1. An active organization owner can execute `DELETE FROM public.memberships WHERE user_id = auth.uid()` via direct PostgREST REST DML today and delete themselves from the database without any trigger or check preventing it, leaving the organization with **ZERO OWNERS**.
  2. The sole-owner protection rule (`activeOwners.length <= 1`) is enforced **ONLY in client-side React code** (`TeamPage.tsx`), leaving the backend database completely unprotected against API calls.
  3. The database schema allows an arbitrary number of simultaneous owners and allows inactive members to hold ownership roles.
  4. There is **zero ownership transfer mechanism** in the repository.
- **Mandatory Gating Condition:** The conceptual RPCs (`transfer_organization_ownership`, `update_organization_member`, `remove_organization_member`) and the partial unique index on active owners must be incorporated into Migration 015 before production release.
