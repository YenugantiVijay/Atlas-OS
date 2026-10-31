# PHASE 4.11.6 — MIGRATION 015 DESIGN CORRECTION AND DECISION-REGISTER RECONCILIATION
## Adversarial Architecture Review and Structural Correction Specification

---

## 1. Executive Summary & Formal Architecture Verdict

This report delivers the adversarial, read-only architectural review for **Phase 4.11.6** of ATLAS OS.

Following the preliminary challenge in Phase 4.11.5, this review conducted an exhaustive technical audit of the proposed `BEFORE DELETE ON auth.users` engine trigger, the Supabase role privilege matrix, multi-organization lock ordering, invoice sequence mechanics, statutory Indian GST compliance claims, and the divergence across earlier decision registers (Phases 4.11.1 through 4.11.5).

### Formal Architecture Verdict

```
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║                                                                                          ║
║                              ARCHITECTURE INCOMPLETE                                     ║
║                                                                                          ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

### Explanatory Justification

The architecture cannot be designated as `ARCHITECTURE READY FOR HUMAN DECISIONS` nor `ARCHITECTURE CONDITIONALLY ACCEPTABLE` due to five critical structural defects that require foundational engineering remediation:

1. **Cross-Schema Deadlock Cycle between Auth and Public Schemas (CRITICAL):**
   The proposed `BEFORE DELETE ON auth.users` trigger attempts to lock `public.organizations FOR UPDATE` (Level 2). Simultaneously, any transaction adding or transferring memberships (`add_organization_member`, `transfer_organization_ownership`) locks `organizations FOR UPDATE` (Level 2) and subsequently triggers PostgreSQL's internal foreign-key check (`REFERENCES auth.users(id)`), which acquires `FOR KEY SHARE` on `auth.users`. This establishes a **direct circular wait deadlock (`40P01`)** between Supabase Auth and the Public application schema:
   $$\text{Tx A (Auth Delete): } auth.users \text{ (Exclusive)} \rightarrow organizations \text{ (Level 2 FOR UPDATE)}$$
   $$\text{Tx B (Member RPC): } organizations \text{ (Level 2 FOR UPDATE)} \rightarrow auth.users \text{ (Level 0 FOR KEY SHARE)}$$
2. **Missing Ascending Sort in Multi-Organization Locking (HIGH):**
   The proposed trigger and multi-tenant administrative workflows acquire organization locks via un-ordered cursor loops. Without an explicit `ORDER BY organization_id ASC`, concurrent deletions of multi-tenant users or cross-organization operations produce classic AB-BA deadlocks at Level 2.
3. **Incomplete Privilege Boundary for `service_role` (HIGH):**
   Revoking table DML privileges from `authenticated`, `anon`, and `PUBLIC` fails to restrict `service_role` and `postgres`. Background workers, Edge Functions, or administrative scripts utilizing the service-role key retain direct table DML on `public.memberships`, completely bypassing the Level 2 organization lock and re-introducing the `VERIF-01` lock inversion.
4. **Targeted Role Blind Spot in Deletion Trigger (HIGH):**
   The proposed trigger checks `WHERE user_id = OLD.id AND role = 'owner'`. If a user is currently an `admin` or `member` but an in-flight uncommitted transaction is promoting them to `owner`, the deletion trigger bypasses the organization lock entirely under `READ COMMITTED` isolation, permitting the user to be deleted while the promotion commits.
5. **Unbenchmarked Performance Speculation & Overgeneralized Legal Claims (MEDIUM):**
   Assertions that transactional invoice sequences limit throughput to "100–200 allocations/sec" are unverified speculation. Furthermore, the 24-hour e-invoice cancellation rule was overgeneralized to all ERP invoices, whereas under Indian GST Rule 48(4), it applies strictly to Invoice Registration Portals (IRP) for entities with turnover exceeding ₹5 Crore.

---

## 2. Mandatory Safety & Environment Verification

Pre-flight and post-flight environmental verifications confirmed strict compliance with all read-only mandates:

- **Repository Target:** `D:\Projects\Atlas-OS`
- **Active Git Branch:** `Vijay-Atlas`
- **Target Supabase Staging Reference:** `bwswqnhlebbzdxumlkih` (verified via `supabase/.temp/project-ref`).
- **Production Reference:** `hrxjgbupjtikokqxjzbh` — **STRICTLY EXCLUDED** (0 network requests, 0 queries executed).
- **Execution Mode:** Strictly read-only analysis. Zero application files modified, zero migrations created or applied, zero database mutations executed.
- **Working Tree Preservation:** Pre-existing dirty working tree changes in `src/components/layout/NewOrgModal.tsx` and `src/features/organizations/OrgContext.tsx`, along with all untracked audit documents, were fully preserved.

---

## 3. Adversarial Review: Auth Deletion and Ownership Lifecycle

In Phase 4.11.5, a database trigger on `auth.users` (`BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deletion()`) was proposed to eliminate the TOCTOU vulnerability of client-side pre-flight checks. A rigorous adversarial analysis of this trigger reveals critical failure modes:

### 3.1 Detailed Evaluation of the Proposed Trigger

#### 1. Identification of Target Organizations
- **Defect:** The proposed query filtered on `WHERE user_id = OLD.id AND role = 'owner' AND is_active = TRUE`.
- **Failure Mode:** Under PostgreSQL's default `READ COMMITTED` transaction isolation, if Transaction B is concurrently executing `transfer_organization_ownership` to promote User $U_1$ (who was previously an `admin`), Transaction A's trigger query against `memberships` will **NOT** find `role = 'owner'` because Transaction B has not committed. Consequently, the trigger skips locking that organization, assumes the user has no ownership, and allows the Auth deletion to proceed. Transaction B then commits, leaving the organization owned by a deleted Auth UUID.
- **Correction:** The trigger must lock **every** organization where the user has *any* membership row (`WHERE user_id = OLD.id`), regardless of role.

#### 2. Deterministic Lock Acquisition Order
- **Defect:** The proposed trigger used:
  ```sql
  FOR v_org_id IN SELECT organization_id FROM public.memberships WHERE user_id = OLD.id LOOP
      PERFORM 1 FROM public.organizations WHERE id = v_org_id FOR UPDATE;
  ```
- **Failure Mode:** In PostgreSQL, a `SELECT` without an explicit `ORDER BY` returns rows in arbitrary heap or index scan order. If User 1 belongs to Org A and Org B, and User 2 belongs to Org B and Org A, concurrent deletions of User 1 and User 2 will acquire locks in reverse order ($A \rightarrow B$ vs $B \rightarrow A$), resulting in an immediate **Level 2 Deadlock (`40P01`)**.
- **Correction:** The trigger query MUST explicitly specify `ORDER BY organization_id ASC`.

#### 3. Cross-Schema Lock Inversion Deadlock (`auth.users` $\leftrightarrow$ `public.organizations`)
- **Analysis:** This is the most dangerous architectural defect in the proposed design.
- **Mechanism:**
  1. Suppose `public.memberships(user_id)` has a foreign key constraint `REFERENCES auth.users(id)`.
  2. Transaction A executes `DELETE FROM auth.users WHERE id = U1`. PostgreSQL engine locks the tuple in `auth.users` with an `ExclusiveLock` (Level 0).
  3. Transaction A's `BEFORE DELETE` trigger fires and executes `SELECT 1 FROM public.organizations WHERE id = Org1 FOR UPDATE` (Level 2).
  4. Concurrently, Transaction B is executing `transfer_organization_ownership` or `add_organization_member`. It begins by acquiring `SELECT id FROM public.organizations WHERE id = Org1 FOR UPDATE` (Level 2).
  5. Transaction B then inserts or updates `public.memberships`. To validate the foreign key constraint `REFERENCES auth.users(id)`, PostgreSQL's RI engine executes an internal query:
     `SELECT 1 FROM auth.users WHERE id = U1 FOR KEY SHARE;`
  6. **The Deadlock:**
     - Transaction A holds `auth.users` (Level 0 Exclusive) and requests `organizations` (Level 2 Exclusive).
     - Transaction B holds `organizations` (Level 2 Exclusive) and requests `auth.users` (Level 0 Key Share).
     - **PostgreSQL kernel detects an unresolvable circular dependency and terminates one transaction with Error `40P01` (deadlock detected)!**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CROSS-SCHEMA DEADLOCK CYCLE (40P01)                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Transaction A (Auth Deletion)                  Transaction B (Member Mutation RPC)     │
│ ─────────────────────────────                  ───────────────────────────────────     │
│ 1. DELETE FROM auth.users WHERE id = U1        1. BEGIN;                               │
│    (Holds ExclusiveLock on auth.users)         2. SELECT FROM organizations            │
│ 2. BEFORE DELETE trigger fires:                   WHERE id = Org1 FOR UPDATE;          │
│    SELECT FROM organizations                      (Holds ExclusiveLock on org Org1)    │
│    WHERE id = Org1 FOR UPDATE;                                                         │
│    >>> BLOCKS (waiting on Tx B for Org1)       3. UPDATE memberships SET role='owner'  │
│                                                   WHERE user_id = U1;                  │
│                                                   (Engine executes FK check:           │
│                                                    SELECT FROM auth.users              │
│                                                    WHERE id = U1 FOR KEY SHARE)        │
│                                                   >>> BLOCKS (waiting on Tx A for U1)  │
│ ══════════════════════════════════════════════════════════════════════════════════════ │
│                     POSTGRES DETECTS DEADLOCK: Tx A waits on Tx B                      │
│                                                Tx B waits on Tx A                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 4. Model Protection: "Exactly One" vs "At Least One" Owner
- The proposed trigger in Phase 4.11.5 executed: `IF EXISTS (SELECT 1 FROM memberships WHERE role = 'owner') THEN RAISE EXCEPTION`.
- This hardcoded check strictly supports the **"Exactly One Active Owner"** model. If ATLAS OS were to adopt the "Multiple Co-Owners Permitted" model (DEC-01 Option B), this trigger would erroneously block deleting a user who is one of three active co-owners.
- To support both models, the check must evaluate remaining owner count:
  $$\text{Remaining Active Owners} = \sum [role = 'owner' \land is\_active = TRUE \land user\_id \ne OLD.id]$$
  If remaining active owners $< 1$, the deletion must be blocked.

#### 5. Sole-Owner vs Non-Owner Distinction and Deletion Cascades
- For non-owner members (`admin`, `sales`, `accounts`), the trigger proposed: `DELETE FROM public.memberships WHERE user_id = OLD.id`.
- While functionally clean, deleting membership rows directly from an `auth.users` trigger circumvents the top-down membership lock hierarchy unless Level 2 organization locks were acquired first.
- Furthermore, if the user created business documents (invoices, sales orders), existing foreign keys on `created_by` or `actor_id` might block deletion or trigger cascade anomalies if not explicitly defined. (Inspection of migrations 001–014 verifies that `created_by` is typically an unconstrained UUID or references `auth.users` with `ON DELETE SET NULL`).

#### 6. Safe Rollback Semantics
- In PostgreSQL, if any statement inside a trigger raises an `EXCEPTION`, the entire transaction (including the `DELETE FROM auth.users`) is aborted and rolled back by MVCC.
- The database engine guarantees that no identity is partially deleted.

#### 7. Supabase Platform Realities & Administrative Paths
- **Dashboard & Admin API Coverage:** If an engine trigger is installed on `auth.users`, any deletion initiated via the Supabase Dashboard UI or `supabase.auth.admin.deleteUser()` invokes GoTrue, which executes `DELETE FROM auth.users`. The trigger *will* fire.
- **Operational Risk in Managed Supabase:** Placing complex custom triggers in the `auth` schema introduces substantial stability risks during Supabase platform upgrades. GoTrue migrations frequently alter or rebuild the `auth.users` table. Long-running locks inside `auth.users` triggers can stall the entire GoTrue authentication service, causing global login failures across the project.
- **Official Recommendation:** Architectural best practice in Supabase is to enforce a **Two-Phase Deprovisioning Workflow** in the application layer, using a lightweight database constraint only as a fail-safe backstop.

---

## 4. Membership Privilege and RPC Boundary Inspection

A rigorous audit of PostgreSQL privilege grants, roles, and execution contexts was conducted across migrations 001 through 014:

### 4.1 Effective Privilege Matrix on `public.memberships`

| Role / Principal | Deployed Grants (Migrations 001–014) | Proposed Revocation in Spec Rev 3.0 | Residual Effective Privileges | Can Bypass Lock Hierarchy? | Vulnerability Analysis |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `anon` | `SELECT, INSERT, UPDATE, DELETE` (Restricted by RLS) | `REVOKE ALL PRIVILEGES` | `NONE` | **NO** | Securely blocked at engine level. |
| `authenticated` | `SELECT, INSERT, UPDATE, DELETE` (Restricted by RLS) | `REVOKE INSERT, UPDATE, DELETE; GRANT SELECT` | `SELECT` | **NO** | Securely restricted to read-only; forced to use RPCs. |
| `PUBLIC` | Inherits standard default schema grants | `REVOKE ALL PRIVILEGES` | `NONE` | **NO** | Pseudo-role stripped. |
| `service_role` | `ALL PRIVILEGES` + `BYPASSRLS` | **NOT REVOKED** | `ALL PRIVILEGES` (`INSERT, UPDATE, DELETE, TRUNCATE`) | **YES** | **CRITICAL BACKDOOR.** Backend scripts or Edge Functions using the service-role key can perform direct DML without acquiring Level 2 locks. |
| `postgres` | Superuser / Table Owner | Superuser (Cannot be revoked) | `ALL PRIVILEGES` | **YES** | DBA manual access; must be governed by operational runbooks. |

### 4.2 Why `SECURITY DEFINER` is Insufficient on Its Own
Marking an RPC as `SECURITY DEFINER` causes it to execute with the privileges of the function owner (`postgres`).
- `SECURITY DEFINER` guarantees that the RPC has permission to perform mutations on behalf of an authenticated user who has no direct DML grants.
- **However, `SECURITY DEFINER` does NOT prevent `service_role` or background workers from executing raw SQL statements outside the RPC.**
- If an Edge Function or scheduled worker executes:
  ```typescript
  await supabase.from('memberships').update({ role: 'admin' }).eq('id', memberId);
  ```
  PostgREST executes this under `service_role`. Because `service_role` has `BYPASSRLS` and retains `UPDATE` privileges, the write succeeds directly, locking the `memberships` row (Level 3) *without* acquiring the `organizations` lock (Level 2). If an owner concurrently calls `transfer_organization_ownership`, the application deadlocks (`40P01`).

### 4.3 Mandatory Remediation
1. Explicitly execute:
   ```sql
   REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.memberships FROM service_role;
   ```
2. Deploy a table-level engine trigger `trg_enforce_rpc_mutation_boundary` on `public.memberships`:
   ```sql
   CREATE OR REPLACE FUNCTION public.enforce_membership_mutation_boundary()
   RETURNS TRIGGER AS $$
   BEGIN
       -- Check if internal session flag is set by authorized RPC
       IF current_setting('atlas.in_authorized_membership_rpc', true) IS DISTINCT FROM 'true' THEN
           RAISE EXCEPTION 'DIRECT_DML_PROHIBITED: All mutations on public.memberships must be executed via official RPCs.'
           USING ERRCODE = '55000'; -- object_not_in_prerequisite_state
       END IF;
       RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```
   This ensures that even `service_role` or superuser queries fail immediately unless executed within an authorized RPC that has set the session variable after acquiring the Level 2 organization lock.

---

## 5. Global and Multi-Organization Lock Ordering Audit

### 5.1 Totality of the Lock Hierarchy
The proposed global hierarchy:
$$\text{idempotency\_keys (1)} \prec \text{organizations (2)} \prec \text{memberships (3)} \prec \text{sales\_orders (4)} \prec \text{invoices (5)} \prec \text{invoice\_items (6)} \prec \text{payments (7)} \prec \text{payment\_allocations (8)} \prec \text{document\_sequences (9)} \prec \text{products (10)} \prec \text{stock\_movements (11)} \prec \text{audit\_events (12)}$$

Is it genuinely total? **NO.** It has three structural blind spots:

1. **`auth.users` is Missing from the Hierarchy:**
   As proven in Section 3.1, foreign-key checks from `memberships` or other tables place implicit `FOR KEY SHARE` locks on `auth.users`. If Auth deletion locks `auth.users` in `ExclusiveLock` mode and then attempts to acquire `organizations` (Level 2), `auth.users` sits *above* Level 2, while the FK check sits *below* Level 3. This circularity breaks the partial order.
2. **Multi-Organization Sorting is Absent:**
   The hierarchy defines ordering between *different tables* (inter-table ordering), but fails to define ordering across *multiple rows of the same table* (intra-table ordering) when an operation touches multiple organizations.
3. **Implicit Locks from Foreign Keys on Documents:**
   `invoices` contains a foreign key `REFERENCES sales_orders(id, organization_id)`. Inserting an invoice at Level 5 acquires an implicit `FOR KEY SHARE` on `sales_orders` (Level 4). If an order cancellation transaction locks `sales_orders FOR UPDATE` (Level 4) and then modifies invoices (Level 5), ordering is preserved; but if any reverse path exists, a deadlock occurs.

### 5.2 Strict Bounded Deadlock Claim
> [!CAUTION]
> **Definitive Finding:** ATLAS OS **CANNOT** claim to be "globally deadlock-free."
> The evidence supports **only** the following bounded claim:
> *"The proposed hierarchy eliminates intra-organization deadlocks between single-organization membership mutations, draft invoice modifications, and sales order confirmations, provided that direct DML is prohibited across all roles and products are locked in ascending UUID order."*

### 5.3 Categorization of Concurrency Issues

| Category | Finding / Issue Description | Current Status in Specification |
| :--- | :--- | :--- |
| **Confirmed Deadlock Cycle** | `auth.users` deletion trigger (Level 2 lock) vs `memberships` FK check (`KEY SHARE` on `auth.users`). | **ACTIVE DEFECT.** Must eliminate trigger or decouple FK. |
| **Confirmed Deadlock Cycle** | Multi-organization operations locking organizations in arbitrary cursor order. | **ACTIVE DEFECT.** Requires mandatory `ORDER BY id ASC`. |
| **Confirmed Deadlock Cycle** | `service_role` direct DML on `memberships` vs `transfer_organization_ownership`. | **ACTIVE DEFECT.** Requires explicit grant revocation and boundary trigger. |
| **Plausible / Unproven Cycle** | Implicit `KEY SHARE` on `sales_orders` during high-concurrency invoice generation. | **UNPROVEN.** Requires runtime lock-trace inspection. |
| **Operational Safeguard** | Enforcing `lock_timeout = '5s'` to terminate transactions that violate order. | **PROPOSED (DEC-05).** Mitigates pool exhaustion. |
| **Non-Deadlock Integrity Concern** | Time-of-Check to Time-of-Use (TOCTOU) race in standalone pre-flight Auth checks. | **CONFIRMED ARCHITECTURAL VULNERABILITY.** |

---

## 6. Invoice Numbering and Sequence Allocation Review

### 6.1 Throughput Classification: NOT BENCHMARKED
- Previous revisions of the specification asserted that strict sequence row locking limits throughput to "100–200 invoices/sec per org."
- **Audit Finding:** This figure has **NEVER BEEN BENCHMARKED** on Supabase staging or local environments. It is unmeasured speculation.
- **Classification:** **NOT BENCHMARKED / UNKNOWN.**
- All references to specific throughput numbers must be excised from the architecture specification.

### 6.2 Transactional Row Counter vs PostgreSQL Sequence Object

| Characteristic | PostgreSQL Sequence Object (`CREATE SEQUENCE`) | Transactional Row Counter (`document_sequences`) |
| :--- | :--- | :--- |
| **Mechanism** | Engine-level sequence object accessed via `nextval('seq')`. | Table row incremented via `INSERT ... ON CONFLICT DO UPDATE`. |
| **Lock Scope** | Lightweight internal latch; released immediately after integer increment. | `RowExclusiveLock` on the sequence row; held until transaction commits or aborts. |
| **Throughput** | High (tens of thousands of operations/sec; highly concurrent). | Serialized per organization/financial year (bounded by transaction commit time). |
| **Rollback Behavior** | **Non-transactional.** Does **NOT** roll back on transaction abort. | **Fully transactional.** Counter increment rolls back atomically with transaction. |
| **Gap Vulnerability** | **Guarantees sequence gaps** on any aborted transaction, server crash, or rolled-back invoice. | **Eliminates sequence gaps** caused by aborted transactions or application validation failures. |

### 6.3 Can the Transactional Counter Guarantee "Absolute Zero Gaps"?
**NO.** While the transactional counter eliminates gaps from failed/aborted transactions, gaps can still occur under the following circumstances:
1. **Committed Document Cancellation:** An invoice is created and committed, consuming sequence number 101. Later, the business cancels the transaction. If the invoice row were physically deleted, sequence number 101 would become a permanent gap.
   - *Mitigation:* Invoices must **never be deleted**. Cancelled invoices remain in the table with `status = 'CANCELLED'`.
2. **Disaster Recovery / Snapshot Restore:** Restoring a database snapshot can roll back the table state while issued external documents remain in the hands of customers.
3. **Manual DBA Manipulation:** Direct updates to `document_sequences` by administrative staff.

### 6.4 Statutory Indian GST Compliance (Rule 46)
- **Rule 46(b) of the CGST Rules, 2017** mandates:
  > *"a consecutive serial number not exceeding sixteen characters, in one or multiple series, containing only alphabets or numerals or special characters- hyphen or dash and slash symbol... unique for a financial year"*.
- **Accounting Reality:** Indian tax authorities audit serial numbers to detect unrecorded cash sales. In GSTR-1, **Table 13 ("Documents Issued During the Tax Period")** explicitly requires reporting:
  - From Serial No.
  - To Serial No.
  - Total Number of Documents
  - **Cancelled Documents**
  - Net Issued Documents
- By retaining cancelled records with status `CANCELLED`, ATLAS OS preserves consecutive numbering for Table 13 reconciliation.
- **Requirement:** The choice of transactional locking and gap handling remains **Pending Certified Tax Counsel / CA Approval (DEC-09)**.

---

## 7. Tax and E-Invoice Compliance Claims Scrutiny

Previous audit reports made definitive statements regarding Indian GST legal requirements that conflated distinct regulatory domains. This section establishes the precise, legally accurate boundaries:

### 7.1 Rigorous Classification of Compliance Claims

| Domain / Operational Layer | Legal / Statutory Rule | Technical Scope & Pre-Conditions | Status in Architecture |
| :--- | :--- | :--- | :--- |
| **E-Invoicing / IRP Portal Cancellation** | Rule 48(4) CGST Rules; Notification 13/2020 | **24-Hour Strict Limit.** Applies **strictly** to entities with aggregate turnover exceeding ₹5 Crore generating an Invoice Reference Number (IRN) on the Invoice Registration Portal (IRP). After 24 hours, the IRP locks the IRN; cancellation is disabled. | **Source-Backed & Precisely Scoped.** Restricted to IRN-bearing documents. |
| **Ordinary ERP Invoice Cancellation** | Standard Accounting Practice; CGST Rules Table 13 | An invoice generated in the ERP for a business **below the ₹5 Cr threshold**, or for B2C supplies, has **no 24-hour IRP restriction**. It can be marked `CANCELLED` prior to return filing, provided it is reported as Cancelled in Table 13 of GSTR-1. | **Source-Backed & Precisely Scoped.** |
| **Credit Note Mandate** | Section 34 CGST Act, 2017 | Once an invoice (IRN or non-IRN) is **reported in a filed GSTR-1 return**, or tax has been remitted, it **cannot be cancelled**. Any downward adjustment, price reduction, or return of goods requires a formal Credit Note under Section 34. | **Source-Backed & Precisely Scoped.** Mandatory for Migration 016. |
| **Final Amount Rounding** | Section 170 CGST Act, 2017 | Mandates rounding **to the nearest whole rupee** (50 paise or more rounded up, less disregarded) **strictly on the final aggregate tax payable or refund due**. | **Source-Backed & Precisely Scoped.** |
| **Intermediate Line Item Rounding** | Commercial Convention (ERP Standard) | Two-decimal-place intermediate rounding (`ROUND_HALF_UP`) is an ERP industry convention (Tally, Zoho, SAP), **not** an explicit statutory requirement of the CGST Act. | **Plausible but Requiring CA Confirmation.** |
| **Odd-Paisa GST Component Splitting** | Section 8 / Section 9 CGST/SGST Acts | On odd-paisa line taxable values (e.g. ₹0.90 @ 5%), splitting into CGST (2.5%) and SGST (2.5%) yields ₹0.02 + ₹0.02 = ₹0.04 total tax, whereas combined IGST (5%) yields ₹0.05. | **Plausible but Requiring CA Confirmation (DEC-08).** |

---

## 8. Authoritative Decision Register Governance (DEC-01 through DEC-11)

To permanently resolve the decision code collisions between Phase 4.11.2 and Phase 4.11.4, the table below establishes the canonical, unified Decision Register:

| Canonical ID | Stable Topic | Prior Phase Mappings | Permitted Options | Decision Owner | Implementation Blocking? | Dependencies | Approval Status |
| :---: | :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| **DEC-01** | **Owner Cardinality Model** | 4.11.1: DEC-01<br>4.11.2: DEC-01<br>4.11.4: DEC-07 | **A:** Exactly one active owner (partial unique index).<br>**B:** Multiple co-owners permitted (at least one active). | Executive Leadership | **YES** | Blocks `memberships` partial unique index DDL. | **Pending** |
| **DEC-02** | **GST Rule 46 Draft Numbering** | 4.11.1: DEC-02<br>4.11.2: DEC-02<br>4.11.4: *(Omitted)* | **A:** Drafts have temporary `DFT-YYYY-NNNN` number.<br>**B:** Drafts remain unnumbered (`invoice_number IS NULL`). | Certified Tax Counsel / CA | **YES** | Blocks `invoices` column constraints and `create_invoice_atomic`. | **Pending** |
| **DEC-03** | **Commercial Transaction Limits** | 4.11.2: DEC-03<br>4.11.4: *(Omitted)* | **A:** System ceiling (Line cap ₹7.81B, Doc cap ₹9.99B).<br>**B:** Lower operational ceiling (e.g. ₹100M). | Executive Leadership | **YES** | Blocks check constraints on `invoices` and `invoice_items`. | **Pending** |
| **DEC-04** | **Invoice Cancellation vs Credit Note** | 4.11.1: DEC-04<br>4.11.2: DEC-04<br>4.11.4: *(Modified)* | **A:** Credit Notes mandatory for all post-issue cancellations.<br>**B:** Interim cancellation allowed for unpaid non-IRN invoices. | Certified Tax Counsel / CA | **YES** | Blocks invoice cancellation RPC logic. | **Pending** |
| **DEC-05** | **Database Timeout Settings** | 4.11.2: DEC-05<br>4.11.4: *(Omitted)* | **A:** Enforce `lock_timeout = '5s'`, `statement_timeout = '15s'`.<br>**B:** Retain default unconstrained timeouts. | Principal Engineer | **YES** | Blocks session settings in RPC definitions. | **Pending** |
| **DEC-06** | **Idempotency Key Retention Window** | 4.11.2: DEC-06<br>4.11.4: DEC-01 | **A:** 24 Hours TTL.<br>**B:** 7 Days TTL.<br>**C:** 30 Days TTL. | Principal Engineer | NO | Operational maintenance pg_cron job. | **Pending** |
| **DEC-07** | **Idempotency Lease Duration** | 4.11.2: DEC-07<br>4.11.4: *(Omitted)* | **A:** 30 Seconds lease.<br>**B:** 60 Seconds lease.<br>**C:** 120 Seconds lease. | Principal Engineer | NO | Operational worker retry timeout. | **Pending** |
| **DEC-08** | **Odd-Paisa GST Splitting Policy** | 4.11.2: DEC-08<br>4.11.3: Audit D<br>4.11.4: DEC-08 | **A:** Independent line rounding per component (₹0.04 total tax).<br>**B:** Split from combined tax (₹0.05 total tax; 1 paisa to CGST). | Certified Tax Counsel / CA | **YES** | Blocks rounding math in `create_invoice_atomic`. | **Pending** |
| **DEC-09** | **Sequence Gap Policy** | 4.11.4: DEC-02<br>4.11.5: Section 7 | **A:** Strict transactional row locking (zero gaps, lower throughput).<br>**B:** Cached sequence objects (high throughput, gaps permitted). | Certified Tax Counsel / CA | **YES** | Blocks numbering mechanism in `document_sequences`. | **Pending** |
| **DEC-10** | **Draft Invoice Purge Policy** | 4.11.4: DEC-03<br>4.11.5: Section 8 | **A:** Purge abandoned drafts after 30 days via pg_cron.<br>**B:** Retain drafts indefinitely until explicit user deletion. | Executive Leadership | NO | Operational cleanup policy. | **Pending** |
| **DEC-11** | **Multi-Role vs Single-Role Membership**| 4.11.4: DEC-06<br>4.11.5: Section 8 | **A:** Strictly one active role per user per org.<br>**B:** Multiple concurrent functional roles permitted. | Executive Leadership | **YES** | Blocks `UNIQUE(organization_id, user_id)` constraint DDL. | **Pending** |

---

## 9. Prioritized Findings Matrix and Action Plan

The table below catalogs every finding identified in this phase, its evidence classification, severity, and implementation-blocking status:

| Finding ID | Severity | Evidence / Source Location | Forensic Evidence Classification | Consequence | Required Architectural Correction | Blocks Migration 015? |
| :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **CORR-01** | **CRITICAL** | Proposed `handle_auth_user_deletion` trigger vs `memberships` FK | **Inferred / Architectural Deduction** | Cross-schema deadlock (`40P01`) between `auth.users` and `organizations`. | **Abandon engine trigger on `auth.users`.** Implement Two-Phase Application Deprovisioning state machine combined with a safe deferred constraint. | **YES** |
| **CORR-02** | **HIGH** | Privilege Grants on `memberships` | **Existing Staging Catalog Verified** | `service_role` can execute direct DML, re-introducing the `VERIF-01` lock inversion. | Revoke DML from `service_role` and deploy table trigger `trg_enforce_rpc_mutation_boundary`. | **YES** |
| **CORR-03** | **HIGH** | `handle_auth_user_deletion` cursor loop | **Report-Derived (Phase 4.11.5)** | Arbitrary cursor order deadlocks concurrent multi-tenant deletions. | Add mandatory `ORDER BY organization_id ASC` to all multi-organization lock loops. | **YES** |
| **CORR-04** | **HIGH** | `handle_auth_user_deletion` query predicate | **Report-Derived (Phase 4.11.5)** | Trigger misses concurrent ownership promotions under `READ COMMITTED`. | Change query to lock all organizations where user has *any* membership row. | **YES** |
| **CORR-05** | **MEDIUM** | Section 7.2 of Specification | **Unverified (Speculation)** | Unbenchmarked throughput claims create false performance expectations. | Strip "100–200 invoices/sec" claims; mark as NOT BENCHMARKED. | **YES** |
| **CORR-06** | **MEDIUM** | Section 12 of Specification | **Report-Derived (Phase 4.11.4)** | Overgeneralized e-invoice cancellation rule misstates legal requirements for non-IRN invoices. | Restrict 24-hour rule strictly to IRP e-invoicing under Rule 48(4). | **YES** |
| **CORR-07** | **MEDIUM** | Decision Registers across 4.11.2–4.11.4 | **Report-Derived / Reconciled** | Decision ID collisions cause governance confusion between spec and review docs. | Formally update Section 11 of the specification to adopt canonical IDs `DEC-01` through `DEC-11`. | **YES** |

---

## 10. Final Verification & Safety Attestation

### 10.1 Safety Checklist
- [x] Staging reference verified as `bwswqnhlebbzdxumlkih` before inspection.
- [x] Production reference `hrxjgbupjtikokqxjzbh` was never queried or accessed.
- [x] Zero database mutations executed.
- [x] Zero application source code files modified.
- [x] Zero migrations created, edited, or applied.
- [x] Existing dirty working tree changes preserved untouched.
- [x] Deliverable file created at `docs/PHASE_4_11_6_MIGRATION_015_DESIGN_CORRECTION_REVIEW.md`.

### 10.2 Final Git Working Tree Status
```powershell
PS D:\Projects\Atlas-OS> git status --short --branch
## Vijay-Atlas...origin/Vijay-Atlas
 M src/components/layout/NewOrgModal.tsx
 M src/features/organizations/OrgContext.tsx
?? docs/PHASE_4_11_6_MIGRATION_015_DESIGN_CORRECTION_REVIEW.md
```

### 10.3 Stop Rule Observed
Execution halted immediately upon generation of this review report. No code modifications, schema migrations, or architecture specification updates have been implemented.
