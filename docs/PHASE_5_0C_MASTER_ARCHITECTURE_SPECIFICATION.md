# PHASE 5.0C — MASTER ARCHITECTURE SPECIFICATION
## Consolidated Enterprise Architecture Blueprint: Multi-Tenant Security, Ownership Governance, Financial Integrity, and Concurrency Contracts
**ATLAS OS Multi-Tenant Enterprise SaaS ERP Platform**  
**Classification:** Definitive Consolidated Architecture Specification  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Architectural Charter

ATLAS OS is an enterprise-grade multi-tenant Enterprise Resource Planning (ERP) Software-as-a-Service (SaaS) platform tailored for electrical retailers, wholesalers, and hardware distributors in India. 

The system operates across complex commercial retail topologies: from single-proprietor counter billing shops to multi-branch regional distribution networks handling lakhs of stock-keeping units (SKUs), tiered customer pricing, high-volume counter cash transactions, and complex credit ledgers under the **Central Goods and Services Tax (CGST) Act 2017**.

This Master Architecture Specification reconciles and consolidates the entire architectural body of work spanning Phases 5.0A through 5.0B.2.1 into a single authoritative blueprint.

### Architectural Core Tenets:
1. **Zero-Trust Multi-Tenancy:** Absolute tenant boundary enforcement at the database layer via PostgreSQL Row Level Security (RLS) and composite foreign keys.
2. **Fiduciary Ownership Integrity:** Exactly one designated active Primary Owner per active organization with reserved corporate governance powers, separated from operational employee roles.
3. **Financial & Statutory Immutability:** Invoices and financial ledger entries are permanently immutable once issued; post-issuance corrections are strictly handled via official GST Credit Notes under Section 34 of the CGST Act.
4. **Deterministic Concurrency & Lock Discipline:** All transactional operations adhere to a 5-level lock acquisition hierarchy, eliminating circular lock dependencies.
5. **Audited & Resilient Deprovisioning:** Complete separation between authentication identity lifecycle and financial transaction survival, ensuring compliance with statutory retention laws without data loss.

---

## 2. Multi-Tenant Security Architecture (Domain A)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS DATABASE SECURITY & ISOLATION BOUNDARY                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    Client Application (React/Vite Frontend / Mobile POS)
                      │
                      │ HTTPS / Authenticated JWT (Bearer Token)
                      ▼
    ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ PostgREST / GoTrue Auth Gateway (Supabase API Layer)                                           │
    │ • Validates JWT signature, claims (`sub`, `iss`, `exp`)                                        │
    │ • Sets PostgreSQL transaction context: `request.jwt.claim.sub` = user_id                       │
    │ • Sets session role: `authenticated` or `anon`                                                 │
    └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                     │
                                                     ▼
    ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ CLOSED-DOOR DATABASE PRIVILEGE MODEL                                                           │
    │ • Direct `INSERT`, `UPDATE`, `DELETE` REVOKED on all operational tables for `authenticated`    │
    │ • Direct REST mutations blocked; all business writes must invoke `SECURITY DEFINER` RPCs      │
    │ • `service_role` has `DELETE` and `TRUNCATE` revoked on ledger & audit tables                  │
    └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                     │
                                                     ▼
    ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ POSTGRESQL ROW LEVEL SECURITY (RLS) ENGINE                                                     │
    │ • Every operational table enforces RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)           │
    │ • Tenant Isolation Policy: `organization_id IN (SELECT get_user_organizations())`              │
    │ • Helper function `get_user_organizations()` executes with `SET search_path = public, pg_temp` │
    └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                     │
                                                     ▼
    ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
    │ DATA INTEGRITY & IMMUTABILITY LAYER                                                            │
    │ • Composite Foreign Keys `(organization_id, parent_id)` prevent cross-tenant referencing       │
    │ • Immutability triggers raise SQLSTATE `42501` / `55000` on any UPDATE/DELETE of posted ledgers│
    │ • Audit trail trigger `trg_prevent_audit_tampering` prevents mutation of `public.audit_events` │
    └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Closed-Door Privilege & REST Access Boundaries
