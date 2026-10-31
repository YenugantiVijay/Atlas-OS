# PHASE 5.0A — IMPLEMENTATION READINESS CHECKLIST
## Implementation Governance, Human Decision Gates, and Deployment Prerequisites
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Operational Governance & Implementation Readiness Checklist — Design Only  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Readiness Verdict

This document establishes the binding **Implementation Readiness Checklist** for ATLAS OS Migration 015. It articulates every pre-requisite, legal sign-off, catalog verification, and technical gate required before Migration 015 SQL authoring (Phase 5.0B) and staging execution (Phase 5.0D) can be authorized.

### Phase 5.0A Architectural Readiness Verdict

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│                 CONDITIONALLY READY — EVIDENCE GAPS REMAIN                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

#### Meaning of This Verdict:
1. **Design & Test Specifications Completed:** Documents A ([PHASE_5_0A_MIGRATION_015_SECURITY_CONTRACT.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0A_MIGRATION_015_SECURITY_CONTRACT.md)) and B ([PHASE_5_0A_AUTOMATED_SECURITY_TEST_SPECIFICATION.md](file:///d:/Projects/Atlas-OS/docs/PHASE_5_0A_AUTOMATED_SECURITY_TEST_SPECIFICATION.md)) are fully drafted and architecturally sound.
2. **Implementation Planning Authorized:** The engineering team is authorized to prepare the procedural test harnesses and frontend service adapters.
3. **DDL Authoring & Execution Blocked:** In accordance with safety rules, **no SQL migration file may be created or applied** until the specific human decision gates and remote catalog verifications listed below are formally closed.

---

## 2. Human Decision Register: Executive Leadership Sign-Off

The following decisions directly determine database schema constraints, unique indexes, and domain models. They cannot be decided autonomously by engineering.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               EXECUTIVE LEADERSHIP DECISION GATES                                │
├─────────────┬──────────────────────────┬─────────────────────────────┬───────────────────────────┤
│ Decision ID │ Decision Subject         │ Technical Options           │ Implementation Impact     │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-01**  │ Owner Cardinality Model  │ [ ] Option A: Single Owner  │ Option A creates partial  │
│             │                          │ [ ] Option B: Co-Owners     │ unique index on owner;    │
│             │                          │                             │ Option B requires triggers│
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-11**  │ Membership Role          │ [ ] Option A: Single Role   │ Option A maintains schema;│
│             │ Cardinality              │ [ ] Option B: Multi-Role    │ Option B requires junction│
│             │                          │                             │ table & breaking rewrites │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **RET-01**  │ Deprovisioning Request   │ [ ] 90-day retention        │ Governs background worker │
│             │ Record Retention         │ [ ] 1-year retention        │ cleanup of soft-deleted   │
│             │                          │ [ ] Permanent audit retain  │ deprovisioning audit logs │
└─────────────┴──────────────────────────┴─────────────────────────────┴───────────────────────────┘
```

### Sign-Off Blocks:
- [ ] **DEC-01 Formal Approval:** ___________________________ (Date: ____________)
- [ ] **DEC-11 Formal Approval:** ___________________________ (Date: ____________)
- [ ] **RET-01 Formal Approval:** ___________________________ (Date: ____________)

---

## 3. Human Decision Register: Certified Tax Counsel / CA Sign-Off

The following decisions govern Indian Goods and Services Tax (GST) statutory compliance, invoice numbering rules under Rule 46 of the CGST Rules 2017, and credit note requirements under Section 34 of the CGST Act.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               CERTIFIED TAX COUNSEL / CA DECISION GATES                          │
├─────────────┬──────────────────────────┬─────────────────────────────┬───────────────────────────┤
│ Decision ID │ Decision Subject         │ Technical Options           │ Statutory & DDL Impact    │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-02**  │ Draft Invoice Numbering  │ [ ] Unnumbered Drafts       │ Recommended: Unnumbered   │
│             │ Rule 46 CGST Compliance  │ [ ] Temporary Draft Sequence│ Drafts prevent sequence   │
│             │                          │                             │ gaps on discarded drafts  │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-03**  │ Document Amount          │ [ ] ₹100,000,000 ceiling    │ Protects against integer  │
│             │ Upper Bound Ceilings     │ [ ] Custom business limit   │ overflow in NUMERIC(12,2) │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-04**  │ Invoice Cancellation vs  │ [ ] Cancellation permitted  │ Rule 53 compliance:       │
│             │ Credit Note Workflow     │ [ ] Credit Notes only       │ Mandates Credit Notes for │
│             │                          │                             │ issued/reported invoices  │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-08**  │ Odd-Paisa GST Tax        │ [ ] Independent Line Round  │ Reconciles ₹0.01 rounding │
│             │ Component Splitting      │ [ ] Combined Split Floor    │ drift between CGST & SGST │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **DEC-09**  │ Invoice Sequence         │ [ ] Strict FOR UPDATE lock  │ Rule 46 mandates strict   │
│             │ Strict Gap Policy        │ [ ] Sequence Objects (Gaps) │ consecutive sequences     │
├─────────────┼──────────────────────────┼─────────────────────────────┼───────────────────────────┤
│ **RET-02**  │ Statutory Financial      │ [ ] Strict 72 Months        │ Mandated by Section 36 of │
│             │ Retention Period         │ [ ] 8 Years Statutory       │ the CGST Act 2017         │
└─────────────┴──────────────────────────┴─────────────────────────────┴───────────────────────────┘
```

### Sign-Off Blocks:
- [ ] **DEC-02 / DEC-04 / DEC-08 / DEC-09 Tax Approval:** ___________________________ (Date: ____________)
- [ ] **RET-02 Statutory Retention Approval:** ___________________________ (Date: ____________)

---

## 4. Staging Remote Catalog Evidence Gate (Blocker BLK-01)

### 4.1 Description of Blocker BLK-01
In the local development environment, migrations `012_organization_creation_rpc.sql`, `013_business_eligibility_and_trials.sql`, and `014_harden_operational_rls_with_eligibility.sql` exist only as untracked files in the working tree. Because direct psql access to remote staging project `bwswqnhlebbzdxumlkih` is currently unavailable in the local sandbox, their remote deployment status remains **UNVERIFIED**.

### 4.2 Verification Protocol
Before authoring Migration 015 DDL, an operator with database administrative access must connect to staging `bwswqnhlebbzdxumlkih` and execute:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
      'organization_creation_idempotency',
      'organization_eligibility',
      'organization_subscriptions',
      'eligibility_audit_logs',
      'platform_reviewers'
  );

SELECT proname 
FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace 
  AND proname IN (
      'create_organization',
      'can_read_organization_data',
      'can_write_organization_operations',
      'self_declare_organization_eligibility'
  );
```

### Sign-Off Block:
- [ ] **BLK-01 Remote Staging Catalog Verified:** ___________________________ (Date: ____________)

---

## 5. Migration Dependencies & Pre-Conditions

Before Migration 015 can be applied to any database:
1. **Zero Multi-Owner Organizations (if DEC-01 Option A):**
   Execute pre-check query:
   ```sql
   SELECT organization_id, count(*) 
   FROM public.memberships 
   WHERE role = 'owner' AND is_active = TRUE 
   GROUP BY organization_id 
   HAVING count(*) > 1;
   ```
   *Expected count: 0.* If $>0$, run deterministic remediation script demoting secondary owners to `admin`.
2. **Zero Invoices in Inconsistent State:**
   Assert zero invoices with `status = 'ISSUED'` have zero line items in `invoice_items`.
3. **Sequence Alignment:**
   Assert all entries in `document_sequences` have `last_number >= MAX(current numbers)` in commercial tables.

---

## 6. Implementation Sequence (Phased Rollout Plan)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    PHASED IMPLEMENTATION ROLLOUT ROADMAP                   │
├────────────┬─────────────────────────────┬─────────────────────────────────┤
│ Phase      │ Deliverable / Activity      │ Primary Objective               │
├────────────┼─────────────────────────────┼─────────────────────────────────┤
│ **5.0A**   │ Security Contract & Tests   │ CURRENT PHASE: Complete design  │
│            │ (Documentation Only)        │ specifications and test matrix  │
├────────────┼─────────────────────────────┼─────────────────────────────────┤
│ **5.0B**   │ Author Migration 015 DDL    │ Author authoritative SQL file   │
│            │ `015_hardening.sql`         │ incorporating signed decisions  │
├────────────┼─────────────────────────────┼─────────────────────────────────┤
│ **5.0C**   │ Frontend Service Adapters   │ Update `team.service.ts` and    │
│            │ Application Integration     │ `invoices.service.ts` for RPCs  │
├────────────┼─────────────────────────────┼─────────────────────────────────┤
│ **5.0D**   │ Staging Deployment Dry-Run  │ Apply to staging; run full      │
│            │ Automated Test Execution    │ test suite (Tier 1, 2, 3)       │
├────────────┼─────────────────────────────┼─────────────────────────────────┤
│ **5.0E**   │ Production Gate & Deploy    │ Executive sign-off; apply to    │
│            │ Final Cutover               │ production during maintenance   │
└────────────┴─────────────────────────────┴─────────────────────────────────┘
```

---

## 7. Rollback & Disaster Recovery Strategy

1. **Strictly Non-Destructive DDL:**
   Migration 015 executes zero `DROP TABLE` or `DROP COLUMN` commands. All existing tables and historical data remain structurally untouched.
2. **Reversible Privileges & Triggers:**
   In the event of an unexpected regression in staging:
   - Immutability triggers can be temporarily disabled: `ALTER TABLE public.invoices DISABLE TRIGGER trg_enforce_invoice_immutability;`
   - Table DML privileges can be restored: `GRANT INSERT, UPDATE, DELETE ON public.memberships TO authenticated;`
3. **Zero Data Loss Guarantee:**
   Because all financial and membership records survive identity deletion, a rollback never risks data destruction.

---

## 8. Final Go/No-Go Decision Gate

To achieve final `GO` status for Migration 015 deployment:

- [ ] **Document A Approved:** Migration 015 Security Contract reviewed and approved by Principal Architect.
- [ ] **Document B Approved:** Automated Test Specification reviewed and approved by QA Lead.
- [ ] **DEC-01 & DEC-11 Approved:** Formal decision recorded by Executive Leadership.
- [ ] **DEC-02, 04, 08, 09 Approved:** Formal sign-off recorded by Certified Tax Counsel / CA.
- [ ] **BLK-01 Verified:** Staging remote catalog confirmed via direct administrative query.
- [ ] **Tier 1 Tests Passing:** Vitest local unit tests passing at 100%.
- [ ] **Tier 2 Tests Passing:** pgTAP database tests passing in isolated test container.
- [ ] **Tier 3 Tests Passing:** End-to-end multi-tenant concurrency tests passing in staging.
- [ ] **Zero Deadlock Verification:** Verified 0 occurrences of PostgreSQL error `40P01` under concurrent load.
