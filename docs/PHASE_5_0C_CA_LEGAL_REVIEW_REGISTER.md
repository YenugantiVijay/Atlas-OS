# PHASE 5.0C — CA & LEGAL REVIEW REGISTER
## Authoritative Catalog of Statutory GST Questions, Tax Counsel Briefs, and Regulatory Privacy Gates
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Statutory, Tax & Regulatory Legal Register — Awaiting Professional Sign-Off  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Regulatory Boundary

Engineering and product architecture can design robust cryptographic and database controls, but **engineering cannot independently certify statutory compliance under Indian tax and data protection laws**. 

Declaring compliance with the **Central Goods and Services Tax (CGST) Act 2017** or the **Digital Personal Data Protection (DPDP) Act 2023** without formal sign-off from accredited legal counsel and practicing Chartered Accountants constitutes severe enterprise risk.

This register isolates all unresolved statutory tax, privacy, and commercial governance questions as **mandatory external dependencies**. Migration 015 financial triggers and production onboarding are conditionally gated upon formal completion of this register.

---

## 2. Professional Review Item Register

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       STATUTORY & LEGAL DECISION REGISTER                                              │
├─────────┬────────────────────────────┬───────────────────────────────────┬─────────────────────────────────────────────┤
│ Item ID │ Legal / Tax Domain         │ Statutory Question & Act Context  │ Architecture Baseline & Recommendation      │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-01│ Draft Invoice Numbering    │ Does storing unnumbered drafts    │ DEC-02: Drafts remain unnumbered (`NULL`);  │
│         │ (Rule 46 CGST Rules 2017)  │ violate consecutive serialization │ sequential tax invoice number allocated only│
│         │                            │ mandates in wholesale retail?     │ when status transitions to `ISSUED`.        │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-02│ Document Amount Ceilings   │ Is a ₹100,000,000 single document │ DEC-03: `NUMERIC(12, 2)` bounds document    │
│         │ (Technical Bounds)         │ ceiling sufficient for wholesale? │ total to ₹100M. Confirm sufficiency.        │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-03│ Invoice Cancellation vs CN │ Does Section 34 mandate Credit    │ DEC-04: Issued invoices cannot be cancelled │
│         │ (Section 34 CGST Act 2017) │ Notes for all post-issuance fixes?│ or deleted; Credit Notes are mandated.      │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-04│ Odd-Paisa Tax Splitting    │ Does line-item integer rounding   │ DEC-08: Integer line floor with summary     │
│         │ (CGST & SGST Balancing)    │ comply with GSTR-1 & IRN schemas? │ residual balancing between CGST & SGST.     │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-05│ Consecutive Sequence Gaps  │ Does Rule 46 strictly prohibit any│ DEC-09: Sequence table row lock prevents    │
│         │ (Rule 46 Strict Gap Policy)│ numbering gaps in audit trails?   │ gaps; sequence objects rejected.            │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **TAX-06│ Statutory Record Retention │ Is 72 months from annual return   │ RET-02: 72 months from annual return due    │
│         │ (Section 36 CGST Act 2017) │ due date the binding horizon?     │ date (~79 months) enforced via triggers.    │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **LEG-01│ KYC & Identity Privacy     │ Compliance with DPDP Act 2023 on  │ Data minimization; provider assertion tokens│
│         │ (Sole-Owner Recovery PO-06)│ storage, retention, and deletion. │ preferred; 30-day purge for raw proofs.     │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **LEG-02│ Co-Owner Legal Status      │ Does ERP "Co-Owner" role imply    │ Explicit Terms of Service clarification:    │
│         │ (Indian Partnership Act)   │ legal partnership or tax liability│ Co-Ownership is an in-app RBAC tier only.   │
├─────────┼────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────┤
│ **LEG-03│ Statutory Legal Holds      │ Does temporary suspension of PII  │ RET-04 / Hold State Machine: Dispute freeze │
│         │ (Dispute & Litigation)     │ erasure during fraud violate DPDP?│ explicitly permitted under Section 8(7).    │
└─────────┴────────────────────────────┴───────────────────────────────────┴─────────────────────────────────────────────┘
```

---

## 3. Professional Review Briefs for Tax & Legal Counsel

### 3.1 Brief for Chartered Accountant / Tax Counsel (TAX-01 Through TAX-06)
1. **Consecutive Numbering on Issuance (TAX-01 & TAX-05):**
   - *Technical Position:* When an electrical contractor requests an estimate, ATLAS OS creates a draft with `invoice_number = NULL`. Only when the contractor confirms payment/credit and the invoice transitions to `ISSUED` does the system lock `document_sequences` and allocate consecutive serial number `INV-2026-0001`.
   - *Question for CA:* Does postponing sequence number allocation until final issuance fully satisfy Rule 46 of the CGST Rules 2017 while eliminating sequence gaps from abandoned pro-forma drafts?
2. **Post-Issuance Immutability & Credit Notes (TAX-03):**
   - *Technical Position:* ATLAS OS permanently blocks `UPDATE` or `DELETE` on issued invoices. If an item was billed incorrectly, the user must issue a GST Credit Note.
   - *Question for CA:* Is there any legal provision in GST law allowing an invoice to be "cancelled" without a Credit Note if it has not yet been uploaded to the E-Invoicing / E-Way Bill portal?
3. **Odd-Paisa GST Tax Rounding (TAX-04):**
   - *Technical Position:* Line items round CGST and SGST to the nearest integer paisa using half-up rounding. Invoice total summary tax equals the sum of line taxes.
   - *Question for CA:* Does this mathematical balancing schema conform to the JSON validation requirements of the GST E-Invoicing System (IRN portal) and GSTR-1 tables?

---

### 3.2 Brief for Qualified Legal Counsel (LEG-01 Through LEG-03)
1. **DPDP Act 2023 Compliance for Sole-Owner KYC (LEG-01):**
   - *Technical Position:* ATLAS OS accepts identity verification results from accredited KYC providers (e.g., DigiLocker, Setu) and stores verification tokens rather than persisting raw Aadhaar/Passport copies. Fallback document uploads are encrypted and deleted within 30 days.
   - *Question for Counsel:* Does this architecture comply with the data minimization, notice, and purpose limitation requirements under Sections 4, 5, and 6 of the DPDP Act 2023?
2. **Co-Owner Liability Under Indian Partnership Act 1932 (LEG-02):**
   - *Technical Position:* The platform uses the term "Co-Owner" for elevated administrative RBAC roles that participate in recovery quorums.
   - *Question for Counsel:* Does ATLAS OS Terms of Service require specific disclaimer language to ensure that appointing an employee as an in-app "Co-Owner" does not inadvertently create legal partnership liability or tax nexus under Indian commercial law?

---

## 4. Formal Sign-Off Blocks

```
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CHARTERED ACCOUNTANT / TAX COUNSEL SIGN-OFF:
  Statutory Items TAX-01 through TAX-06:      [ PENDING FORMAL REVIEW ]
  Practicing CA Name:                         ___________________________
  ICAI Membership Number:                     ___________________________
  Firm Name & FRN:                            ___________________________
  Date of Professional Attestation:           ___________________________

QUALIFIED LEGAL COUNSEL SIGN-OFF:
  Statutory Items LEG-01 through LEG-03:      [ PENDING FORMAL REVIEW ]
  Advocate / Legal Counsel Name:              ___________________________
  Bar Council Enrollment Number:              ___________________________
  Date of Professional Attestation:           ___________________________
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```
