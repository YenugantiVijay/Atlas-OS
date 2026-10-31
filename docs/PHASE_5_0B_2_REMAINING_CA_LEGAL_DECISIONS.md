# PHASE 5.0B.2 — REMAINING CA & LEGAL DECISION REGISTER
## Formal Catalog of Statutory GST Questions, Tax Counsel Review Items, and Regulatory Privacy Gates
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Statutory & Legal Review Register — Awaiting Professional Sign-Off  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Regulatory Boundary

While all Product Owner decisions (`PO-01` through `PO-08`) have been approved and frozen in Phase 5.0B.2, statutory compliance under the **Central Goods and Services Tax (CGST) Act 2017** and the **Digital Personal Data Protection (DPDP) Act 2023** cannot be established autonomously by engineering or product management.

This document formally isolates all remaining **tax, statutory, and legal questions** requiring certified professional review prior to production deployment.

In strict adherence to Phase 5.0B.2 restrictions, **no application code was modified, no database migrations were created or applied, no database connections were established, and production was untouched.**

---

## 2. Statutory GST Tax Counsel Review Items (TAX-01 Through TAX-06)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   STATUTORY GST & FINANCIAL DECISION REGISTER                                          │
├─────────┬───────────────────────────────┬───────────────────────────────────┬──────────────────────────────────────────┤
│ Item ID │ Statutory Subject             │ Legal Question / Rule Reference   │ Architecture Baseline & Recommendation   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **TAX-01│ Draft Invoice Numbering       │ Does storing unnumbered drafts    │ DEC-02: Draft invoices remain unnumbered;│
│         │ (Rule 46 CGST Rules 2017)     │ violate consecutive numbering?    │ sequential number allocated at ISSUED.   │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────┤
│ **TAX-02│ Document Amount Ceilings      │ Is a ₹100,000,000 ceiling         │ DEC-03: `NUMERIC(12, 2)` bounds single   │
│         │ (Technical Bounds)            │ sufficient for commercial trade?  │ invoice total to ₹100M.                  │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **TAX-03│ Invoice Cancellation vs CN    │ Does Rule 53 mandate Credit Notes │ DEC-04: Issued invoices cannot be deleted│
│         │ (Section 34 CGST Act 2017)    │ for all post-issuance corrections?│ or cancelled; Credit Notes are mandated. │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **TAX-04│ Odd-Paisa GST Tax Splitting   │ Does integer-line rounding comply │ DEC-08: Integer line floor with summary  │
│         │ (CGST & SGST Reconciliation)  │ with GSTR-1 filing tables?        │ residual balancing between CGST & SGST.  │
├─────────┼───────────────────────────────┼───────────────────────────────────┼───────────────────────────┤
│ **TAX-05│ Consecutive Sequence Gaps     │ Does Rule 46 strictly prohibit any│ DEC-09: Sequence table row lock prevents │
│         │ (Rule 46 Strict Gap Policy)   │ numbering gaps in audit trails?   │ gaps; sequence objects rejected.         │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **TAX-06│ Statutory Record Retention    │ Is 72 months the binding statutory│ RET-02: 72 months from annual return due │
│         │ (Section 36 CGST Act 2017)    │ financial retention period?       │ date enforced via immutable triggers.    │
└─────────┴───────────────────────────────┴───────────────────────────────────┴──────────────────────────────────────────┘
```

---

## 3. Regulatory Data Protection & Legal Governance (LEG-01, LEG-02)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PRIVACY & CORPORATE GOVERNANCE REVIEW ITEMS                                          │
├─────────┬───────────────────────────────┬───────────────────────────────────┬──────────────────────────────────────────┤
│ Item ID │ Governance Domain             │ Legal Question / Statutory Act    │ Architecture Baseline & Security Control │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **LEG-01│ KYC & Identity Data Handling  │ Compliance with DPDP Act 2023 on  │ Encrypted storage for uploaded Aadhaar,  │
│         │ (Sole-Owner Recovery PO-06)   │ storage, retention, and deletion  │ PAN, and Incorporation proofs; restricted│
│         │                               │ of identity documentation.        │ access to verified compliance reviewers. │
├─────────┼───────────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ **LEG-02│ Co-Owner Legal Status         │ Does ERP "Co-Owner" status imply  │ Explicit Terms of Service clarification: │
│         │ (Indian Partnership Act 1932) │ legal partnership or tax liability│ Co-Ownership is an in-app RBAC tier and  │
│         │                               │ under Indian commercial law?      │ does not establish legal partnership.    │
└─────────┴───────────────────────────────┴───────────────────────────────────┴──────────────────────────────────────────┘
```

---

## 4. Detailed Professional Review Briefs

### 4.1 TAX-01 & TAX-05: Consecutive Numbering & Sequence Gaps (Rule 46)
- **Technical Context:** In electrical contracting, customers frequently request quotes or draft pro-forma invoices that are subsequently abandoned or renegotiated. If an official GST tax invoice number is allocated upon draft creation, abandoning the draft causes a **sequence gap** (e.g., `INV-001`, `INV-003` with `INV-002` missing).
- **Architecture Position:** Storing drafts with `status = 'DRAFT'` and `invoice_number = NULL` (or a temporary prefix `DRAFT-UUID`), and allocating the official consecutive sequence from `document_sequences` under `FOR UPDATE` row lock **only when status transitions to `ISSUED`**.
- **Question for Tax Counsel:** Does this allocation-on-issuance workflow fully satisfy the Rule 46 requirement that invoices be serialized consecutively in one or multiple series?

### 4.2 TAX-03: Post-Issuance Corrections & Credit Notes (Section 34)
- **Technical Context:** Users occasionally request a "cancel invoice" button to undo an invoice issued by mistake.
- **Architecture Position:** Migration 015 triggers strictly block `UPDATE` and `DELETE` on issued invoices. If an invoice was issued with incorrect amounts or items, the user must issue an official **GST Credit Note** linked to the original invoice, which reverses GST liability and restores inventory via a return inward.
- **Question for Tax Counsel:** Does Indian GST law permit any window where an unpaid, un-uploaded invoice can be cancelled without a Credit Note, or should ATLAS OS enforce Credit Notes universally?

### 4.3 TAX-04: Odd-Paisa GST Splitting Reconciliation
- **Technical Context:** For an intra-state taxable item of ₹10.01 at 18% GST:
  $$\text{Tax} = ₹1.8018 \implies \text{CGST 9\%} = ₹0.9009, \quad \text{SGST 9\%} = ₹0.9009$$
  If rounded independently to 2 decimal places: $\text{CGST} = ₹0.90, \text{SGST} = ₹0.90 \implies \text{Total Tax} = ₹1.80$ (leaving ₹0.0018 residual).
- **Architecture Position:** The system rounds line CGST and SGST to the nearest integer paisa using half-up rounding, and reconciles the invoice-level tax summary to match the sum of lines.
- **Question for Tax Counsel:** Does line-level rounding with invoice summary balancing comply with the JSON schema requirements of the GST E-Invoicing System (IRN portal) and GSTR-1?

---

## 5. Professional Sign-Off Attestation Blocks

The technical implementation of Migration 015 financial triggers remains gated until the following sign-offs are completed:

### Certified Tax Counsel / CA Sign-Off:
- [ ] **TAX-01 through TAX-06 Formally Approved:** ___________________________ (Date: ____________)
- **Practicing Membership Number:** ___________________________

### Qualified Legal Counsel Sign-Off:
- [ ] **LEG-01 and LEG-02 Formally Approved:** ___________________________ (Date: ____________)
- **Bar Council Registration Number:** ___________________________