To protect financial ledgers from direct client tampering via auto-generated PostgREST endpoints:
- **Direct DML Revocation:** Roles `authenticated` and `anon` have direct `INSERT`, `UPDATE`, and `DELETE` revoked across all core operational tables (`invoices`, `invoice_items`, `payments`, `payment_allocations`, `stock_movements`, `document_sequences`, `organizations`, `organization_ownership`, `audit_events`).
- **Read Access:** `SELECT` is granted to `authenticated` subject to RLS tenant filters.
- **Transactional Writes:** All state mutations must occur through authorized PostgreSQL stored procedures (`SECURITY DEFINER` RPCs).
- **Service Role Boundaries:** While Supabase `service_role` bypasses RLS for administrative background routines, explicit table grants revoke `TRUNCATE` and `DELETE` on financial and audit tables, preventing rogue scripts from erasing history.

### 2.2 Composite Foreign Key Architecture
To eliminate cross-tenant data corruption (e.g., an invoice in Org A referencing a customer in Org B):
- All child tables enforce compound primary keys or unique constraints including `organization_id`.
- Foreign keys reference `(organization_id, id)` rather than `id` alone:
  ```sql
  CONSTRAINT fk_invoice_customer 
      FOREIGN KEY (organization_id, customer_id) 
      REFERENCES public.customers(organization_id, id) 
      ON DELETE RESTRICT;
  ```

### 2.3 Search-Path Security
Every `SECURITY DEFINER` function strictly specifies `SET search_path = public, pg_temp` to immunize database routines against search-path injection and Trojan schema attacks.

---

## 3. Ownership Governance Architecture (Domain B)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       OWNERSHIP & MEMBERSHIP DECOUPLED DATA MODEL                                      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    ┌────────────────────────────────┐                 ┌──────────────────────────────────────┐
    │     public.organizations       │                 │          auth.users                  │
    ├────────────────────────────────┤                 ├──────────────────────────────────────┤
    │ id: UUID (PK)                  │                 │ id: UUID (PK)                        │
    │ legal_name: TEXT               │                 │ email: TEXT                          │
    │ status: TEXT                   │                 │ phone: TEXT                          │
    └──────────────┬─────────────────┘                 └──────────────────┬───────────────────┘
                   │                                                      │
                   │ 1                                                    │ 1
                   │                                                      │
                   ├───────────────────────────────┐                      │
                   │ 1..*                          │ 1..*                 │
                   ▼                               ▼                      ▼
    ┌────────────────────────────────┐   Compound  ┌──────────────────────────────────────────┐
    │  public.organization_ownership │◄────────────┤          public.memberships              │
    ├────────────────────────────────┤   FK Link   ├──────────────────────────────────────────┤
    │ id: UUID (PK)                  │             │ id: UUID (PK)                            │
    │ organization_id: UUID (FK)     │             │ organization_id: UUID (FK)               │
    │ user_id: UUID (FK)             │             │ user_id: UUID (FK)                       │
    │ ownership_type: TEXT           │             │ operational_role: TEXT (admin, mgr, etc.)│
    │ is_active: BOOLEAN             │             │ status: TEXT (active, suspended, etc.)   │
    │ assigned_at: TIMESTAMPTZ       │             │ UNIQUE (organization_id, user_id)        │
    └────────────────────────────────┘             └──────────────────────────────────────────┘
