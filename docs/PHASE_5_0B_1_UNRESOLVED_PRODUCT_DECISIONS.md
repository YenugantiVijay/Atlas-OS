# PHASE 5.0B.1 — UNRESOLVED PRODUCT DECISIONS & PARAMETER REGISTER
## Formal Catalog of Open Product Governance Decisions, Parameter Approvals, and Statutory Review Items
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Product Governance & Decision Catalog — Pending Product Owner Sign-Off  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary

In strict accordance with Phase 5.0B.1 directives, this register isolates all **unresolved product decisions, numerical parameters, and statutory review items** from the confirmed architectural principles.

### 1.1 The Confirmed Architectural Baseline (DO NOT REOPEN)
The following decisions have been confirmed by the Product Owner and form the non-negotiable foundation of ATLAS OS:
- **DEC-01:** MULTIPLE OWNERS (Exactly one designated Primary Owner, zero or more Co-Owners).
- **Ownership Authority Model:** PRIMARY OWNER HAS RESERVED POWERS (Only Primary Owner can transfer primary ownership, remove co-owners, or close the organization).
- **DEC-11:** SINGLE ROLE PER MEMBERSHIP (Each membership holds exactly one operational role; ownership is decoupled into a dedicated table).
- **DEC-12:** VERIFIED PRIMARY OWNER RECOVERY (Controlled recovery protocol with multi-channel alerts, time-lock, and audit trails).
- **DEC-13:** CONFIGURABLE CRITICAL ACTION APPROVALS (Multi-tier approval workflows with absolute Separation of Duties).
- **DEC-14:** CONTROLLED CUSTOM ROLES (Tenant-defined custom operational roles with server-enforced monotonic delegation bounds).

---

## 2. Unresolved Product Decisions Requiring Product Owner Approval

The following items are proposed engineering defaults. They **require explicit Product Owner decision and sign-off** before implementation:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    OPEN PRODUCT DECISIONS FOR PRODUCT OWNER                                 │
├─────────┬───────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┤
│ Item ID │ Decision Subject              │ Proposed Engineering Default    │ Product Owner Options           │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-01**│ Approval Risk Thresholds      │ Tier 1: <= ₹25,000 (Auto)       │ [ ] Accept proposed defaults    │
│         │ (DEC-13 Numerical Parameters) │ Tier 2: ₹25K - ₹100K (1 Admin)  │ [ ] Adjust monetary amounts     │
│         │                               │ Tier 3: ₹100K - ₹500K (1 Exec)  │ [ ] Set single universal limit  │
│         │                               │ Tier 4: > ₹500K (Dual-Quorum)   │                                 │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-02**│ Approval Request Expiration   │ 72 Hours Time-To-Live (TTL)     │ [ ] 72 Hours (Recommended)      │
│         │ (DEC-13 Action Timeout)       │ Requests expire if unapproved   │ [ ] 48 Hours                    │
│         │                               │                                 │ [ ] 7 Days (Wholesale trade)    │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-03**│ Recovery Waiting Period       │ 14-Day Statutory Time-Lock      │ [ ] 14 Days (Recommended)       │
│         │ (DEC-12 Cooling Period)       │ Primary Owner can cancel anytime│ [ ] 7 Days                      │
│         │                               │                                 │ [ ] 30 Days                     │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-04**│ Co-Owner Recovery Voting      │ Supermajority (> 66%) of all    │ [ ] > 66% Supermajority (Rec.)  │
│         │ Quorum (DEC-12 Quorum)        │ active Co-Owners must approve   │ [ ] 50% + 1 Simple Majority     │
│         │                               │                                 │ [ ] 100% Unanimous              │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-05**│ Recovery Alert Channels       │ Email + SMS + WhatsApp          │ [ ] Email only (Phase 1)        │
│         │ (DEC-12 Notification Gateway) │ Multi-channel broadcast alerts  │ [ ] Email + SMS                 │
│         │                               │                                 │ [ ] Email + SMS + WhatsApp      │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-06**│ Sole-Owner Recovery KYC Gate  │ Compliance Officer Review of:   │ [ ] Automated Doc Upload        │
│         │ (Zero Co-Owners Fallback)     │ GST Cert + PAN + Udyam Reg      │ [ ] Manual Legal Review         │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-07**│ Branch Customer Master Policy │ Central Customer Master         │ [ ] Central Master (Shared)     │
│         │ (Workstream C Scope)          │ Shared across all branches;     │ [ ] Isolated per Branch         │
│         │                               │ credit tracked globally         │                                 │
├─────────┼───────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ **PO-08**│ Deprovisioning Request Audit  │ 1 Year Retention in DB,         │ [ ] 90 Days                     │
│         │ Retention Period (RET-01)     │ then cold storage archive       │ [ ] 1 Year (Recommended)        │
│         │                               │                                 │ [ ] Permanent Database Retain   │
└─────────┴───────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

