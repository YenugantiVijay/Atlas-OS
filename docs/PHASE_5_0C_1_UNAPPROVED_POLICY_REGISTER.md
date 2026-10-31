# PHASE 5.0C.1 — UNAPPROVED POLICY REGISTER
## Comprehensive Audit of Engineering-Introduced Policies, Tentative Parameters, and Assumptions Lacking Product Owner Approval
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Product Integrity & Policy Governance Audit  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Policy Boundary Mandate

In product architecture, there is a fundamental distinction between:
1. **Formally Approved Product Owner Decisions:** Decisions explicitly reviewed, selected, and frozen by the Product Owner (`PO-01` through `PO-08`, `DEC-01`, `DEC-11` through `DEC-14`).
2. **Engineering Assumptions & Proposals:** Default quantitative numbers, timeout durations, purge windows, and schema choices introduced by engineering as implementation details.

When engineering assumptions are documented as if they were authoritative product decisions, enterprise risk arises. If an unapproved parameter conflicts with business operations or statutory obligations (e.g., PMLA document retention rules), implementing it without Product Owner approval creates technical debt and regulatory vulnerability.

This register isolates every policy, quantitative parameter, and operational constraint introduced across Phases 5.0B.2.1 and 5.0C that **lacks explicit Product Owner approval**.

---

## 2. Unapproved Policy & Parameter Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       UNAPPROVED POLICY & PARAMETER REGISTER                                           │
├─────────┬──────────┬─────────────────────────────┬────────────────────────────────┬────────────────────────────────────┤
│ Item ID │ Severity │ Affected Domain / Reference │ Nature of Unapproved Rule      │ Legal / Operational Risk & Blocker │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **UNP-01│ CRITICAL │ PO-06: Sole-Owner KYC       │ Strict 30-day deletion TTL     │ IMPLEMENTATION BLOCKER             │
│         │          │ Identity Document Storage   │ for raw identity document proofs│ PMLA 2002 mandates 5y retention;   │
│         │          │ (`5.0C Spec Sec 8.2; LEG-1`)│ (Aadhaar, Passport, etc.).     │ destroys judicial evidence in fraud│
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **UNP-02│ HIGH     │ DEC-01: Primary Owner       │ Mandatory 7-day TTL on         │ NON-BLOCKER (Configurable Default) │
│         │          │ Transfer Handshake Offer    │ ownership transfer offers      │ PO froze 72h on PO-02, but never   │
│         │          │ (`5.0C Spec Sec 3.3`)       │ before offer expires.          │ approved 7-day TTL for transfers.  │
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **UNP-03│ HIGH     │ RET-03: Personal Data       │ Fixed 30-day grace period      │ NON-BLOCKER (Legal Review Item)    │
│         │          │ Sanitization Schedule       │ post-deprovisioning before PII │ DPDP Act requires erasure when     │
│         │          │ (`5.0C Spec Sec 8.2`)       │ pseudonymization is executed.  │ purpose ends; 30d needs PO sign-off│
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **UNP-04│ MEDIUM   │ PO-07: Branch Customer      │ Rigid specification of exact   │ NON-BLOCKER (Customizable Schema)  │
│         │          │ Master Masking Columns      │ 4 masked columns               │ PO approved masking principle;     │
│         │          │ (`5.0C Spec Sec 5.1`)       │ (credit, terms, aging, rating).│ exact columns should be role-based.│
├─────────┼──────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────────────────┤
│ **UNP-05│ MEDIUM   │ PO-01: Multi-Currency       │ Mandatory locked exchange rate │ NON-BLOCKER (Technical Detail)     │
│         │          │ Evaluation Conversion       │ at transaction creation        │ Mechanism not explicitly reviewed  │
│         │          │ (`5.0C Spec Sec 6.1`)       │ for threshold calculations.    │ by Product Owner.                  │
└─────────┴──────────┴─────────────────────────────┴────────────────────────────────┴────────────────────────────────────┘
```

---

## 3. Detailed Forensic Analysis of Unapproved Policies

### 3.1 UNP-01: The 30-Day Raw Identity Document Purge Mandate
- **Affected Documents:** 
  - `docs/PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 8.2, Item RET-03 / PO-06)
  - `docs/PHASE_5_0C_SECURITY_AND_DATABASE_CONTROL_CATALOG.md` (Table 1, Item SEC-09 / LEG-01)
  - `docs/PHASE_5_0C_CA_LEGAL_REVIEW_REGISTER.md` (Item LEG-01)
  - `docs/PHASE_5_0B_2_1_CORRECTED_RETENTION_AND_PRIVACY_POLICY.md` (Section 4.2)
