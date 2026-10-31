# PHASE 5.0A — AUTOMATED SECURITY TEST SPECIFICATION
## Comprehensive Verification Matrix, Adversarial Test Scenarios, and Safety Protocols
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Quality Assurance & Security Verification Specification — Design Only  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Testing Philosophy & Security Verification Strategy

This specification defines the complete automated testing framework required to validate ATLAS OS Migration 015 prior to staging and production deployment.

### 1.1 Testing Pyramid & Environmental Boundaries
1. **Tier 1: Local Vitest & Mock Harness (Client-Safe):**
   - Location: `src/lib/__tests__/`, `src/services/__tests__/`.
   - Scope: Client-side mapping, error handling, parameter validation, and offline simulation in the local storage engine. Runs offline with zero external network dependencies.
2. **Tier 2: Isolated PostgreSQL pgTAP / SQL Unit Tests (Dedicated Database):**
   - Location: `supabase/tests/database/`.
   - Scope: Direct execution of DDL, table grants, RLS evaluation, trigger firings, and RPC failure modes. Run inside disposable Docker containers or an isolated staging sandbox.
3. **Tier 3: End-to-End Concurrency & Integration Tests (Staging Multi-Tenant):**
   - Location: `e2e/security/`.
   - Scope: Multi-client concurrent execution, row lock ordering, deprovisioning worker lease expiration, and network failure reconciliation against the staging Supabase project (`bwswqnhlebbzdxumlkih`).

### 1.2 Mandatory Safety Protocols
- **Production Isolation:** Under no circumstances may any test script or harness connect to production reference `hrxjgbupjtikokqxjzbh`.
- **Dedicated Disposable Tenants:** All integration tests against staging must generate dedicated, disposable test tenants (`test_org_<uuid>`) and tear them down post-execution. Shared seed data must never be altered or deleted.
- **Strict Read-Only Stance for Phase 5.0A:** This document specifies tests to be written and executed during Phase 5.0D. **No test files or database mutations are executed in this phase.**

---

## 2. Test Specification Matrix

Every test in this specification adheres to the standardized audit schema:
`Test ID | Scenario | Setup | Action | Expected result | Security invariant | Evidence required`

---

### 2.1 Tenant Isolation Test Suite (`SEC-TENANT`)

| Test ID | Scenario | Setup | Action | Expected Result | Security Invariant | Evidence Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-TENANT-01** | Cross-Tenant Invoice Read Denial | Two distinct orgs ($A, B$). User $U_A$ is member of $A$; User $U_B$ is member of $B$. Invoice $I_A$ exists in $A$. | $U_B$ executes direct PostgREST `SELECT * FROM invoices WHERE id = I_A`. | Empty result set (`[]`) returned; zero rows exposed. | Multi-tenant RLS isolation prevents cross-organization data leakage. | PostgREST HTTP 200 response with empty JSON array `[]`. |
| **SEC-TENANT-02** | Cross-Tenant Membership Read Denial | Org $A$ with members $U_A, U_{A2}$. Org $B$ with member $U_B$. | $U_B$ executes direct PostgREST `SELECT * FROM memberships WHERE organization_id = Org_A`. | Empty result set (`[]`) returned. | User can only inspect memberships of organizations where they hold active membership. | HTTP 200 with empty array `[]`. |
| **SEC-TENANT-03** | Cross-Tenant RPC Parameter Manipulation | User $U_B$ authenticates as member of $B$. Invoice $I_A$ exists in $A$. | $U_B$ calls `record_payment_and_allocate(p_org_id => B, p_invoice_id => I_A, ...)`. | Transaction aborted with exception `Invoice does not belong to specified organization.` | Server-side RPC asserts document tenant ownership under lock. | PostgreSQL error code `42501` or `P0002`. |
| **SEC-TENANT-04** | Cross-Tenant Line Item Injection | Org $A$ has product $P_A$. Org $B$ has product $P_B$. User $U_A$ creates invoice in $A$. | $U_A$ calls `create_invoice_with_items` supplying line item with `product_id = P_B`. | Transaction aborted with exception `Product P_B does not belong to organization A.` | Line items must reference products owned exclusively by the document tenant. | PostgreSQL error code `23514` or `P0002`. |
| **SEC-TENANT-05** | Organization ID Substitution on Invoice Sequence | User $U_B$ is member of Org $B$. Org $A$ exists. | $U_B$ calls `allocate_document_number(p_org_id => A, p_doc_type => 'INVOICE')`. | Function aborts with `Access denied: User is not an active member of organization A.` | Sequence allocation verifies tenant membership under Level 2 lock. | PostgreSQL error code `42501`. |

