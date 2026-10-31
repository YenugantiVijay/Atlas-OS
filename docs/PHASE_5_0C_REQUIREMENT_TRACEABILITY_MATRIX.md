# PHASE 5.0C — REQUIREMENT TRACEABILITY MATRIX
## Comprehensive Mapping: Decisions, Business Risks, Technical Controls, Automated Tests, and Implementation Status
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Engineering Traceability Matrix  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Status Taxonomy

This matrix provides complete end-to-end traceability for every core architectural, product, and security requirement in ATLAS OS. It links high-level product decisions directly to business risks, database enforcement mechanisms, frontend application guards, audit evidence, automated tests, current implementation statuses, and open blockers.

### Status Taxonomy:
- **CONFIRMED DECISION:** Formally approved by Product Owner; baseline policy frozen.
- **SPECIFIED:** Architecture design and SQL contract fully authored and reviewed.
- **PARTIALLY IMPLEMENTED:** Some components exist in code/migrations, but full contract is incomplete.
- **IMPLEMENTED LOCALLY:** Implemented in local workspace files on disk.
- **GIT COMMITTED:** Committed to git on branch `Vijay-Atlas`.
- **REMOTE UNVERIFIED:** Local/git state exists, but remote staging catalog deployment is unconfirmed.
- **STAGING VERIFIED:** Confirmed deployed and active via live staging catalog query.
- **BLOCKED:** Implementation or verification is blocked by a prerequisite gate.
- **PROFESSIONAL REVIEW REQUIRED:** External sign-off required from certified CA or Legal Counsel.

---

