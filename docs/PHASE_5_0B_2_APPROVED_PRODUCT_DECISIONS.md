# PHASE 5.0B.2 — APPROVED PRODUCT DECISIONS (DECISION FREEZE)
## Authoritative Product Specification: Frozen Decisions, Governance Parameters, and Core Business Rules
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Product Owner Decision Baseline — Formally Approved for Architecture Documentation  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Freeze Commitment

This document records the **Formally Approved Product Owner Decisions** for ATLAS OS v1. These decisions resolve all prior parameter proposals from Phase 5.0B and Phase 5.0B.1, establishing an unalterable product baseline for subsequent architecture specifications, security contracts, and implementation planning.

In strict adherence to Phase 5.0B.2 restrictions, **no application code was modified, no database migrations were created or applied, no database connections were established, and production was untouched.**

---

## 2. Frozen Product Decisions (PO-01 Through PO-08)

### PO-01 — Financial & Commercial Approval Monetary Tiers
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Configurability:** Approval thresholds must be fully configurable per organization via `public.approval_rules`.
  2. **Initial INR Defaults:**
     - **Tier 1 (Up to ₹25,000):** Authorized operational employee (standard role-based issuance).
     - **Tier 2 (₹25,001 to ₹1,00,000):** Department or Branch Manager approval required.
     - **Tier 3 (₹1,00,001 to ₹5,00,000):** Senior Manager or Co-Owner approval required.
     - **Tier 4 (Above ₹5,00,000):** Two authorized approvers required (Dual-Quorum: Primary Owner + Senior Manager / Co-Owner).
  3. **Separation of Duties (SoD):** Absolute self-approval prohibition for critical transactions. The initiating actor cannot be an approver on their own request.
  4. **High-Risk Action Categories:** Actions classified as high-risk (e.g., physical stock write-offs, bad debt cancellations, customer credit limit increases) may enforce secondary approval regardless of monetary value.
  5. **Currency Awareness:** The approval engine must support multi-currency threshold configuration, evaluating thresholds in the tenant's base currency (default: `INR`).

---

### PO-02 — Approval Request Expiration & Re-Submission
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Default Time-To-Live (TTL):** 72 hours from request creation.
  2. **Tenant Configurability:** Organizations may adjust this TTL (e.g., 24h, 48h, 7 days) based on commercial requirements.
  3. **Zero Silent Approval:** An expired approval request **MUST NEVER** automatically approve or execute a transaction.
  4. **Failure Behavior:** Upon expiration, the request transitions to `EXPIRED`. The associated commercial document remains in `PENDING_APPROVAL` (or reverts to `DRAFT`).
  5. **Notification & Resubmission:** The system notifies the requester of the expiration, requiring explicit resubmission or cancellation.

---

### PO-03 — Primary Owner Verified Recovery Protocol
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Default Cooling Period:** Mandatory 14-day statutory waiting period before any recovery claim can commit.
  2. **Multi-Contact Alerting:** Immediate automated broadcast notifications to all registered Co-Owners and verified organization administrative contacts.
  3. **Dispute & Fraud Holds:** The incumbent Primary Owner or any authorized Co-Owner can place an immediate **Fraud/Dispute Hold** on the recovery, freezing the state machine and preventing automated takeover.
  4. **Audited Emergency Intervention:** High-priority platform compliance intervention is permitted during frozen disputes, backed by an immutable forensic audit trail.

---

### PO-04 — Co-Owner Recovery Quorum & Voting Denominator
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Quorum Threshold:** Requires strictly more than 66% ($>66\%$) approval of the eligible Co-Owner voting population.
  2. **Rounding Rule:** Required approval count is always **rounded upward** to the next integer.
  3. **Claimant Exclusion:** The Co-Owner who initiated the recovery claim is **strictly excluded** from voting.
  4. **Precise Denominator Formula:**
     $$\text{EligibleVoters} = \{c \in \text{CoOwners}(O) \mid c \neq \text{Claimant} \land c.\text{is\_active} = \text{TRUE}\}$$
     $$\text{RequiredApprovals} = \lfloor 0.66 \times |\text{EligibleVoters}| \rfloor + 1$$
     *Example Table:*
     - 1 Other Co-Owner: Required $= \lfloor 0.66 \times 1 \rfloor + 1 = 1$ (100% required).
     - 2 Other Co-Owners: Required $= \lfloor 0.66 \times 2 \rfloor + 1 = 2$ (100% required).
     - 3 Other Co-Owners: Required $= \lfloor 0.66 \times 3 \rfloor + 1 = 2$ (66.7% required).
     - 4 Other Co-Owners: Required $= \lfloor 0.66 \times 4 \rfloor + 1 = 3$ (75% required).
  5. **Anti-Unilateral Guarantee:** A single Co-Owner can never unilaterally usurp Primary Ownership without corroboration from peers.
  6. **Zero Co-Owner Fallback:** If $|\text{EligibleVoters}| = 0$, the request cannot be approved via peer voting; it automatically diverts to the **Sole-Owner Recovery Process (`PO-06`)**.

