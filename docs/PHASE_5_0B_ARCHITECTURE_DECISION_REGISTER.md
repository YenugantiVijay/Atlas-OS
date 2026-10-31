# PHASE 5.0B — ARCHITECTURE DECISION REGISTER (DEC-01 THROUGH DEC-14)
## Authoritative Enterprise Decision Log, Reconciliations, and Governance Baseline
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Strategic Architecture Decision Register — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Purpose & Scope

This document provides the canonical **Architecture Decision Register (ADR)** for ATLAS OS. It reconciles decisions `DEC-01` through `DEC-14`, incorporating the confirmed architectural resolutions established by the Product Owner for Phase 5.0B and establishing clear governance boundaries between:
1. **Confirmed Product Owner Architecture Decisions** (`DEC-01`, `DEC-11`, `DEC-12`, `DEC-13`, `DEC-14`, Ownership Authority Model).
2. **Statutory Tax & Legal Gating Decisions** (`DEC-02`, `DEC-03`, `DEC-04`, `DEC-08`, `DEC-09`, `RET-02`).
3. **Operational Runtime & Engine Parameters** (`DEC-05`, `DEC-06`, `DEC-07`, `DEC-10`, `RET-01`).

---

## 2. Master Decision Summary & Status Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MASTER ARCHITECTURE DECISION REGISTER                                       │
├─────────┬───────────────────────────────┬───────────────────────────────────┬───────────────────────────────┤
│ ID      │ Decision Title                │ Governance Classification         │ Status & Resolution           │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-01  │ Owner Cardinality Model       │ Core Product Architecture         │ CONFIRMED: Multiple Owners    │
│         │                               │                                   │ (1 Primary, >=0 Co-Owners)    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-AUTH│ Ownership Authority Model     │ Core Product Architecture         │ CONFIRMED: Primary Owner has  │
│         │                               │                                   │ Reserved Governance Powers    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-02  │ Draft Invoice Numbering       │ Indian GST Compliance (Rule 46)   │ RECOMMENDED: Unnumbered Drafts│
│         │                               │ (Requires Certified Tax Counsel)  │ Pending CA Sign-Off           │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-03  │ Document Amount Ceilings      │ Technical Integrity & Accounting  │ PROPOSED: ₹100,000,000 Ceiling│
│         │                               │ (Requires CA Sign-Off)            │ Pending CA Sign-Off           │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-04  │ Invoice Cancellation vs CN    │ Statutory CGST Rules (Rule 53)    │ MANDATED: Credit Notes post   │
│         │                               │ (Requires Certified Tax Counsel)  │ issuance; no silent cancel    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-05  │ DB Transaction Timeout        │ Operational Engine Configuration  │ PROPOSED: 5.0s Timeout Default│
│         │                               │ (Principal Engineer Governance)   │ Non-blocking for DDL schema   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-06  │ Idempotency Key Retention TTL │ Operational Engine Configuration  │ PROPOSED: 24h Default TTL     │
│         │                               │ (Principal Engineer Governance)   │ Non-blocking for DDL schema   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-07  │ Worker Lease Duration         │ Concurrency Engine Configuration  │ PROPOSED: 60s Default Lease   │
│         │                               │ (Principal Engineer Governance)   │ Non-blocking for DDL schema   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-08  │ Odd-Paisa GST Tax Splitting   │ Indian GST Computation Precision  │ PROPOSED: Line Item Floor with│
│         │                               │ (Requires Certified Tax Counsel)  │ Summary Reconcile; Pending CA │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-09  │ Invoice Sequence Gap Policy   │ Statutory Compliance (Rule 46)    │ MANDATED: Strict Consecutive  │
│         │                               │ (Requires Certified Tax Counsel)  │ Sequences; Row Lock on Seq    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-10  │ Draft Invoice Retention TTL   │ Operational Storage Hygiene       │ PROPOSED: 30-Day Purge Default│
│         │                               │ (Principal Engineer Governance)   │ Non-blocking for DDL schema   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-11  │ Membership Role Cardinality   │ Core Product Architecture         │ CONFIRMED: Single Role per    │
│         │                               │                                   │ Membership; Ownership Sep.    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-12  │ Primary Owner Recovery        │ Enterprise Governance & Security  │ CONFIRMED: Verified Recovery  │
│         │                               │                                   │ (14d Time-Lock, Multi-Notify) │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-13  │ Critical Action Approvals     │ Enterprise Governance & Risk      │ CONFIRMED: Configurable       │
│         │                               │                                   │ Multi-Tier Workflows & SoD    │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ DEC-14  │ Controlled Custom Roles       │ Enterprise RBAC Architecture      │ CONFIRMED: Custom Roles with  │
│         │                               │                                   │ Monotonic Delegation Bounds   │
└─────────┴───────────────────────────────┴───────────────────────────────────┴───────────────────────────────┘
```

---

## 3. Detailed Decision Reconciliations

### 3.1 DEC-01: Owner Cardinality Model
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Previous Assumption in Phase 5.0A:** Open choice between Option A (Single Owner) and Option B (Co-Owners).
- **Confirmed Architecture:** **MULTIPLE OWNERS WITH EXACTLY ONE PRIMARY OWNER.**
  - An organization supports multiple owners, but enforces an absolute structural asymmetry: exactly one Primary Owner, and zero or more Co-Owners.
  - Implemented via partial unique index: `idx_single_primary_owner_per_org ON public.organization_ownership(organization_id) WHERE ownership_tier = 'PRIMARY_OWNER'`.
- **Cross-Reference:** Workstream A ([PHASE_5_0B_OWNERSHIP_GOVERNANCE_DESIGN.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_OWNERSHIP_GOVERNANCE_DESIGN.md)).

---

### 3.2 Ownership Authority Model: Primary Owner Reserved Powers
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Confirmed Architecture:**
  - **Primary Owner Reserved Powers:** Only the Primary Owner can initiate organization closure, initiate or cancel primary ownership transfers, and appoint or remove co-owners.
  - **Co-Owner Shared Powers:** Co-owners hold organization-wide administrative and legal visibility, can participate in Tier 3/4 approvals, and can vote in Primary Owner Verified Recovery workflows, but cannot unilaterally dissolve the organization or remove peers.
- **Cross-Reference:** Workstream A ([PHASE_5_0B_OWNERSHIP_GOVERNANCE_DESIGN.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_OWNERSHIP_GOVERNANCE_DESIGN.md)).

---

### 3.3 DEC-11: Membership Role Cardinality
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Previous Assumption in Phase 5.0A:** Open choice between Option A (Single Role) and Option B (Multi-Role array/junction).
- **Confirmed Architecture:** **SINGLE OPERATIONAL ROLE PER MEMBERSHIP.**
  - Each tenant membership row possesses exactly one operational role.
  - Ownership is modeled orthogonally via the dedicated `organization_ownership` governance table.
  - Additional operational permissions are granted via discrete **Membership Permission Overrides** (`membership_permission_overrides`), completely eliminating the need for multiple simultaneous roles.
- **Cross-Reference:** Workstream B ([PHASE_5_0B_RBAC_PERMISSION_ARCHITECTURE.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_RBAC_PERMISSION_ARCHITECTURE.md)).

---

### 3.4 DEC-12: Primary Owner Recovery Protocol
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Confirmed Architecture:** **VERIFIED RECOVERY PROTOCOL.**
  - Replaces arbitrary takeover mechanisms with an auditable, cryptographically verified recovery workflow.
  - Enforces mandatory 14-day time-lock, multi-channel broadcast alerts (SMS/Email/WhatsApp) to incumbent owners, Co-Owner supermajority voting (>66%), and KYC/legal verification fallback for sole-owner entities.
- **Cross-Reference:** Workstream E ([PHASE_5_0B_ACCOUNT_LIFECYCLE_AND_RECOVERY.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_ACCOUNT_LIFECYCLE_AND_RECOVERY.md)).

---

### 3.5 DEC-13: Critical Action Approval Framework
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Confirmed Architecture:** **CONFIGURABLE APPROVAL WORKFLOWS.**
  - Establishes four standard financial governance tiers ($\le$₹25K auto-approved; ₹25K–₹100K operational; ₹100K–₹500K executive; >₹500K ownership dual-quorum).
  - Enforces absolute Separation of Duties (SoD): no user can approve their own transaction.
  - Integrates with commercial document RPCs via the `PENDING_APPROVAL` document state.
- **Cross-Reference:** Workstream D ([PHASE_5_0B_APPROVAL_WORKFLOW_ARCHITECTURE.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_APPROVAL_WORKFLOW_ARCHITECTURE.md)).

---

### 3.6 DEC-14: Controlled Custom Roles
- **Status:** **CONFIRMED BY PRODUCT OWNER.**
- **Confirmed Architecture:** **CONTROLLED CUSTOM ROLES.**
  - Allows tenant administrators to create and manage custom functional roles.
  - Server-enforced monotonic delegation boundary: an administrator cannot grant permissions they do not personally possess.
  - Governance-reserved capabilities (org closure, ownership transfer) are strictly blocked from inclusion in custom roles.
- **Cross-Reference:** Workstream B ([PHASE_5_0B_RBAC_PERMISSION_ARCHITECTURE.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0B_RBAC_PERMISSION_ARCHITECTURE.md)).

---

## 4. Statutory & Legal Decision Status (CA Sign-Off Requirements)

The following tax decisions require formal written sign-off from a Certified Tax Counsel / Chartered Accountant prior to Phase 5.0D deployment:

1. **DEC-02 (Rule 46 Draft Invoices):** Formal confirmation that storing pre-issuance quotes as unnumbered drafts does not violate Rule 46 consecutive sequence mandates. [`REQUIRES CA/LEGAL REVIEW`]
2. **DEC-04 (Rule 53 Credit Notes):** Formal confirmation of the policy requiring Credit Notes for any post-issuance correction, strictly prohibiting deletion or cancellation of dispatched invoices. [`REQUIRES CA/LEGAL REVIEW`]
3. **DEC-08 (Odd-Paisa GST Precision):** Approval of the integer-cent rounding algorithm reconciling ₹0.01 discrepancies between CGST and SGST line splits. [`REQUIRES CA/LEGAL REVIEW`]
4. **DEC-09 (Sequence Gap Policy):** Formal sign-off on strict transaction serialization on `document_sequences` to guarantee zero numbering gaps. [`REQUIRES CA/LEGAL REVIEW`]
5. **RET-02 (Section 36 Retention):** Formal confirmation of the 72-month statutory financial record retention mandate under Indian GST law. [`REQUIRES CA/LEGAL REVIEW`]