- **Where Introduced:** In Phase 5.0B.2.1, Section 4.2: *"Strict Deletion Lifecycle: Upon final resolution (approval or rejection) of the recovery claim, raw document objects are purged automatically via bucket lifecycle rules after 30 days."*
- **Actual Product Owner Decision:** In Phase 5.0B.2, `PO-06` stated:
  > *"Retain multi-step identity and business authorization verification. However: Do not require every applicant to submit Aadhaar, PAN and Passport. Define acceptable alternative evidence. Minimize sensitive identity data. Prefer verification-provider results over retaining raw identity documents where appropriate. Define document access, encryption, deletion and audit requirements. Leave applicable DPDP and KYC requirements subject to legal review."*
- **Adversarial Critique & Systemic Risk:**
  1. The Product Owner **never designated a 30-day purge schedule**. The PO explicitly stated: *"Leave applicable DPDP and KYC requirements subject to legal review."*
  2. **Severe Legal Contradiction (PMLA vs DPDP):** Under Section 12 of the Prevention of Money Laundering Act (PMLA) 2002 and Rule 9 of the PMLA (Maintenance of Records) Rules 2005, records of identity of clients must be maintained for **5 years**. If ATLAS OS enterprise customers are reporting entities or subject to statutory tax audits, prematurely deleting identity verification proofs within 30 days could constitute illegal destruction of records.
  3. **Fraud Investigation Impairment:** If a fraudulent claimant takes over an organization using forged credentials and a negligent compliance officer approves it, the legitimate owner might only notice the fraud during monthly tax filing (Day 31–45). If raw uploaded proofs are purged at Day 30, physical forensic analysis (e.g. Photoshop manipulation, fraudulent seal verification) is impossible, exposing ATLAS OS to massive vicarious liability.
- **Required Action:**
  - Strip the mandatory 30-day purge rule from the architecture baseline.
  - Reclassify document retention as **[PENDING LEGAL COUNSEL & PMLA/DPDP COMPLIANCE REVIEW]**.
  - Provide encrypted CMEK storage with legal hold capabilities, allowing retention duration to be configured per regulatory requirement.
- **Blocker Classification:** **IMPLEMENTATION BLOCKER** for Sole-Owner KYC infrastructure.

---

### 3.2 UNP-02: Mandatory 7-Day TTL for Primary Owner Transfer Offers
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 3.3) and `PHASE_5_0C_STATE_MACHINE_AND_TRANSACTION_CATALOG.md` (Section 2.5).
- **Where Introduced:** Specified as: *"A record is created in ownership_transfers with status OFFERED and a 7-day TTL."*
- **Actual Product Owner Decision:** The Product Owner approved `PO-02` (72-hour default expiry for commercial transaction approval requests), but **never specified a TTL for corporate ownership transfer offers**.
- **Adversarial Critique:** In wholesale businesses, corporate ownership transfers often involve legal restructuring, partnership deed amendments, or formal board meetings that take 2 to 4 weeks. Hardcoding a 7-day expiration forces unwanted operational churn and repeated re-offers.
- **Required Action:** Reclassify the 7-day window as a **Configurable Operational Default (7 days)** with an allowable administrative range (1 day to 30 days), subject to Product Owner confirmation.
- **Blocker Classification:** **NON-BLOCKER** (Configurable parameter).

