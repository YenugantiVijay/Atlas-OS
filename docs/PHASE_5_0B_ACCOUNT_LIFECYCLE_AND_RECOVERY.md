# PHASE 5.0B — WORKSTREAM E: ACCOUNT LIFECYCLE & PRIMARY OWNER RECOVERY
## Authoritative Identity Governance: Deprovisioning State Machines, Multi-Tenant Ownership Continuity, and Verified Recovery Protocols
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Restricted Engineering Architecture Blueprint — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Purpose & Scope

This document specifies the **Account Lifecycle & Identity Governance Architecture** for ATLAS OS. It addresses the critical boundary between Supabase Auth (GoTrue), multi-tenant membership state, and enterprise ownership continuity, formalizing:
- **DEC-12 (Primary Owner Recovery):** VERIFIED RECOVERY PROTOCOL. A cryptographically sound, time-locked, and audited procedure for recovering an organization whose Primary Owner is unavailable, deceased, or compromised.
- **Multi-Organization Offboarding:** Protocols governing users who simultaneously hold Primary Ownership, Co-Ownership, or operational roles across multiple distinct tenant organizations.
- **Fail-Safe Deprovisioning:** The Two-Phase Deprovisioning State Machine integrated with Level 0.5 database fencing tokens, GoTrue v2.197.0 recovery mechanics, and historical record preservation.

---

## 2. Existing-State Evidence & Architectural Audit

1. **`001_multi_tenant_base.sql` (lines 28–30):**
   - The `memberships` table uses a bare `user_id UUID NOT NULL` with no foreign key constraint to `auth.users(id)` [`VERIFIED IN LOCAL SOURCE`].
   - If an Auth identity is deleted in Supabase Dashboard or Admin API, the membership record remains untouched in PostgreSQL, creating "zombie" active memberships [`VERIFIED IN LOCAL SOURCE`].
2. **`012_organization_creation_rpc.sql` (line 28):**
   - The table `organization_creation_idempotency` uses `REFERENCES auth.users(id) ON DELETE CASCADE` [`VERIFIED IN LOCAL SOURCE`].
   - Deleting an Auth user cascades to clean up org-creation idempotency records, but leaves the tenant and memberships intact [`VERIFIED IN LOCAL SOURCE`].
3. **Phases 4.11.10–4.11.12 Audit Reports:**
   - Previous audits demonstrated that attempting to use a `BEFORE DELETE ON auth.users` trigger creates a circular cross-schema deadlock (`40P01`) [`REPORTED BY PRIOR AUDIT`].
   - The Two-Phase Deprovisioning State Machine operating at Level 0.5 was established as the only mathematically sound replacement [`REPORTED BY PRIOR AUDIT`].

---

## 3. Primary Owner Verified Recovery Protocol (DEC-12)

### 3.1 The Governance Problem
If a sole Primary Owner becomes abruptly unavailable (e.g., loss of credentials, medical emergency, sudden abandonment), an ERP system must provide a path to restore governance without creating a backdoor that allows rogue co-owners or malicious actors to execute an unauthorized corporate takeover.

### 3.2 Recovery Protocol Guarantees
The ATLAS OS Verified Recovery Protocol enforces five non-negotiable safeguards [`PROPOSED DESIGN`]:
1. **No Silent Takeover:** Every recovery initiation triggers immediate high-priority alerts via SMS, WhatsApp, and registered email to the current Primary Owner and all Co-Owners.
2. **Mandatory Time-Lock (14-Day Cooling Period):** A statutory 14-day waiting period is enforced. During this window, the current Primary Owner can cancel the recovery with a single authenticated action.
3. **Co-Owner Quorum:** In organizations with Co-Owners, recovery requires a supermajority vote ($>66\%$) of active Co-Owners.
4. **Sole-Owner Fallback (KYC / Legal Verification Gate):** If the organization has zero Co-Owners, recovery cannot be completed via automated software alone. It transitions to `PENDING_LEGAL_VERIFICATION`, requiring platform compliance review of business documents (e.g., GST registration certificate, PAN card, partnership deed, or court probate).
5. **Immutable Forensic Log:** Every action, vote, notification dispatch, and IP address is written to `public.audit_events`.

---

### 3.3 Sequence Diagram: Verified Primary Owner Recovery
```mermaid
sequenceDiagram
    autonumber
    actor Claimant as Claiming Co-Owner
    participant DB as PostgreSQL Database
    participant Notification as Multi-Channel Alert Engine
    actor Primary as Incumbent Primary Owner
    actor OtherOwners as Other Co-Owners

    Claimant->>DB: initiate_primary_owner_recovery(p_org_id, p_reason)
    Note over DB: Lock Org (Level 2)<br/>Assert Claimant is Active Co-Owner<br/>Assert No Pending Recovery<br/>Insert into owner_recovery_requests<br/>Set 14-Day Time-Lock (expires_at)
    DB-->>Notification: Dispatch High-Alert Notifications
    Notification-->>Primary: "URGENT: Ownership recovery initiated on your account"
    Notification-->>OtherOwners: "Vote Required: Ownership recovery initiated"
    DB-->>Claimant: Recovery Initiated (14-Day Countdown Active)

    alt Incumbent Primary Owner Rejects / Cancels
        Primary->>DB: cancel_owner_recovery(p_recovery_id)
        Note over DB: Assert Caller == Incumbent Primary<br/>Mark Recovery Status = 'CANCELLED_BY_OWNER'<br/>Log Security Incident
        DB-->>Primary: Recovery Defeated & Cancelled
        DB-->>Claimant: Recovery Rejected by Primary Owner
    else Co-Owners Vote & Time-Lock Expires
        OtherOwners->>DB: vote_owner_recovery(p_recovery_id, 'APPROVE')
        Note over DB: Tally Votes; Assert Quorum (>66%) Reached
        Note over DB: Wait for 14-Day Time-Lock Expiry
        Claimant->>DB: execute_owner_recovery(p_recovery_id)
        Note over DB: Assert Time >= expires_at<br/>Assert Quorum Met<br/>Demote Incumbent Primary to Inactive Co-Owner<br/>Promote Claimant to Primary Owner<br/>Emit Audit Event
        DB-->>Claimant: Recovery Successful (Role: Primary Owner)
    end
```

