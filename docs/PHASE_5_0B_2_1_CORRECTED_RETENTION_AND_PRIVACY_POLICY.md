# PHASE 5.0B.2.1 — CORRECTED DATA RETENTION, PRIVACY & IDENTITY POLICY
## Authoritative Retention Taxonomy, Legal Hold Specification, and DPDP-Compliant Identity Architecture
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Data Governance, Retention & Privacy Specification  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Policy Scope

This document establishes the corrected data retention schedules, privacy frameworks, and identity verification specifications for ATLAS OS v1. It supersedes the provisional retention claims in Phase 5.0B.2.

### Essential Corrections Implemented:
1. **Separation of Proposed Durations:** No retention period is treated as "universally approved." Retention categories are segmented into five distinct domains, each flagged as requiring explicit CA or legal confirmation.
2. **Legal Holds & Dispute Freezes:** Formalized statutory legal holds and dispute freezes that automatically suspend all deletion and archiving schedules during ongoing litigation, fraud investigations, or ownership claims.
3. **Data Minimization in Sole-Owner KYC (PO-06):** Replaced the rigid requirement for exhaustive document uploads (Aadhaar + PAN + Passport) with a flexible, tiered evidence structure prioritizing third-party verification assertions over raw PII retention.
4. **Product Policy Clarification (PO-03):** Formally codified the 14-day Primary Owner recovery waiting period as an internal **product security policy**, removing erroneous claims of statutory origin.
5. **Notification Privacy:** Enforced strict notification content rules preventing the exposure of identity proofs, tokens, or credentials across SMS and Email channels.

---

## 2. Granular Data Retention Taxonomy (PO-08)