---

### 3.3 UNP-03: Fixed 30-Day Grace Period for Profile PII Sanitization
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 8.2, Item RET-03) and `PHASE_5_0B_2_1_CORRECTED_RETENTION_AND_PRIVACY_POLICY.md` (Section 2.3).
- **Where Introduced:** Stated that user profile PII in `public.profiles` is sanitized or pseudonymized *"after a 30-day grace/reactivation buffer."*
- **Actual Product Owner Decision:** `PO-08` required policy-based retention categories and data minimization, but **never approved a specific 30-day delay for profile anonymization**.
- **Adversarial Critique:** Under the DPDP Act 2023, data fiduciaries must erase personal data upon withdrawal of consent or when the purpose for processing is completed, unless retention is required by law. If a deprovisioned employee explicitly exercises their "Right to Erasure" under Section 12 of the DPDP Act, delaying sanitization for 30 days without statutory grounds could breach data protection obligations.
- **Required Action:** Reclassify the 30-day grace buffer as a proposed default pending DPDP Act legal counsel review (`LEG-01`).
- **Blocker Classification:** **NON-BLOCKER** (Subject to legal sign-off).

---

### 3.4 UNP-04: Rigid Specification of Masked Customer Master Columns
- **Affected Documents:** `PHASE_5_0C_MASTER_ARCHITECTURE_SPECIFICATION.md` (Section 5.1).
- **Where Introduced:** Spec explicitly hardcodes four masked columns: `credit_limit`, `payment_terms_days`, `current_aging_balance`, `internal_risk_rating`.
- **Actual Product Owner Decision:** `PO-07` approved the principle: *"One central customer master per organization. Sensitive credit terms, limits, and aging information must be protected server-side, not merely hidden in the frontend."*
- **Adversarial Critique:** In large distributor networks, branch managers may need to view payment terms (e.g., "Net 30") while sales counter cashiers should only see "Cash Only" or "Credit Approved". Hardcoding a single view across all branch roles lacks the granularity required by enterprise wholesalers.
- **Required Action:** Ensure the schema supports role-based column access policies or dynamic view definitions rather than rigid static masks.
- **Blocker Classification:** **NON-BLOCKER** (Implementation refinement).

---

## 4. Product Owner Submission Matrix for Open Parameters

The table below catalogs all engineering-proposed parameters awaiting formal Product Owner sign-off:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PROPOSED PARAMETERS SUBMITTED FOR PO FREEZE                                          │
├────┬─────────────────────────────┬───────────────────────────┬─────────────────────────────────────────────────────────┤
│ #  │ Parameter Name              │ Proposed Engineering Value│ Recommended Product Owner Decision Action               │
├────┼─────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
│ 01 │ KYC Raw Proof Retention TTL │ Pending Legal / PMLA 5y   │ **REJECT 30-DAY PURGE**; mandate CMEK storage until     │
│    │ (PO-06 Sole-Owner Recovery) │ (Reject static 30-day)    │ formal legal opinion under PMLA & DPDP Act is obtained. │
├────┼─────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
│ 02 │ Ownership Transfer Offer TTL│ 7 Calendar Days           │ **APPROVE AS CONFIGURABLE DEFAULT** (1–30 day range).   │
├────┼─────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
│ 03 │ Deprovisioning PII Buffer   │ 30 Calendar Days          │ **SUBMIT TO LEGAL COUNSEL** under DPDP erasure rules.   │
├────┼─────────────────────────────┼───────────────────────────┼─────────────────────────────────────────────────────────┤
│ 04 │ Branch Masking Column Set   │ Credit, Terms, Aging, Risk│ **APPROVE AS BASELINE TIER** with custom role overrides.│
└────┴─────────────────────────────┴───────────────────────────┴─────────────────────────────────────────────────────────┘
```