```

### 3.1 Ownership and Role Decoupling (DEC-01, DEC-11)
- **Separation of Concerns:** Corporate ownership is fundamentally decoupled from operational day-to-day employee roles.
- **Operational Roles:** Stored in `public.memberships.operational_role` (`admin`, `branch_manager`, `cashier`, `accountant`, `sales_executive`). A user possesses exactly one operational role per organization at any time.
- **Ownership Tier:** Stored in dedicated table `public.organization_ownership`. An organization has:
  - **Exactly one active Primary Owner** (`ownership_type = 'PRIMARY_OWNER'`).
  - **Zero or more active Co-Owners** (`ownership_type = 'CO_OWNER'`).
- **Compound Foreign Key Guard:** `organization_ownership` maintains a compound foreign key referencing `(organization_id, user_id)` in `public.memberships`, ensuring owners are active members of the tenant.

### 3.2 The Exactly-One-Active-Primary-Owner Invariant
A critical mathematical and database principle governs this invariant:
- **Why a Partial Unique Index is Insufficient:**
  A partial unique index:
  ```sql
  CREATE UNIQUE INDEX uq_single_primary_owner 
  ON public.organization_ownership(organization_id) 
  WHERE ownership_type = 'PRIMARY_OWNER' AND is_active = TRUE;
  ```
  strictly guarantees that an organization has **at most one** ($\le 1$) active Primary Owner. It **DOES NOT** guarantee that an organization has **at least one** ($\ge 1$) active Primary Owner. An organization could have 0 Primary Owners if the record is deleted, deactivated, or omitted during tenant provisioning.
- **The Dual-Enforcement Strategy:**
  To guarantee **exactly one** ($= 1$) active Primary Owner for every active organization:
  1. **Upper Bound ($\le 1$):** Enforced continuously by the partial unique index above.
  2. **Lower Bound ($\ge 1$):** Enforced by a **deferred constraint trigger** evaluated at transaction `COMMIT`:
     ```sql
     CREATE CONSTRAINT TRIGGER trg_assert_primary_owner_exists
     AFTER INSERT OR UPDATE OR DELETE ON public.organization_ownership
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW
     EXECUTE FUNCTION public.fn_assert_exactly_one_primary_owner();
     ```
  3. **Deactivation & Severance Block:** A database trigger on `public.memberships` blocks changing status to `DEACTIVATED` or deleting a membership row if that user is currently the active Primary Owner.

### 3.3 Two-Phase Primary Owner Transfer Protocol
Primary Ownership carries serious fiduciary and tax liabilities under Indian commercial law. It cannot be dumped unilaterally onto another user:
1. **Phase 1 (Initiation):** Current Primary Owner invokes `initiate_ownership_transfer(nominee_id, reason)`. A record is created in `ownership_transfers` with status `OFFERED` and a 7-day TTL.
2. **Phase 2 (Acceptance):** The nominee must authenticate and explicitly invoke `accept_ownership_transfer(transfer_id)`.
3. **Atomic Handshake:** In a single atomic transaction under Level 1 organization row lock:
   - Current Primary Owner is demoted to `CO_OWNER`.
   - Nominee is promoted to `PRIMARY_OWNER`.
   - Transfer record updates to `COMPLETED`.

### 3.4 Recovery Protocols
- **Co-Owner Quorum Recovery (`PO-04`):** When the Primary Owner is incapacitated, eligible Co-Owners vote. Claimant is strictly excluded from denominator. Quorum requires strictly $> 66\%$ rounded upward: $\text{Req} = \lfloor 0.66 \times N_{\text{eligible}} \rfloor + 1$.
- **Sole-Owner KYC Recovery (`PO-06`):** When zero Co-Owners exist, recovery diverts to manual platform compliance review supported by entity PAN, accredited photo ID, and official business registration documents.
- **Cooling Period (`PO-03`):** 14-day internal product security cooling period with dispute/fraud holds (`is_disputed = TRUE`).

---

## 4. RBAC & Contextual Authorization Architecture (Domain C)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       RBAC & CUSTOM PERMISSION RESOLUTION PIPELINE                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    Client Request Context: (user_id, organization_id, branch_id, action)
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ STEP 1: Primary Owner Bypass Check                                     │
    │ Is user the active PRIMARY_OWNER in `organization_ownership`?          │
    │ ─── YES ───► PERMITTED (Full reserved & operational governance rights) │
    │ ─── NO  ───► Proceed to Step 2                                         │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ STEP 2: Base Role Resolution (`public.memberships.operational_role`)   │
    │ Maps to built-in system permission matrix (admin, cashier, etc.)       │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ STEP 3: Custom Role Aggregation (`public.custom_roles`)                │
    │ Merges permissions granted via assigned custom roles                   │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ STEP 4: Monotonic Delegation Check & Permission Overrides              │
    │ • Checks `membership_permission_overrides` (explicit GRANT or REVOKE)  │
    │ • Monotonic Rule: Custom role creator CANNOT grant permissions beyond  │
    │   their own effective grantable permission boundary!                   │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ STEP 5: Contextual Branch Scoping                                      │
    │ • Checks `user_branch_assignments` (Global vs Assigned Branches)       │
    │ • Restricts action to assigned branch context where applicable         │
    └────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Monotonic Custom Role Delegation Limits (DEC-14)
To prevent privilege escalation attacks where a branch manager creates a custom role granting superuser or owner permissions:
- When a user creates or modifies a custom role in `public.custom_roles`, a database trigger verifies:
  $$\text{PermissionsToGrant} \subseteq \text{GrantablePermissions}(\text{auth.uid}(), \text{organization\_id})$$
- A user can never delegate a permission they do not actively possess.

---

## 5. Branch Governance & Central Customer Architecture (Domain D)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BRANCH GOVERNANCE & CENTRAL CUSTOMER MASTER                                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

                           ┌────────────────────────────────────────┐
                           │      public.organizations (HQ)         │
                           └──────────────────┬─────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │ 1..*                                          │ 1..*
                      ▼                                               ▼
       ┌──────────────────────────────┐                ┌──────────────────────────────┐
       │       public.branches        │                │       public.customers       │
       ├──────────────────────────────┤                ├──────────────────────────────┤
       │ id: UUID (PK)                │                │ id: UUID (PK)                │
       │ organization_id: UUID (FK)   │                │ organization_id: UUID (FK)   │
       │ branch_code: TEXT            │                │ gstin: TEXT                  │
       │ name: TEXT                   │                │ legal_name: TEXT             │
       │ is_active: BOOLEAN           │                │ credit_limit: NUMERIC(12, 2) │
       │ UNIQUE (org_id, branch_code) │                │ UNIQUE (org_id, gstin)       │
       └──────────────┬───────────────┘                └──────────────┬───────────────┘
                      │                                               │
                      │ 1                                             │ 1
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              │
                                              ▼
                               ┌──────────────────────────────┐
                               │       public.invoices        │
                               ├──────────────────────────────┤
                               │ id: UUID (PK)                │
                               │ organization_id: UUID (FK)   │
                               │ branch_id: UUID (FK)         │
                               │ customer_id: UUID (FK)       │
                               │ invoice_number: TEXT         │
                               └──────────────────────────────┘
```