## 2. Master Requirement Traceability Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS REQUIREMENT TRACEABILITY MATRIX                                         │
├─────────┬──────────────────────┬─────────────────────────────┬────────────────────────────────┬────────────────────────┤
│ Req ID  │ Decision / Principle │ Business Risk Addressed     │ Database Enforcement           │ App Enforcement        │
│         │                      │                             │                                │                        │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Audit Evidence       │ Automated Test              │ Implementation Status          │ Remaining Blocker      │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-01│ Multi-Tenant Query   │ Cross-tenant data leakage;  │ PostgreSQL RLS policies on all │ Context provider sets  │
│         │ Isolation (Domain A) │ competitor access to data.  │ tables; `organization_id IN    │ `organization_id`;     │
│         │                      │                             │ (SELECT get_user_orgs())`.     │ client tenant scoping. │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Session audit record │ `test_cross_tenant_read_    │ REMOTE UNVERIFIED              │ Blocker BLK-01         │
│         │ in `audit_events`.   │ isolation` (Tier 1/2).      │ (Committed Mig 001–008).       │ (Catalog Query).       │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-02│ Closed-Door Privilege│ Direct tampering with data  │ Direct INSERT/UPDATE/DELETE    │ API client calls RPCs; │
│         │ Model (Domain A)     │ via PostgREST endpoints.    │ REVOKED from `authenticated`   │ zero direct Supabase   │
│         │                      │                             │ and `anon` on core tables.     │ `.from().insert()`.    │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Access denied log;   │ `test_direct_rest_dml_      │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ SQLSTATE 42501.      │ forbidden` (Tier 1).        │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-03│ Exactly One Primary  │ Unowned tenant; unilateral  │ Partial unique index +         │ UI prevents removing   │
│         │ Owner (DEC-01)       │ takeover; rogue deactivation│ deferred constraint trigger    │ or deactivating active │
│         │                      │ of corporate administrator. │ `trg_assert_primary_owner`.    │ Primary Owner.         │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Ownership audit log  │ `test_exactly_one_primary_  │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ in `audit_events`.   │ owner_invariant` (Tier 1).  │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-04│ Two-Phase Primary    │ Unsolicited dumping of legal│ Two-phase table state:         │ Nominee must confirm   │
│         │ Transfer (Domain B)  │ liabilities or tax burdens  │ `OFFERED` -> `COMPLETED`.      │ acceptance via modal;  │
│         │                      │ onto an unsuspecting user.  │ Nominee must explicitly accept.│ email verification.    │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ State transition in  │ `test_two_phase_ownership_  │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ `ownership_transfers`│ transfer_handshake` (Tier 1)│ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-05│ Co-Owner Recovery    │ Malicious unilateral takeover│ Quorum formula: > 66% of       │ Multi-owner voting     │
│         │ Quorum (PO-04)       │ of corporate ownership by   │ eligible Co-Owners; claimant   │ dashboard; progress bar│
│         │                      │ a single rogue Co-Owner.    │ excluded from denominator.     │ and signature capture. │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Immutable votes in   │ `test_coowner_recovery_     │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ `recovery_decisions` │ quorum_math` (Tier 1).      │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-06│ Sole-Owner Recovery  │ Permanent lockout of sole-  │ Platform compliance review gate│ Multi-step upload with │
│         │ KYC Gate (PO-06)     │ proprietor; fraudulent claim│ with cross-matching of PAN and │ flexible ID options;   │
│         │                      │ by identity impersonator.   │ GSTIN against `organizations`. │ data minimization.     │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Forensic review log; │ `test_sole_owner_kyc_flow`  │ SPECIFIED /                    │ Professional Legal     │
│         │ verification tokens. │ (Tier 3).                   │ PROFESSIONAL REVIEW REQUIRED   │ Review (LEG-01).       │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-07│ Monotonic Custom Role│ Privilege escalation via    │ Trigger checks permissions to  │ Role creator UI shows  │
│         │ Delegation (DEC-14)  │ self-created custom roles   │ grant are subset of creator's  │ only grantable rights  │
│         │                      │ with superuser rights.      │ active grantable permissions.  │ within delegator scope.│
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Role definition log  │ `test_custom_role_delegation│ SPECIFIED                      │ Awaiting Migration 015 │
│         │ in `audit_events`.   │ _monotonic_bounds` (Tier 1).│ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-08│ Central Customer     │ Fragmented customer identity│ Central `customers` table      │ Shared customer lookup;│
│         │ Master (PO-07)       │ duplicate GSTIN reporting;  │ unique on `(org_id, gstin)`.   │ branch staff cannot    │
│         │                      │ branch credit limit leak.   │ Branch views mask credit terms.│ edit global limits.    │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Customer audit log;  │ `test_branch_customer_master│ SPECIFIED                      │ Awaiting Migration 015 │
│         │ branch attribution.  │ _credit_masking` (Tier 1/3).│ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-09│ Branch Sequences with│ Duplicate sequence numbers  │ `UNIQUE NULLS NOT DISTINCT     │ Sequence display on UI;│
│         │ NULL Handling (Dom D)│ when branch_id is NULL.     │ (org_id, doc_type, branch_id)` │ automatic branch code  │
│         │                      │                             │ in `document_sequences`.       │ prefix formatting.     │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Serial sequence rows │ `test_sequence_null_branch_ │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ in catalog.          │ uniqueness` (Tier 1).       │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-10│ 4-Tier Approval      │ Rogue or unauthorized high- │ Table `approval_rules`; minor- │ Workflow banner on UI; │
│         │ Monetary Tiers (PO-01│ value commercial transactions│ unit integer paisa threshold   │ approval routing to    │
│         │                      │ committing without review.  │ checks in base currency.       │ manager inbox.         │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Request & decisions  │ `test_approval_tier_routing_│ SPECIFIED                      │ Awaiting Migration 015 │
│         │ in approval tables.  │ thresholds` (Tier 1).       │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-11│ Dual-Distinct        │ Single manager approving    │ Trigger asserts                │ UI requires two        │
│         │ Approver Quorum (P01)│ multi-lakh transaction      │ `approver_1 != approver_2`     │ distinct approvers to  │
│         │                      │ collusively or unilaterally.│ on Tier 4 approval requests.   │ sign from accounts.    │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Two decision records │ `test_dual_approver_quorum_ │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ with distinct UUIDs. │ distinction` (Tier 1).      │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-12│ Separation of Duties │ Requester self-approving    │ Trigger on `approval_decisions`│ UI hides approve button│
│         │ (SoD) Ban (PO-01)    │ unapproved purchases, credit│ asserts `decided_by !=         │ for initiating user    │
│         │                      │ limits, or stock write-offs.│ request.initiated_by`.         │ on their own requests. │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Exception 42501 on   │ `test_approval_self_approval│ SPECIFIED                      │ Awaiting Migration 015 │
│         │ attempted approval.  │ _prohibited` (Tier 1).      │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-13│ Approval Expiry      │ Stale requests committing   │ Background TTL check; status   │ Expired banner shown;  │
│         │ Non-Approval (PO-02) │ automatically; unapproved   │ transitions to `EXPIRED`.      │ document remains draft │
│         │                      │ document posted to ledger.  │ Zero silent transaction commit.│ or requires resubmit.  │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Expiration status and│ `test_approval_expiry_no_   │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ audit timestamp.     │ silent_approval` (Tier 1).  │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-14│ Allocation on        │ Sequence gaps in official   │ Drafts have `invoice_number =  │ Drafts labeled 'DRAFT';│
│         │ Issuance (Rule 46)   │ GST invoices from abandoned │ NULL`. Number allocated under  │ tax invoice number     │
│         │                      │ quotations or drafts.       │ row lock at status `ISSUED`.   │ displayed only post-iss│
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Sequential sequence  │ `test_invoice_allocation_on_│ SPECIFIED /                    │ Professional CA        │
│         │ numbers allocated.   │ issuance_no_gaps` (Tier 1). │ PROFESSIONAL REVIEW REQUIRED   │ Sign-Off (TAX-01/05).  │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-15│ Financial Ledger     │ Post-facto tampering with   │ Trigger raises SQLSTATE 42501  │ UI disables edit/delete│
│         │ Immutability (Dom F) │ tax invoices or payments;   │ on UPDATE or DELETE of any     │ buttons once invoice   │
│         │                      │ tax evasion / fraud.        │ invoice with status `ISSUED`.  │ reaches `ISSUED`.      │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Immutability trigger │ `test_financial_ledger_     │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ execution in catalog.│ immutability_trigger` (Tier1│ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-16│ Section 34 Credit    │ Deleting or cancelling an   │ Invoice cancellation blocked;  │ Credit Note creation   │
│         │ Note Mandate (TAX-03)│ issued invoice to fix errors│ Credit Notes created via atomic│ wizard linked to parent│
│         │                      │ without tax trail.          │ RPC linked to original invoice.│ invoice UUID.          │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Credit note row in   │ `test_credit_note_reversal_ │ SPECIFIED /                    │ Professional CA        │
│         │ `credit_notes` table.│ integrity` (Tier 1/3).      │ PROFESSIONAL REVIEW REQUIRED   │ Sign-Off (TAX-03).     │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-17│ Odd-Paisa GST Tax    │ Mismatch between line taxes │ Round CGST & SGST to integer   │ UI calculates tax per  │
│         │ Rounding (TAX-04)    │ and summary in GSTR-1 tables│ paise; invoice summary matches │ line with identical    │
│         │                      │ leading to filing rejection.│ sum of rounded lines.          │ rounding algorithm.    │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Balanced tax amounts │ `test_odd_paisa_gst_tax_    │ SPECIFIED /                    │ Professional CA        │
│         │ in invoice items.    │ rounding_balance` (Tier 1). │ PROFESSIONAL REVIEW REQUIRED   │ Sign-Off (TAX-04).     │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-18│ Multi-Row Lock Order │ PostgreSQL deadlock (40P01) │ All multi-item operations lock │ Client arrays sorted   │
│         │ Determinism (Dom H)  │ during concurrent sales or  │ products using `ORDER BY id    │ by product ID before   │
│         │                      │ inventory adjustments.      │ ASC FOR UPDATE`.               │ RPC payload dispatch.  │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Zero deadlocks logged│ `test_concurrent_inventory_ │ SPECIFIED                      │ Awaiting Tier 2 Multi- │
│         │ in Postgres logs.    │ allocation_no_deadlock` (T2)│ (Target Migration 015).        │ Connection Test Suite. │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-19│ Append-Only Audit    │ Cover-up of unauthorized    │ Trigger raises SQLSTATE 42501  │ Audit log viewer is    │
│         │ Tamper-Proofing (DomG│ changes by modifying audit  │ on any UPDATE or DELETE attempt│ read-only in UI.       │
│         │                      │ trail rows.                 │ on `public.audit_events`.      │                        │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Trigger definition in│ `test_audit_trail_tamper_   │ SPECIFIED                      │ Awaiting Migration 015 │
│         │ database catalog.    │ proofing_trigger` (Tier 1). │ (Target Migration 015).        │ execution.             │
├─────────┼──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│ **REQ-20│ Bare UUID Deprovision│ Loss of commercial tax audit│ Foreign keys to users use bare │ Deprovisioned users    │
│         │ Survival (Domain G)  │ history when auth accounts  │ UUIDs without CASCADE DELETE;  │ displayed as 'Former   │
│         │                      │ are deleted.                │ profiles sanitized; ledgers ok.│ Employee' in ledgers.  │
│         ├──────────────────────┼─────────────────────────────┼────────────────────────────────┼────────────────────────┤
│         │ Historical ledgers   │ `test_deprovisioning_ledger_│ SPECIFIED                      │ Awaiting Migration 015 │
│         │ retain creator UUID. │ survival` (Tier 1).         │ (Target Migration 015).        │ execution.             │
└─────────┴──────────────────────┴─────────────────────────────┴────────────────────────────────┴────────────────────────┘
```