---

### 2.2 Membership & Role Security Test Suite (`SEC-MEMB`)

| Test ID | Scenario | Setup | Action | Expected Result | Security Invariant | Evidence Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-MEMB-01** | Direct REST DML Denial on Memberships | Org $A$ exists with active owner $U_{Owner}$. | $U_{Owner}$ issues direct HTTP `DELETE /rest/v1/memberships?id=...` using user JWT. | Request rejected with HTTP 401/403 `42501 permission denied for table memberships`. | Direct table DML is completely revoked from `authenticated`. | PostgREST error response containing code `42501`. |
| **SEC-MEMB-02** | `service_role` Direct DML Revocation | Staging Supabase environment with `service_role` key. | Script issues direct SQL `UPDATE memberships SET role = 'owner'` using `service_role` connection without RPC. | Query rejected with `permission denied for table memberships`. | `service_role` direct table DML is revoked to prevent unconstrained backdoors. | Database engine error code `42501`. |
| **SEC-MEMB-03** | Last-Owner Self-Demotion Rejection | Org $A$ has exactly one active owner $U_{Owner}$. | $U_{Owner}$ calls `update_organization_member_role(p_org_id => A, p_member_id => M_Owner, p_new_role => 'admin')`. | Transaction rolls back with `Cannot remove or demote the sole active owner.` | An organization must always retain at least one active owner. | PostgreSQL error code `23514` (check_violation). |
| **SEC-MEMB-04** | Unauthorized Role Escalation by Admin | Org $A$ has owner $U_O$ and admin $U_{Admin}$. | $U_{Admin}$ calls `update_organization_member_role(p_org_id => A, p_member_id => M_Admin, p_new_role => 'owner')`. | Transaction rolls back with `Unauthorized: Only organization owners can assign owner role.` | Role escalation is strictly prohibited; only owners can promote to owner. | PostgreSQL error code `42501`. |
| **SEC-MEMB-05** | Atomic Ownership Transfer (DEC-01 Option A) | Org $A$ with owner $U_1$ and admin $U_2$. Single-owner constraint active. | $U_1$ calls `transfer_organization_ownership(p_org_id => A, p_new_owner_id => U_2)`. | In a single transaction, $U_1$ becomes `admin` and $U_2$ becomes `owner`. Unique index satisfied. | Owner cardinality invariant maintained without intermediate zero-owner or two-owner state. | Database query showing exactly one owner row ($U_2$). |
| **SEC-MEMB-06** | Concurrent Ownership Transfer Deadlock Freedom | Org $A$ with co-owners $U_1, U_2$ and members $U_3, U_4$. | Worker 1 transfers ownership to $U_3$; Worker 2 concurrently transfers ownership to $U_4$. | Both workers acquire Level 2 lock on Org $A$ (`FOR UPDATE`). Worker 1 commits; Worker 2 executes sequentially without deadlock (`40P01`). | Serialization through Level 2 org lock guarantees acyclic execution. | pg_stat_activity logs showing zero deadlock occurrences. |
| **SEC-MEMB-07** | Member Mutation Blocked During Active Deprovisioning | Org $A$ with owner $U_1$ and member $U_2$. $U_2$ has active request in `INITIATED` state. | $U_1$ calls `update_organization_member_role(..., p_member_id => M_U2, ...)`. | RPC aborts with `Operation denied: Active user deprovisioning request in progress.` | Deprovisioning state check blocks mutations on identities undergoing offboarding. | PostgreSQL error code `55P03`. |

---

### 2.3 Financial Integrity Test Suite (`SEC-FIN`)