Data within ATLAS OS is classified into five operational categories with specific lifecycle rules:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ATLAS OS PROPOSED DATA RETENTION TAXONOMY                                            │
├──────────┬────────────────────────────┬─────────────────────────────┬───────────────────────────┬──────────────────────┤
│ Category │ Data Classification        │ Target Entities / Records   │ Proposed Baseline Horizon │ Legal / Statutory    │
│ ID       │                            │                             │ (Pending Professional)    │ Review Status        │
├──────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **RET-01 │ Security & System Audit    │ `audit_events`, auth logs,  │ 365 Days Active Storage;  │ [PENDING LEGAL &     │
│          │ Events                     │ role changes, access trails │ Cold Archive thereafter   │ CERT-In REVIEW]      │
├──────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **RET-02 │ Financial & Statutory      │ `invoices`, `payments`,     │ 72 Months from Annual     │ [PENDING CHARTERED   │
│          │ Commercial Records         │ `stock_movements`, sequences│ Return Due Date (~79 mos) │ ACCOUNTANT SIGN-OFF] │
├──────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **RET-03 │ Personal Identifiable      │ `users`, profile names,     │ Retained during active    │ [PENDING DPDP ACT    │
│          │ Information (PII)          │ phone numbers, emails       │ membership; purged 30d post│ 2023 LEGAL REVIEW]   │
├──────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **RET-04 │ Operational Deprovisioning │ `deprovisioning_requests`,  │ Permanent de-identified   │ [PENDING LEGAL       │
│          │ & Governance Records       │ state machine audit entries │ forensic log (Bare UUIDs) │ COMPLIANCE REVIEW]   │
├──────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **RET-05 │ Idempotency Keys &         │ `idempotency_keys`, session │ 48 Hours Hard TTL;        │ [APPROVED PRODUCT    │
│          │ Transient Workflows        │ nonces, temporary cache     │ Automated background purge│ BASELINE]            │
└──────────┴────────────────────────────┴─────────────────────────────┴───────────────────────────┴──────────────────────┘
```

---

### 2.1 Category RET-01: Security & System Audit Events
- **Scope:** Immutable records stored in `public.audit_events`, capturing authentication attempts, membership mutations, permission changes, ownership transfer requests, and elevation actions.
- **Proposed Retention:** 
  - **Active Database Queryable Tier:** 365 days (1 year) from creation date.
  - **Cold Archive Tier:** Encrypted, append-only, object-store archival (e.g., GCS coldline/archive) retained for an additional 4 to 6 years.
- **Technical Mechanism:** 
  - Table is protected by trigger `trg_prevent_audit_tampering` raising SQLSTATE `42501` on any `UPDATE` or `DELETE`.
  - Partitioning strategy: Monthly table partitioning (`audit_events_yYYYYmMM`). Active partitions remain in the operational catalog; partitions older than 365 days are detached, exported to encrypted Parquet format, checksummed, and dropped from live PostgreSQL only after archive verification.
- **Statutory Review Requirement:** **[PENDING LEGAL & CERT-In REVIEW]**. Requires legal counsel confirmation against Indian Computer Emergency Response Team (CERT-In) cybersecurity directions (which require 180-day logging for ICT systems) and relevant contractual SLA requirements.

---

### 2.2 Category RET-02: Financial & Statutory Commercial Records
- **Scope:** `invoices`, `invoice_items`, `payments`, `payment_allocations`, `stock_movements`, and `document_sequences`.
- **Proposed Retention:** 72 months (6 years) reckoned from the due date of furnishing the annual return for the relevant financial year under Section 36 of the CGST Act 2017.
  - *Practical Calculation:* For FY 2024–25 (April 1, 2024 to March 31, 2025), the annual return (GSTR-9) due date is December 31, 2025. 72 months from December 31, 2025 results in a mandatory retention date of **December 31, 2031** (~81 months from transaction inception).
- **Technical Mechanism:**
  - Hard deletion is blocked unconditionally via database trigger `trg_prevent_ledger_deletion`.
  - Soft deactivation or archival partition moves are blocked until `CURRENT_DATE >= annual_return_due_date + INTERVAL '72 months'`.
  - Foreign key references to operators or approvers utilize bare UUIDs (`created_by`, `issued_by`, `actor_id`). Deletion or deprovisioning of an authentication user in Supabase Auth does not cascade to or erase historical transaction lines.
- **Statutory Review Requirement:** **[PENDING CHARTERED ACCOUNTANT SIGN-OFF]**. Requires formal sign-off by practicing CA confirming that digital retention meets Rule 56 and Section 36 admissibility standards under the CGST Act 2017.

---

### 2.3 Category RET-03: Personal Information (PII)
- **Scope:** First name, last name, operational email address, mobile telephone number, and user profile metadata stored in application tables and GoTrue Auth.
- **Proposed Retention:**
  - Retained continuously while the user holds an active membership in at least one organization.
  - Upon user deprovisioning or voluntary organization departure:
    - User's active membership is set to `status = 'DEACTIVATED'`.
    - Profile PII in `public.profiles` is sanitized or pseudonymized (`first_name = 'Former'`, `last_name = 'User'`, `email = user_id || '@anonymized.atlas'`) after a 30-day grace/reactivation buffer.
    - Financial transaction attribution is preserved via immutable bare UUIDs (`user_id`).
- **Statutory Review Requirement:** **[PENDING DPDP ACT 2023 LEGAL REVIEW]**. Requires qualified legal review under the Digital Personal Data Protection Act 2023 (Section 8: Obligations of Data Fiduciary; Right to Correction and Erasure of Personal Data). Legal counsel must affirm whether retaining immutable transaction attribution (UUIDs) without personal names complies with erasure mandates.

---

### 2.4 Category RET-04: Operational Deprovisioning & Governance Records
- **Scope:** Records in `deprovisioning_requests`, `ownership_transfer_requests`, and recovery dispute logs.
- **Proposed Retention:** Permanent forensic retention.
- **Technical Mechanism:** Row data contains zero sensitive credentials or raw identity documents. Records preserve state transitions, timestamps, IP hashes, and actor UUIDs to establish evidence in case of commercial disputes or fraud investigations.
- **Statutory Review Requirement:** **[PENDING LEGAL COMPLIANCE REVIEW]**. Requires confirmation that permanent de-identified governance logging does not violate privacy boundaries.

---

### 2.5 Category RET-05: Idempotency Keys & Transient Workflows
- **Scope:** Records in `public.idempotency_keys`, temporary session cache tokens, and in-flight multi-step wizard nonces.
- **Retention Horizon:** **48 Hours Hard TTL**.
- **Technical Mechanism:** Automated PostgreSQL scheduled job (`pg_cron`) or periodic clean-up trigger deleting keys where `created_at < NOW() - INTERVAL '48 hours'`.
- **Review Status:** **[APPROVED PRODUCT BASELINE]**. Purely technical operational cache; zero statutory significance.

---

## 3. Statutory Legal Holds & Dispute-Related Retention

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   STATUTORY LEGAL HOLD STATE MACHINE & MECHANICS                                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

              ┌──────────────────┐
              │  Normal Purge &  │
              │ Archival Routine │
              └────────┬─────────┘
                       │
                       │ Incident Trigger:
                       │   • Fraud Alert (`is_disputed = TRUE`)
                       │   • Tax Notice / Audit Demand
                       │   • Ownership Recovery Dispute
                       │   • Court / Regulatory Order
                       ▼
              ┌──────────────────┐
              │   LEGAL HOLD     │◄───────── Suspends All Deletion & Purging
              │   ACTIVE STATE   │          Locks Partitions in Operational DB
              └────────┬─────────┘          Generates Forensic Cryptographic Snapshot
                       │
                       │ Hold Resolution:
                       │   • Formal Compliance Sign-Off
                       │   • Dispute Dismissal / Settlement
                       │   • Court Clearance Notice
                       ▼
              ┌──────────────────┐
              │   LEGAL HOLD     │────────── Normal Retention Horizon Re-evaluated
              │  RELEASE STATE   │          (Grace Buffer Applied Before Purge)
              └──────────────────┘
```

