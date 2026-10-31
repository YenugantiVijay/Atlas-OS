# PHASE 5.0C — SECURITY & DATABASE CONTROL CATALOG
## Authoritative Catalog: Database Security Controls, RLS Policies, Privilege Boundaries, and Frontend vs Server Enforcement
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Database & Application Security Control Specification  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Defense-in-Depth Philosophy

ATLAS OS adopts a strict **defense-in-depth, zero-trust database security model**. 

Under this model, the application user interface (frontend) is treated as an inherently untrusted presentation layer. Frontend checks, form validations, and conditional UI renderings are considered user convenience features—**never security boundaries**. 

Every invariant, tenant boundary, financial constraint, separation-of-duties rule, and permission check is enforced at the PostgreSQL database engine layer via:
1. **Row Level Security (RLS)** policies evaluated on every database query.
2. **Closed-Door Database Privileges** (revoking direct DML from web clients).
3. **Database Constraints & Triggers** (preventing illegal mutations, sequence gaps, and multi-owner corruption).
4. **Hardened SECURITY DEFINER Stored Procedures** with immutable search paths.

---

## 2. Comprehensive Security Control Catalog

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS DATABASE SECURITY CONTROL CATALOG                                       │
├─────────┬────────────────────────────┬─────────────────────────────┬───────────────────────────┬───────────────────────┤
│ Ctrl ID │ Security Domain            │ Technical Control Mechanism │ Database Enforcement Mode │ Frontend Role         │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-01│ Multi-Tenant Isolation     │ PostgreSQL Row Level        │ MANDATORY DATABASE:       │ Context provider sets │
│         │ (Tenant Data Boundaries)   │ Security (RLS) on all tables│ Evaluated per query plan; │ active organization ID│
│         │                            │                             │ no tenant leak possible.  │ for user convenience. │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼──────────────────────┤
│ **SEC-02│ Direct REST DML Protection │ Closed-Door Privilege Model:│ MANDATORY DATABASE:       │ Client invokes RPCs;  │
│         │ (PostgREST API Gateway)    │ REVOKE INSERT/UPDATE/DELETE │ Direct REST writes return │ zero direct Supabase  │
│         │                            │ from `authenticated`/`anon` │ SQLSTATE 42501.           │ `.from().insert()`.   │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-03│ Cross-Tenant Referential   │ Composite Foreign Keys:     │ MANDATORY DATABASE:       │ Dropdowns filter items│
│         │ Integrity (Parent Linking) │ FKs reference `(org_id, id)`│ Blocks referencing parent │ by active tenant.     │
│         │                            │ with matching tenant ID.    │ entity of another tenant. │ (Purely UX).          │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-04│ Trojan Schema / Path       │ Fixed Function Search Paths:│ MANDATORY DATABASE:       │ None.                 │
│         │ Injection Protection       │ `SET search_path = public,  │ Prevents hijacking via    │ (Transparent).        │
│         │                            │ pg_temp` on all RPCs.       │ user-defined schemas.     │                       │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-05│ Service Role Data Loss     │ Administrative Privilege    │ MANDATORY DATABASE:       │ None.                 │
│         │ Prevention (Rogue Scripts) │ Revocation: REVOKE TRUNCATE/│ Blocks catastrophic wiping│ (Transparent).        │
│         │                            │ DELETE from `service_role`. │ of audit/ledger tables.   │                       │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-06│ Exactly One Primary Owner  │ Dual Invariant Guard:       │ MANDATORY DATABASE:       │ Disables delete button│
│         │ Protection (DEC-01)        │ Partial Unique Index +      │ Blocks 0 or >1 Primary    │ on Primary Owner row  │
│         │                            │ Deferred Constraint Trigger.│ Owners at transaction end.│ in team settings.     │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-07│ Primary Owner Deactivation │ Compound Ownership Guard:   │ MANDATORY DATABASE:       │ Disables suspend/kick │
│         │ Guard (DEC-11)             │ Trigger blocks deactivating │ Raises SQLSTATE 42501 on  │ button for active     │
│         │                            │ active Primary Owner row.   │ attempted deactivation.   │ Primary Owner.        │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-08│ Monotonic Custom Role      │ Privilege Escalation Guard: │ MANDATORY DATABASE:       │ Checkboxes disabled   │
│         │ Delegation (DEC-14)        │ Trigger verifies grantable  │ Cannot grant permissions  │ for permissions not   │
│         │                            │ permissions subset boundary.│ outside delegator scope.  │ held by delegator.    │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-09│ Central Customer Credit    │ Branch View Field Masking:  │ MANDATORY DATABASE:       │ Masked fields render  │
│         │ Term Protection (PO-07)    │ `branch_accessible_cust`    │ Branch sales roles cannot │ as '***' or are hidden│
│         │                            │ masks credit limit & aging. │ query sensitive columns.  │ in branch views.      │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-10│ Separation of Duties (SoD) │ Anti-Self-Approval Trigger: │ MANDATORY DATABASE:       │ Approve button hidden │
│         │ Protection (PO-01)         │ Trigger asserts `decided_by │ Raises SQLSTATE 42501 if  │ for requester on their│
│         │                            │ != request.initiated_by`.   │ requester tries to sign.  │ own requests.         │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-11│ Dual-Distinct Approver     │ Dual Signature Quorum Check:│ MANDATORY DATABASE:       │ UI requires 2 separate│
│         │ Quorum Protection (PO-01)  │ Trigger asserts distinct    │ Rejects single approver   │ logins to submit both │
│         │                            │ approvers on Tier 4 items.  │ committing Tier 4 request.│ approval signatures.  │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-12│ Financial Ledger           │ Immutable Ledger Trigger:   │ MANDATORY DATABASE:       │ UI disables edit and  │
│         │ Immutability (Domain F)    │ Blocks UPDATE or DELETE on  │ Raises SQLSTATE 42501 on  │ delete buttons on     │
│         │                            │ issued invoices & payments. │ any write to issued docs. │ finalized documents.  │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-13│ Gapless Invoice Sequence   │ Row Lock Sequence Generator:│ MANDATORY DATABASE:       │ Sequence number field │
│         │ Numbering (Rule 46)        │ `FOR UPDATE` lock held on   │ Prevents duplicate/gapped │ read-only; auto-      │
│         │                            │ sequence row at ISSUANCE.   │ numbers across workers.   │ generated on publish. │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-14│ Audit Trail Tamper         │ Immutability Trigger:       │ MANDATORY DATABASE:       │ Audit UI is read-only;│
│         │ Protection (Domain G)      │ `trg_prevent_audit_tamper`  │ Blocks all UPDATE/DELETE  │ zero edit/delete      │
│         │                            │ raises SQLSTATE 42501.      │ attempts in audit_events. │ controls present.     │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-15│ Trusted Actor Attribution  │ Server-Side Auth Binding:   │ MANDATORY DATABASE:       │ UI sends auth JWT;    │
│         │ (Anti-Spoofing Guard)      │ Actor UUID derived from     │ Ignores user-supplied     │ client actor payload  │
│         │                            │ `auth.uid()` in RPCs.       │ actor fields in payload.  │ is ignored.           │
├─────────┼────────────────────────────┼─────────────────────────────┼───────────────────────────┼───────────────────────┤
│ **SEC-16│ Statutory Legal Hold       │ Retention Override Lock:    │ MANDATORY DATABASE:       │ System displays banner│
│         │ Suspension Guard (PO-08)   │ `legal_hold = TRUE` blocks  │ Triggers block partition  │ indicating active     │
│         │                            │ archival partition drops.   │ drop & profile purge.     │ legal hold.           │
└─────────┴────────────────────────────┴─────────────────────────────┴───────────────────────────┴───────────────────────┘
```

---

## 3. Explicit Frontend vs Server-Side Enforcement Audit

To avoid architectural security vulnerabilities, the table below highlights controls where frontend-only validation would create critical attack vectors:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     FRONTEND VS DATABASE ENFORCEMENT AUDIT                                             │
├────┬─────────────────────────────┬────────────────────────────────────┬────────────────────────────────────────────────┤
│ #  │ Security Domain             │ Dangerous Frontend-Only Assumption │ Mandatory Database Server-Side Enforcement     │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 01 │ Approval Threshold Routing  │ Frontend decides whether an invoice│ Database RPC evaluates `approval_rules` under  │
│    │                             │ needs approval before saving.      │ row lock; directly sets `PENDING_APPROVAL`.    │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 02 │ Separation of Duties (SoD)  │ Frontend hides the "Approve" button│ Database trigger rejects approval if           │
│    │                             │ from the user who created it.      │ `decided_by == initiated_by` (SQLSTATE 42501). │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 03 │ Credit Limit Enforcement    │ Frontend blocks checkout if invoice│ Database RPC checks customer balance + total   │
│    │                             │ exceeds customer credit limit.     │ against `credit_limit` under customer row lock.│
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 04 │ Branch Data Masking         │ Frontend simply doesn't display    │ Database security-barrier view or column grants│
│    │                             │ credit terms in the table.         │ physically omit sensitive columns from query.  │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 05 │ Invoice Immutability        │ Frontend disables the "Edit" and   │ Database trigger raises SQLSTATE 42501 on any  │
│    │                             │ "Delete" buttons on issued orders. │ direct SQL UPDATE or DELETE on issued invoice. │
├────┼─────────────────────────────┼────────────────────────────────────┼────────────────────────────────────────────────┤
│ 06 │ Actor Attribution           │ Frontend sends `{ actor_id: ... }` │ Database RPC overrides payload and extracts    │
│    │                             │ in the request JSON payload.       │ actor directly from `auth.uid()`.              │
└────┴─────────────────────────────┴────────────────────────────────────┴────────────────────────────────────────────────┘
```