| Test ID | Scenario | Setup | Action | Expected Result | Security Invariant | Evidence Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-FIN-01** | Direct REST Invoice Insertion Denial | Org $A$ exists. User $U_A$ holds `accounts` role. | $U_A$ issues HTTP `POST /rest/v1/invoices` with JSON invoice payload. | Request rejected with HTTP 403 `42501 permission denied for table invoices`. | Invoices can only be created via trusted RPC `create_invoice_with_items`. | PostgREST HTTP 403 response with code `42501`. |
| **SEC-FIN-02** | Issued Invoice Immutability Trigger | Org $A$ has invoice $I_1$ in `ISSUED` status. | An authorized user calls direct SQL `UPDATE invoices SET total_amount = 0.00 WHERE id = I_1`. | Operation rejected by trigger `trg_enforce_invoice_immutability`: `Fiscal attributes of an issued invoice are immutable.` | Finalized commercial documents are strictly immutable. | PostgreSQL error code `23514`. |
| **SEC-FIN-03** | Issued Invoice Line Items Deletion Denial | Org $A$ has invoice $I_1$ with 3 line items. Status is `ISSUED`. | User attempts direct SQL `DELETE FROM invoice_items WHERE invoice_id = I_1`. | Operation rejected by trigger: `Line items of an issued invoice cannot be deleted.` | Line items cannot be dropped once parent invoice is issued. | PostgreSQL error code `23514`. |
| **SEC-FIN-04** | Atomic Invoice Rollback on Line Failure | Org $A$ exists. Product $P_1$ valid; Product $P_2$ invalid (deleted/foreign). | User calls `create_invoice_with_items` with line 1 ($P_1$) and line 2 ($P_2$). | Entire transaction rolls back. Zero rows inserted into `invoices`, zero rows into `invoice_items`. | Atomic invoice creation prevents orphaned or partial invoice headers. | `SELECT count(*)` on invoices and invoice_items remains unchanged. |
| **SEC-FIN-05** | Overpayment Rejection | Org $A$ has invoice $I_1$ with balance due of ₹1,000.00. | User calls `record_payment_and_allocate(..., p_invoice_id => I_1, p_amount => 1500.00)`. | Transaction aborted with `Allocated amount exceeds outstanding invoice balance.` | Payment allocations cannot exceed unpaid balance. | PostgreSQL error code `23514`. |
| **SEC-FIN-06** | Concurrent Payment Allocation Serialization | Org $A$ has invoice $I_1$ with balance due of ₹1,000.00. | Worker 1 attempts to allocate ₹600.00; Worker 2 concurrently attempts to allocate ₹600.00. | Both workers attempt `SELECT ... FROM invoices WHERE id = I_1 FOR UPDATE`. Worker 1 commits; Worker 2 unblocks, re-evaluates balance (₹400.00 remaining), and rejects ₹600.00 allocation. | Row-level locking on invoice header eliminates race conditions and overpayment. | Total paid on invoice equals ₹600.00, not ₹1,200.00. |
| **SEC-FIN-07** | Stock Movement Append-Only Enforcement | Org $A$ has stock movement entry $SM_1$. | User issues direct SQL `UPDATE stock_movements SET quantity_change = 999 WHERE id = SM_1`. | Operation rejected by trigger `trg_enforce_stock_immutability`: `Stock movements are append-only.` | Physical inventory ledger cannot be retroactively edited. | PostgreSQL error code `23514`. |
| **SEC-FIN-08** | Audit Event Immutability | Org $A$ has audit event row $AE_1$. | User attempts direct SQL `DELETE FROM audit_events WHERE id = AE_1`. | Operation rejected by trigger: `Audit events cannot be deleted or modified.` | Forensic audit trail is completely immutable. | PostgreSQL error code `23514`. |

---

### 2.4 Deprovisioning Concurrency & Recovery Test Suite (`SEC-DEPROV`)