---

## 4. Multi-Tenant Identity Offboarding & Deprovisioning

### 4.1 Multi-Organization Role Permutations
When a user identity undergoes deprovisioning (`INITIATED`), the user may occupy different governance tiers across multiple organizations [`PROPOSED DESIGN`]:

```
User U (Undergoing Deprovisioning)
  │
  ├──► Organization A (User is Sole Primary Owner) ──────► BLOCKS DEPROVISIONING (Action Required: Transfer or Close)
  │
  ├──► Organization B (User is Co-Owner, Primary Exists) ──► AUTO-SEVERANCE (Resigns Co-Ownership, Clears Member Row)
  │
  └──► Organization C (User is Operational Staff) ────────► AUTO-SEVERANCE (Deactivates Membership, Clears Member Row)
```

### 4.2 Handling the Sole Primary Owner Blocker
If user $U$ is the sole Primary Owner of Organization $A$:
1. The deprovisioning worker inspects all ownership holdings during the Step 3 Severance phase:
   ```sql
   SELECT organization_id 
   FROM public.organization_ownership 
   WHERE user_id = p_user_id AND ownership_tier = 'PRIMARY_OWNER';
   ```
2. If Organization $A$ has no pending transfer or replacement Primary Owner, the severance transaction **ABORTS**:
   - The deprovisioning request is marked `FAILED_PRIMARY_OWNER_BLOCKED`.
   - Error payload records: `"Cannot deprovision user: Sole Primary Owner of active organization A. Ownership must be transferred or organization closed first."`
   - User's account remains locked (`AUTH_LOCKED`) in GoTrue to prevent unauthorized operations, but database tenant integrity is strictly preserved.

---

## 5. GoTrue v2.197.0 Failure Recovery & Context Rules

When the deprovisioning worker communicates with Supabase GoTrue APIs, it enforces the **HTTP 404 Context Rules** established in Phase 4.11.12 [`PROPOSED DESIGN`]:

| Workflow Step | GoTrue API Call | HTTP Response | Operational Context | Mandatory Engine Action |
| :--- | :--- | :---: | :--- | :--- |
| **Step 2: Account Ban** | `POST /admin/users/{id}/factors` (Lock) | **404 Not Found** | Identity already deleted or missing from GoTrue. | **DO NOT MARK COMPLETED.** Advance state to `AUTH_LOCKED` and proceed to Step 3 (Membership Severance) to clear dangling database rows. |
| **Step 2: Account Ban** | `POST /admin/users/{id}/factors` (Lock) | **500 / 503 / Timeout** | Network partition or GoTrue transient error. | Lease expires; background worker retries Step 2 with monotonic fencing token. |
| **Step 4: Identity Delete** | `DELETE /admin/users/{id}` | **200 / 204 Success** | Identity deleted from GoTrue after memberships severed. | Advance state to `COMPLETED`. Record `completed_at`. |
| **Step 4: Identity Delete** | `DELETE /admin/users/{id}` | **404 Not Found** | Identity was already deleted or purged from Auth catalog. | **TREAT AS SUCCESS.** Memberships are already severed; advance state to `COMPLETED`. |

---

## 6. Historical Record Preservation & Legal Immutability

To satisfy Indian statutory commercial requirements (Section 36 CGST Act):
1. **Bare UUID Retention:** Historical documents (`invoices`, `payments`, `audit_events`, `stock_movements`) record `created_by` and `actor_id` as bare `UUID` values with **no foreign keys to `auth.users(id)`**.
2. **Referential Integrity on Offboarding:** When user $U$ is deleted from GoTrue and their membership is severed, the database does **NOT** nullify or cascade-delete historical financial records.
3. **Forensic Attribution:** The `audit_events` table preserves a permanent snapshot of the user's email, full name, and role at the time the transaction was committed.
4. **Proof of Non-Tampering:** Trigger-enforced immutability ensures that no historical invoice or payment ledger can be altered under the guise of an account deletion.

---

## 7. Acceptance Criteria for Implementation (Phase 5.0B Gate)

- [ ] Verified Primary Owner Recovery protocol specified with 14-day time-lock and multi-channel notifications.
- [ ] Co-owner quorum voting rule (>66%) and sole-owner legal verification gate defined.
- [ ] Multi-organization deprovisioning handling formalized (Sole Primary Owner blocks deprovisioning until transfer/closure).
- [ ] GoTrue v2.197.0 HTTP 404 Context Rules integrated into worker state machine.
- [ ] Permanent forensic audit preservation proven without foreign key cascades.