---

## 4. Database Privilege & Role Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       DATABASE ROLE PRIVILEGE SPECIFICATION                                            │
├────────────────────┬─────────────────────────────┬─────────────────────────────┬───────────────────────────────────────┤
│ PostgreSQL Role    │ Target Object Schema        │ Granted Privileges          │ Revoked / Blocked Privileges          │
├────────────────────┼─────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
│ `anon`             │ Operational Tables          │ NONE                        │ ALL DIRECT ACCESS REVOKED             │
│                    │ Public Functions            │ EXECUTE on login/register   │ EXECUTE on operational business RPCs  │
├────────────────────┼─────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
│ `authenticated`    │ Operational Tables          │ SELECT (subject to RLS)     │ INSERT, UPDATE, DELETE (Direct DML)   │
│                    │ Stored Procedures (RPCs)    │ EXECUTE on authorized RPCs  │ Direct table mutation blocked         │
├────────────────────┼─────────────────────────────┼─────────────────────────────┼───────────────────────────────────────┤
│ `service_role`     │ Operational Tables          │ SELECT, INSERT, UPDATE      │ TRUNCATE, DELETE on ledgers & audit   │
│ (Background Admin) │ Migration / Maintenance     │ DDL execution in migrations │ Dropping audit tables without trigger │
└────────────────────┴─────────────────────────────┴─────────────────────────────┴───────────────────────────────────────┘
```