### 5.1 Central Customer Master with Branch Masking (`PO-07`)
- **Central Master:** Customers are owned at the organization level (`public.customers.organization_id`). Duplicate customer entities for the same legal business are prohibited via unique constraint `UNIQUE (organization_id, gstin)`.
- **Branch Transaction Attribution:** When an invoice, quotation, or payment is recorded, it links to `customer_id` and records `branch_id`.
- **Branch Data Masking:** Branch retail sales staff need customer contact details and GSTINs to generate invoices, but must not view sensitive organization-wide credit information:
  - Masked attributes: `credit_limit`, `payment_terms_days`, `current_aging_balance`, `internal_risk_rating`.
  - Implemented via PostgreSQL security-barrier views (`public.branch_accessible_customers`) and column-level privileges.

### 5.2 Sequence Partitioning & PostgreSQL NULL Handling
In retail ERPs, document numbering sequences must support both branch-specific series (e.g., `MUM-INV-0001`) and head-office central sequences (where `branch_id IS NULL`):
- **PostgreSQL Nullable Unique Constraint Bug:**
  In standard SQL and PostgreSQL versions $\le 14$, standard unique constraints treat `NULL` values as distinct:
  `UNIQUE (organization_id, document_type, branch_id)`
  allows **multiple rows** with `(org_1, 'INVOICE', NULL)`, creating catastrophic sequence number collisions!
- **Target Specification:**
  In PostgreSQL 15+, ATLAS OS explicitly specifies:
  ```sql
  CONSTRAINT uq_document_sequences_partition 
      UNIQUE NULLS NOT DISTINCT (organization_id, document_type, branch_id);
  ```
  guaranteeing that exactly one sequence row exists even when `branch_id` is `NULL`.

---

## 6. Approval Workflow Engine Architecture (Domain E)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       4-TIER APPROVAL WORKFLOW DECISION ENGINE                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    Transaction Proposal: (Invoice Draft / Sales Order / Stock Adjustment / Payment / Credit Allocation)
                                 │
                                 ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │ EVALUATE APPROVAL RULES (`public.approval_rules`)                      │
    │ 1. Convert to organization base currency (INR)                         │
    │ 2. Evaluate integer minor units (paise) against configured thresholds: │
    │    • Tier 1: ≤ ₹25,000 (Operational employee auto-issuance)            │
    │    • Tier 2: ₹25,001 to ₹100,000 (Branch / Department Manager)         │
    │    • Tier 3: ₹100,001 to ₹500,000 (Senior Manager / Co-Owner)          │
    │    • Tier 4: > ₹500,000 (Dual Distinct Approvers: Owner + Sr Manager)  │
    │ 3. Check High-Risk Action Overrides (Write-offs, Credit Limit Changes) │
    └────────────────────────────┬───────────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │ Threshold Exceeded?           │
                 ▼                               ▼
               [ NO ]                          [ YES ]
                 │                               │
                 ▼                               ▼
    ┌───────────────────────────┐   ┌────────────────────────────────────────┐
    │ Immediate Direct Execution│   │ Create `public.approval_requests`      │
    │ • Allocated Sequence#     │   │ • Status: `PENDING`                    │
    │ • Ledger posted           │   │ • TTL: 72 Hours (Configurable)         │
    └───────────────────────────┘   │ • Associated document stays DRAFT/SOFT │
                                    └───────────────────┬────────────────────┘
                                                        │
                         ┌──────────────────────────────┼──────────────────────────────┐
                         ▼                              ▼                              ▼
                 [ APPROVER SIGNS ]             [ APPROVER REJECTS ]            [ TTL EXPIRES (72h) ]
                         │                              │                              │
                         ▼                              ▼                              ▼
          ┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
          │ Check Separation of Duties: ││ Set Request -> `REJECTED`   ││ Set Request -> `EXPIRED`    │
          │ Initiator != Approver       ││ Set Document -> `REJECTED`  ││ Document -> `DRAFT_EXPIRED` │
          │ Tier 4: Approver1 != Appr2  ││ Zero ledger mutation        ││ ZERO SILENT APPROVAL        │
          │ Set Request -> `APPROVED`   ││ Re-editable by requester    ││ Alert dispatched to user    │
          │ Execute Document Posting    │└─────────────────────────────┘└─────────────────────────────┘
          └─────────────────────────────┘