### 3.1 Trigger Conditions for Legal Holds
A legal hold is activated automatically or by authorized compliance command upon:
1. **Primary Owner Recovery Dispute:** Any incumbent Primary Owner or Co-Owner flagging a recovery claim (`is_disputed = TRUE`).
2. **Deprovisioning Fraud Flag:** An administrative alert indicating an account deprovisioning attempt may be part of an unauthorized takeover or data destruction effort.
3. **Regulatory or Judicial Notice:** Receipt of formal legal process, tax audit notices (e.g., GST DRC-01A), or judicial production orders.

### 3.2 Enforcement Mechanics:
- When an organization or user is marked with `legal_hold = TRUE`:
  - Automated partition drops for `audit_events` are suspended.
  - Profile PII sanitization is blocked.
  - Automated purging of operational deprovisioning logs is disabled.
  - Database triggers enforce that even administrative superusers cannot delete held rows.

---

## 4. Corrected Identity Verification & KYC Architecture (PO-06)

The sole-owner recovery process (`PO-06`) restores access to an organization when all credentials are lost and no Co-Owners exist to form a voting quorum. To comply with data minimization and avoid excessive PII exposure, the identity architecture is structured as follows:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     SOLE-OWNER IDENTITY VERIFICATION PIPELINE                                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  [ Claimant Applicant ]
            │
            ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ STEP 1: Flexible Identity Proof Selection (Data Minimization)                                    │
  │ • Mandatory Business PAN (Matches `organizations.pan`)                                           │
  │ • Choice of ONE Accredited Photo ID:                                                             │
  │     [ Option A: Masked Aadhaar (Last 4 digits visible only) via UIDAI / DigiLocker ]             │
  │     [ Option B: Passport (Identity / Validity pages only) ]                                      │
  │     [ Option C: Voter ID Card ]                                                                  │
  │     [ Option D: Driving Licence ]                                                                │
  └─────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ STEP 2: Third-Party Accredited KYC Provider Integration (Zero Raw Document Storage Preferred)     │
  │ • Claimant redirected to certified KYC provider (e.g., DigiLocker / Setu / Cashfree)             │
  │ • Provider validates document authenticity, liveness, and matches name against official records   │
  │ • Provider returns cryptographic assertion token:                                                │
  │     `{ provider_ref: "KYC-98234", status: "VERIFIED", match_score: 0.98, doc_type: "PASSPORT" }` │
  │ • Platform database stores ASSERTION TOKEN ONLY; raw document files never touch main database!   │
  └─────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                    │ (If fallback manual document upload is strictly necessary)
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ STEP 3: Fallback Secure Document Handling (Envelope Encryption & Access Control)                 │
  │ • Uploaded directly to private, isolated object bucket (`sec-kyc-evidence-isolated`)             │
  │ • Client-side / Envelope Encrypted using dedicated KMS Customer Managed Encryption Key (CMEK)    │
  │ • Access restricted exclusively to verified Platform Security Compliance Officers                 │
  │ • Hard 30-day deletion TTL: Raw image purged immediately upon claim resolution / rejection       │
  │ • Full audit logging in `audit_events` for every view, download, or inspection                   │
  └─────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ STEP 4: Beneficial Business Ownership Cross-Matching                                             │
  │ • Proof of Authority: GST Registration Certificate, MCA Incorporation, or Udyam Certificate      │
  │ • Automated cross-check: Entity Name, GSTIN, PAN match `public.organizations` database record    │
  │ • Manual dual-operator review by Platform Compliance Officers with written justification         │
  └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Data Minimization Principles