---

### PO-05 — Recovery Notification Infrastructure
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Launch Dependencies (v1):** Multi-channel delivery via **Email** and **SMS**.
  2. **Future Extensions:** WhatsApp Business API integration is designated as a post-v1 enhancement, not a launch blocker.
  3. **Data Protection / Privacy:** Notification messages must **NEVER** expose sensitive recovery data, passwords, cryptographic recovery tokens, or complete tax IDs in plaintext. Messages provide a secure verification link with anti-phishing indicators.

---

### PO-06 — Sole-Owner Recovery & KYC Compliance Gate
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Identity Verification:** Government-issued photo identity verification (e.g., Aadhaar, Passport, PAN) executed through an accredited verification provider.
  2. **Evidence of Authority:** The claimant must upload legal documentation establishing beneficial business ownership or corporate authority (e.g., GST Registration Certificate, MCA Incorporation Certificate, Udyam Registration, or Board Resolution).
  3. **Internal Record Matching:** Document details (Legal Name, PAN, GSTIN) are automatically cross-checked against existing historical database records in `public.organizations`.
  4. **Manual Compliance Review:** Platform Security / Compliance Officers manually inspect submissions, with mandatory documented justification and forensic audit recording.
  5. **Cooling Period & Notice:** A mandatory waiting period and notices to registered organization contacts apply prior to final handover.
  6. **Legal Oversight:** The process is subject to formal review by qualified legal counsel.

---

### PO-07 — Branch Customer Master Architecture
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Central Customer Master:** Exactly one unified customer master per tenant organization. Customers are shared across all branches to provide a 360-degree commercial view.
  2. **Zero Duplicate Identities:** Prohibits creating duplicate customer records across branches for the same legal business entity (matched via GSTIN/PAN).
  3. **Branch Attribution:** Sales orders, invoices, payments, and dispatches are attributed to the specific branch where the commercial transaction occurred (`branch_id`).
  4. **Access Control & Sensitive Data Protection:** Branch sales personnel can view operational customer data, but sensitive commercial credit limits, bank account details, and consolidated aging reports are masked via granular permissions.

---

### PO-08 — Policy-Based Deprovisioning & Audit Retention
- **Status:** **APPROVED BY PRODUCT OWNER.**
- **Policy Scope:**
  1. **Policy-Based Retention by Record Category:**
     - **Category A (Forensic Security & Deprovisioning Logs):** Preserved for an approved security audit schedule (1 year active in database, then cold storage archive).
     - **Category B (Statutory Financial & Tax Ledgers):** Strictly retained in accordance with Chartered Accountant / Legal statutory rules (72 months under Section 36 CGST Act).
     - **Category C (Transient Operational Keys):** Idempotency keys purged after operational TTL (24–48 hours).
  2. **PII Minimization & Anonymization:** When an employee or user identity is deprovisioned, personal information (phone, personal email) is anonymized or purged where legally permitted, while immutable forensic user IDs (`bare UUIDs`) are retained.
  3. **Zero History Erasure:** Account deletion in GoTrue or Supabase **MUST NEVER** erase historical financial records, invoices, payments, or forensic audit events.

---

## 3. Preserved Core Architectural Baseline

The following decisions remain permanently preserved and active:

| Decision ID | Canonical Subject | Preserved Architectural Principle |
| :--- | :--- | :--- |
| **DEC-01** | Owner Cardinality | Multiple owners supported: Exactly 1 Primary Owner + $\ge 0$ Co-Owners. |
| **AUTH-MOD**| Authority Model | Primary Owner has reserved governance powers (closure, transfer, removal). |
| **DEC-11** | Membership Roles | Exactly 1 operational role per membership. Ownership decoupled to dedicated table. |
| **DEC-12** | Primary Owner Recovery | Verified Recovery Protocol (time-lock, alerts, quorum, KYC gate). |
| **DEC-13** | Critical Approvals | Configurable multi-tier approval workflows with Separation of Duties. |
| **DEC-14** | Custom Roles | Controlled custom roles with server-enforced monotonic delegation boundaries. |

---

## 4. Architectural Sign-Off Attestation

The product decisions documented herein (`PO-01` through `PO-08`) are **FROZEN**. Engineering specifications and target architectures must align directly with these parameters.