```

### 6.1 Discrete State Machine Integrity (`PO-02`)
To guarantee that financial records are never corrupted upon approval expiration or rejection:
- **Draft Invoices:** Held in `DRAFT_PENDING_APPROVAL`. If expired, transitions to `DRAFT_EXPIRED`. Document has **never consumed a sequence number**. May be re-edited or discarded.
- **Issued Invoices:** Official tax invoices are **never generated until approval is complete**. Once issued, database triggers prevent mutation or reversion to draft.
- **Stock Adjustments (Write-offs):** Zero inventory movements are written to `public.stock_movements` while pending. If expired, adjustment is cancelled.
- **Payments / Refunds:** Proposals are held in `PENDING_APPROVAL`. If expired, payment is cancelled with zero balance allocation.

---

## 7. Financial & Inventory Integrity Architecture (Domain F)

### 7.1 Allocation-on-Issuance & Gapless Numbering
Under Rule 46 of the CGST Rules 2017, tax invoices must be consecutive and serialized in one or multiple series.
- Abandoned draft invoices must never leave numbering gaps.
- **Protocol:** Draft invoices store `invoice_number = NULL`. The official consecutive sequence number is allocated from `document_sequences` under row lock (`FOR UPDATE`) **only when the document status transitions to `ISSUED`**.

### 7.2 Post-Issuance Immutability & Section 34 Credit Notes
- Database trigger `trg_prevent_financial_mutation` on `invoices`, `invoice_items`, `payments`, and `payment_allocations`:
  ```sql
  IF OLD.status = 'ISSUED' AND (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') THEN
      RAISE EXCEPTION 'Financial Ledger Immutability Violation: Issued financial documents cannot be mutated or deleted'
          USING ERRCODE = '42501';
  END IF;
  ```
- Any commercial correction (billing error, price negotiation, return of defective switchgear) mandates generating an official **GST Credit Note** under Section 34 of the CGST Act 2017.

### 7.3 Odd-Paisa GST Splitting Reconciliation
For intra-state supplies, GST is split equally between CGST (Central GST) and SGST (State GST). When calculating tax on odd-paisa amounts (e.g., ₹10.01 at 18%):
$$\text{Tax} = ₹1.8018 \implies \text{CGST 9\%} = ₹0.9009, \quad \text{SGST 9\%} = ₹0.9009$$
- **Rule:** Both CGST and SGST line taxes are rounded to 2 decimal places using half-up integer-paisa rounding ($\text{CGST} = ₹0.90, \text{SGST} = ₹0.90$).
- **Residual Balancing:** Invoice summary tax is calculated as the sum of rounded line taxes ($\sum \text{CGST}_{\text{lines}} + \sum \text{SGST}_{\text{lines}}$), ensuring invoice total matches line sums exactly.

### 7.4 Atomic Operations Spanning Multiple Tables
All multi-table commercial operations are consolidated into single atomic `SECURITY DEFINER` stored procedures:
- `create_invoice_with_items`: Inserts invoice header, inserts invoice line items, updates customer balance, deducts inventory stock movements, and generates audit trail within a single database transaction.

---

## 8. Audit, Retention & Deprovisioning Architecture (Domain G)

### 8.1 Append-Only Audit Trail
- Table `public.audit_events` captures: `organization_id`, `actor_id`, `event_type`, `resource_type`, `resource_id`, `payload`, `ip_address`, `created_at`.
- **Tamper Proofing:** Trigger `trg_prevent_audit_tampering` raises SQLSTATE `42501` on any attempt to execute `UPDATE` or `DELETE` on `audit_events`.
- **Actor Attribution:** `actor_id` is strictly assigned from `auth.uid()` server-side; client-supplied actor values are rejected.

### 8.2 Proposed Retention Taxonomy (PO-08)
Data is managed under five proposed categories pending CA/legal confirmation:
1. **RET-01 (Security Audit Events):** 365 days active database queryable; cold archive thereafter `[PENDING CERT-In / LEGAL REVIEW]`.
2. **RET-02 (Financial & Statutory Records):** 72 months from the annual return due date under Section 36 of CGST Act `[PENDING CA SIGN-OFF]`.
3. **RET-03 (Personal Identifiable Information):** Active during membership; sanitized 30 days post-deprovisioning `[PENDING DPDP ACT REVIEW]`.
4. **RET-04 (Operational Deprovisioning Records):** Permanent de-identified governance trail `[PENDING COMPLIANCE REVIEW]`.
5. **RET-05 (Idempotency Keys):** 48-hour hard TTL with automated background purging `[APPROVED BASELINE]`.

### 8.3 Statutory Legal Holds & Dispute Freezes
When an organization, transaction, or user is marked with `legal_hold = TRUE` or `is_disputed = TRUE`:
- Automated partition pruning and archive exports are suspended.
- PII sanitization is blocked.
- Row-level immutability triggers block administrative deletion.

### 8.4 Bare UUID Attribution & Account Deprovisioning
- All operational and financial records (`invoices`, `payments`, `audit_events`) link to users via bare UUIDs (`created_by: UUID`, `actor_id: UUID`) without foreign key cascading deletion (`ON DELETE CASCADE`).
- When a user account is deleted in Supabase Auth (`auth.users`), historical financial ledgers retain full immutable attribution without foreign key breakage.

---

## 9. Deterministic Concurrency & Lock Hierarchy Architecture (Domain H)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ATLAS OS 5-LEVEL LOCK ORDERING HIERARCHY                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

    LEVEL 1: Organization Context Lock
    `SELECT id FROM organizations WHERE id = p_org_id FOR UPDATE;`
    (Serializes org-level structural operations, membership purges, status toggles)
                        │
                        ▼
    LEVEL 2: Master Entity Resource Locks
    `SELECT id FROM products WHERE id = ANY(p_product_ids) ORDER BY id ASC FOR UPDATE;`
    `SELECT id FROM customers WHERE id = p_customer_id FOR UPDATE;`
    (Always acquired in deterministic primary key ascending order!)
                        │
                        ▼
    LEVEL 3.2: Governance & Approval Workflow Locks
    `SELECT id FROM approval_requests WHERE id = p_request_id FOR UPDATE;`
    (Serializes approval decisions, dual-approver quorum signing, expiry checks)
                        │
                        ▼
    LEVEL 3.5: Operational Financial Ledger Locks
    `SELECT id, balance_due FROM invoices WHERE id = p_invoice_id FOR UPDATE;`
    `SELECT id FROM payments WHERE id = p_payment_id FOR UPDATE;`
    (Serializes balance adjustments, allocations, credit note applications)
                        │
                        ▼
    LEVEL 4: Document Sequence Numbering Lock
    `SELECT next_number FROM document_sequences WHERE ... FOR UPDATE;`
    (Guarantees gapless sequential serialization; held for microseconds before COMMIT)
                        │
                        ▼
    LEVEL 5: Audit Event Append-Only Stream
    `INSERT INTO audit_events (...) VALUES (...);`
    (Strictly append-only; zero prior locks held; zero read locks acquired)
```

### 9.1 Multi-Row Lock Ordering Protocol
When locking multiple master records (e.g., deducting stock for 10 line items in a sales invoice), records **MUST ALWAYS BE LOCKED IN DETERMINISTIC ASCENDING ORDER BY PRIMARY KEY**:
```sql
SELECT id FROM public.products 
WHERE id = ANY(v_product_ids) 
ORDER BY id ASC 
FOR UPDATE;
```
Locking items in arbitrary array or cart order is the leading cause of PostgreSQL deadlock exceptions (SQLSTATE `40P01`).

### 9.2 Evidence-Based Concurrency Stance
While static lock hierarchy analysis establishes zero circular dependencies across designed RPCs, **deadlock-free guarantees cannot be proven statically**. Mandatory Tier 2 multi-connection stress tests (20–50 concurrent workers) on remote staging are required prior to production sign-off.