1. **No Compulsory Tri-Document Requirement:** Applicants are **NEVER** required to submit Aadhaar, PAN, and Passport simultaneously. The applicant provides their entity PAN plus **one** accredited individual government photo ID.
2. **Masking Mandate:** If Aadhaar is submitted, the first 8 digits must be masked in compliance with Aadhaar regulations. The system rejects unmasked Aadhaar uploads.
3. **Preference for Provider Assertions:** The system defaults to third-party digital verification assertions (e.g., DigiLocker OAuth / API tokens). Raw image storage is treated as an exceptional fallback.

### 4.2 Security, Encryption & Deletion Controls for Fallback Evidence
- **Storage Isolation:** Evidence files are stored in a dedicated Google Cloud Storage bucket outside the standard application asset bucket, with public access blocked and uniform bucket-level access enforced.
- **Encryption:** Files are encrypted at rest with AES-256 using a dedicated Google Cloud KMS key. Encryption keys are rotated regularly and access is controlled via IAM.
- **Access Restrictions:** Restricted to users holding the platform role `compliance_security_officer`. Developers, system administrators, and database superusers have zero read access to the bucket.
- **Strict Deletion Lifecycle:** Upon final resolution (approval or rejection) of the recovery claim, raw document objects are purged automatically via bucket lifecycle rules after **30 days**. Only the audit log entry (actor, timestamp, decision, hash of assertion) is retained.
- **Statutory Review Requirement:** **[PENDING DPDP ACT 2023 LEGAL REVIEW]**. Legal counsel must verify that this verification architecture complies with Sections 4, 5, and 6 of the DPDP Act 2023 (Notice, Consent, and Purpose Limitation).

---

## 5. Recovery Waiting Period Classification (PO-03)

- **Clarification:** The **14-day recovery waiting period** is an **ATLAS OS Internal Product Security Policy**, designed to protect organizations from account takeover attacks by providing an intentional window for incumbent owners to detect and contest fraudulent claims.
- **Statutory Status:** **ZERO STATUTORY MANDATE**. It is not required by Indian corporate or commercial law.
- **Configurability:** 
  - Standard default: 14 calendar days (336 hours).
  - Configurable range: Minimum 7 calendar days, maximum 30 calendar days (configured by Primary Owner during organization security setup).
- **Notification Requirement:** Automated notifications are dispatched immediately upon claim initiation across Email and SMS to all registered Co-Owners and emergency contacts.

---

## 6. Recovery Notification Privacy & Anti-Leakage Protocol (PO-05)

To prevent notification channels from becoming phishing or data-leakage vectors:

1. **Zero Secret/Token Exposure:**
   - SMS and Email messages **MUST NEVER** contain cryptographic recovery tokens, session nonces, or passwords.
   - Messages must **NEVER** include identity document images, taxpayer identification numbers (full PAN/Aadhaar), or financial balances.
2. **Notification Content Specification:**
   - Multi-channel notification delivers only an alert and an authenticated sign-in prompt:
     > *"SECURITY ALERT: A Primary Owner recovery claim has been initiated for organization [Org Name]. If you authorized this, no action is needed. If you did NOT authorize this, log in to your ATLAS OS security dashboard immediately to review or place an urgent fraud hold. Reference: REC-82914."*
3. **Anti-Phishing Verification:**
   - Notifications direct the user to navigate to their established ATLAS OS domain rather than clicking raw unverified links.
   - Any embedded links must use strictly verified tenant subdomains with anti-spoofing DKIM/DMARC and SMS DLT registration.

---

## 7. Sign-Off & Review Status Summary

```
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
POLICY ATTRIBUTIONS & PENDING SIGN-OFFS:
  RET-01 (Security Audit Retention: 365d + Archive):     [ PENDING LEGAL & CERT-In REVIEW ]
  RET-02 (Financial Ledger Retention: 72m):              [ PENDING CHARTERED ACCOUNTANT SIGN-OFF ]
  RET-03 (PII Erasure & Pseudonymization):               [ PENDING DPDP ACT 2023 LEGAL REVIEW ]
  RET-04 (Deprovisioning Governance Retention):          [ PENDING LEGAL COMPLIANCE REVIEW ]
  RET-05 (Idempotency Key TTL: 48h):                     [ APPROVED PRODUCT BASELINE ]
  PO-03  (14-Day Recovery Period):                       [ APPROVED PRODUCT SECURITY POLICY (NON-STATUTORY) ]
  PO-06  (Sole-Owner KYC Data Minimization):             [ PENDING DPDP ACT 2023 LEGAL REVIEW ]
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```