| Test ID | Scenario | Setup | Action | Expected Result | Security Invariant | Evidence Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-DEPROV-01** | Single Active Request Constraint | User $U_1$ has an existing request in `INITIATED` status. | $U_1$ calls `initiate_user_deprovisioning(...)` a second time. | Call rejected by partial unique index `idx_user_deprov_active_req`. | A user can have at most one active deprovisioning request. | PostgreSQL error code `23505` (unique_violation). |
| **SEC-DEPROV-02** | Stale Worker Fencing Token Rejection | Request $R_1$ has `fencing_token = 2` held by Worker 2. Worker 1 holds stale `fencing_token = 1`. | Worker 1 attempts to transition state: `complete_user_deprovisioning(p_req_id => R_1, p_fencing_token => 1)`. | Update affects 0 rows; RPC throws `Fencing token mismatch: Lease expired or claimed by another worker.` | Monotonic database fencing tokens prevent stale workers from corrupting state. | PostgreSQL error code `55P03`. |
| **SEC-DEPROV-03** | Last-Owner Deprovisioning Block | User $U_1$ is the sole active owner of Org $A$. | Worker attempts to execute `sever_user_memberships(p_req_id => R_1)`. | Severance transaction aborts with `Cannot sever membership: User is the sole active owner of organization A.` State set to `FAILED`. | Deprovisioning state machine preserves tenant ownership invariants. | Request status in database is `FAILED` with error details JSONB. |
| **SEC-DEPROV-04** | Multi-Organization Severance Lock Ordering | User $U_1$ belongs to Orgs with UUIDs: `3333...`, `1111...`, `2222...`. | Worker executes `sever_user_memberships(p_req_id => R_1)`. | Database locks organizations in ascending order: `1111...` $\rightarrow$ `2222...` $\rightarrow$ `3333...`. | Ascending lock acquisition guarantees deadlock freedom. | Query trace showing `ORDER BY organization_id ASC`. |
| **SEC-DEPROV-05** | GoTrue Ban HTTP 404 Recovery | User $U_1$ exists in DB but is already missing in GoTrue. Request is in `INITIATED`. | Worker calls GoTrue Admin Ban API; receives HTTP 404. Worker invokes recovery logic. | Worker advances request status to `AUTH_LOCKED` and proceeds to Step 3 (Membership Severance). Does NOT mark `COMPLETED`. | HTTP 404 Context Rule: Missing Auth identity does not excuse uncleared database memberships. | DB state advances to `AUTH_LOCKED`, then `MEMBERSHIPS_SEVERED`. |
| **SEC-DEPROV-06** | GoTrue Deletion HTTP 404 Recovery | User $U_1$ memberships are severed (`MEMBERSHIPS_SEVERED`). GoTrue returns HTTP 404 on `DELETE /admin/users/{id}`. | Worker invokes recovery logic. | Worker treats HTTP 404 as successful identity deletion and advances request status to `COMPLETED`. | HTTP 404 Context Rule: Deleting an already-absent identity after severance is idempotent success. | DB state advances to `COMPLETED` with `completed_at` timestamp. |
| **SEC-DEPROV-07** | Worker Crash & Lease Expiration Recovery | Worker 1 claims request $R_1$, increments fencing token to 1, sets lease for 60s, then crashes. | 65 seconds elapse. Worker 2 scans for expired leases and calls `claim_deprovisioning_request`. | Worker 2 successfully claims $R_1$, increments fencing token to 2, and completes the workflow. | Expired worker leases enable automatic failover and completion. | Request history showing two distinct worker claims and successful completion. |

---

### 2.5 Privilege & System Catalog Test Suite (`SEC-PRIV`)

| Test ID | Scenario | Setup | Action | Expected Result | Security Invariant | Evidence Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-PRIV-01** | `anon` Effective Privilege Audit | Fresh staging database. Connected as `anon` role. | Query `has_table_privilege('anon', 'public.memberships', 'INSERT, UPDATE, DELETE, TRUNCATE')`. | All functions return `FALSE`. | Unauthenticated web visitors have zero write privileges on the database catalog. | Query result showing `FALSE` across all DML operations. |
| **SEC-PRIV-02** | `authenticated` TRUNCATE Denial | Connected as `authenticated` tenant user. | Execute `TRUNCATE TABLE public.invoices;`. | Command rejected with `permission denied for table invoices`. | TRUNCATE privilege is completely revoked from all client roles. | PostgreSQL error code `42501`. |
| **SEC-PRIV-03** | Fixed `search_path` on SECURITY DEFINER Functions | System catalog inspection. | Query `pg_proc` for all Migration 015 functions: `SELECT proname, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace`. | Every function contains `proconfig = '{search_path=public, pg_temp}'`. | Explicit search_path prevents search-path hijacking attacks. | Catalog query showing exact configuration string. |
| **SEC-PRIV-04** | Function Ownership Audit | System catalog inspection. | Query `pg_proc` joined with `pg_roles` for function owner. | All functions owned by `postgres` or `supabase_admin`. No function owned by `anon` or `authenticated`. | Functions must be owned by trusted administrative roles. | Catalog query showing owner `postgres`. |

---

## 3. Test Execution Protocol & Staging Authorization Gates

### 3.1 Pre-Flight Safety Verification
Before executing any Tier 3 integration test against staging reference `bwswqnhlebbzdxumlkih`:
1. Verify `supabase/.temp/project-ref` equals `bwswqnhlebbzdxumlkih`.
2. Confirm production reference `hrxjgbupjtikokqxjzbh` is absent from all environment variables, connection strings, and test files.
3. Assert that the test runner initializes with a unique test run prefix: `ATLAS_TEST_RUN_<TIMESTAMP>`.

### 3.2 Post-Test Cleanup Mandate
All integration test suites must implement an unconditional `afterAll` hook:
1. Deletes all organizations where `name LIKE 'ATLAS_TEST_%'`.
2. Verifies zero test rows remain in `memberships`, `invoices`, or `payments`.
3. Verifies no unresolved locks exist in `pg_locks`.