---

## 3. Detailed Decision Briefs for Product Owner

### 3.1 PO-01: Financial Approval Thresholds
- **Context:** In Indian electrical goods retail and wholesaling, invoice values vary dramatically between retail counter sales (₹500 to ₹10,000) and commercial B2B contract dispatches (₹200,000 to ₹2,000,000+).
- **Recommendation:** Adopt the 4-tier model with the default thresholds (₹25K, ₹100K, ₹500K) as an initial system template, while allowing each tenant to customize these thresholds via the `public.approval_rules` configuration UI.

### 3.2 PO-03: Primary Owner Recovery Time-Lock
- **Context:** If a malicious Co-Owner initiates a fraudulent recovery request claiming the Primary Owner is unavailable, the Primary Owner must have sufficient time to receive alerts, log in, and cancel the request.
- **Recommendation:** **14 Days**. 7 days risks accidental takeover if an owner is on international travel or hospitalized; 30 days is too long for business continuity. 14 days strikes the optimal balance between security and commercial continuity.

### 3.3 PO-05: Recovery Notification Channels
- **Context:** Email alerts can be missed or routed to spam. SMS and WhatsApp require third-party gateway integrations (e.g., Twilio, Gupshup, Meta Cloud API).
- **Recommendation:** Phase 1 implementation uses **Email Alerts** with synchronous in-app push banners. Phase 2 introduces SMS/WhatsApp integration.

### 3.4 PO-07: Branch Customer Sharing
- **Context:** In electrical trade, an electrical contractor (customer) may purchase PVC conduit at Branch A and switchboards at Branch B.
- **Recommendation:** **Central Customer Master**. The customer database is shared tenant-wide, with credit limits tracked centrally across all branches, while individual invoices, payments, and dispatches are stamped with `branch_id`.

---

## 4. Statutory & Legal Decision Register (Certified Tax Counsel / CA Sign-Off)

The following decisions govern compliance with Indian GST statutory mandates. They cannot be decided by engineering or the Product Owner alone:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   STATUTORY TAX & LEGAL DECISION REGISTER                                   │
├─────────┬───────────────────────────────┬───────────────────────────────────┬───────────────────────────────┤
│ Item ID │ Statutory Subject             │ Legal Question / Rule Reference   │ Current Architecture Baseline │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-01│ Draft Invoice Numbering       │ Does storing unnumbered drafts    │ DEC-02: Unnumbered drafts;    │
│         │ (Rule 46 CGST Rules 2017)     │ violate consecutive numbering?    │ sequence allocated at ISSUED. │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-02│ Document Amount Ceilings      │ Is a ₹100,000,000 system ceiling  │ DEC-03: NUMERIC(12,2) with    │
│         │ (Statutory Upper Bound)       │ compliant with commercial trade?  │ ₹100M check constraint.       │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-03│ Invoice Cancellation vs CN    │ Does Rule 53 mandate Credit Notes │ DEC-04: Credit Notes mandated;│
│         │ (Section 34 CGST Act 2017)    │ for all post-issuance corrections?│ zero cancellation post-issue. │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-04│ Odd-Paisa Tax Splitting       │ Does rounding CGST and SGST at the│ DEC-08: Integer line floor    │
│         │ (CGST & SGST Reconciliation)  │ line level comply with GST filing?│ with invoice summary balance. │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-05│ Consecutive Sequence Gaps     │ Does Rule 46 strictly prohibit any│ DEC-09: Row lock on sequence; │
│         │ (Rule 46 Strict Gap Policy)   │ gaps in serial numbering?         │ zero gaps permitted.          │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────────┤
│ **TAX-06│ Financial Record Retention    │ Is 72 months the statutory record │ RET-02: 72-month retention    │
│         │ (Section 36 CGST Act 2017)    │ retention mandate?                │ mandate enforced in DB.       │
└─────────┴───────────────────────────────┴───────────────────────────────────┴───────────────────────────────┘
```

---

## 5. Sign-Off Blocks

### Product Owner Governance Sign-Off:
- [ ] **PO-01 through PO-08 Decisions Approved:** ___________________________ (Date: ____________)

### Certified Tax Counsel / CA Sign-Off:
- [ ] **TAX-01 through TAX-06 Decisions Approved:** ___________________________ (Date: ____________)
