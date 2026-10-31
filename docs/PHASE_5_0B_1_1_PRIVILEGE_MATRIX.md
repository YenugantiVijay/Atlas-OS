# PHASE 5.0B.1.1 — MASTER DATABASE PRIVILEGE MATRIX
## Production-Grade Access Control: SQL Grants, RLS Enforcement, Trigger Invariants, and Service-Role Boundaries
**ATLAS OS Enterprise SaaS ERP Platform**  
**Classification:** Database Security Architecture & Privilege Specification — Read-Only Design  
**Target Repository:** `D:\Projects\Atlas-OS` | **Branch:** `Vijay-Atlas`  
**Target Staging Ref:** `bwswqnhlebbzdxumlkih` | **Production Ref:** `hrxjgbupjtikokqxjzbh` (STRICTLY FORBIDDEN)

---

## 1. Executive Summary & Security Philosophy

This document defines the **Production-Grade Privilege Matrix** for ATLAS OS. It replaces the naive "blanket revocation" of `service_role` privileges proposed in earlier drafts with a nuanced, multi-tiered security architecture.

### 1.1 The Core Architectural Challenge
1. **The Client-Side Threat (PostgREST):** The `authenticated` role represents logged-in web browser clients. Under Migration 007, authenticated users holding operational roles (`owner`, `admin`, `accounts`) possess direct REST `INSERT`, `UPDATE`, and `DELETE` access. This bypasses sequence generators, audit logs, and row-level lock ordering.
2. **The Backend Worker Need (`service_role`):** The Supabase `service_role` is utilized by legitimate asynchronous workers, Edge Functions, automated billing webhooks, batch invoice generators, and operational maintenance scripts. A blanket `REVOKE ALL FROM service_role` completely breaks these backend workflows.
3. **The Solution — Multi-Layered Defense in Depth:**
   - **Layer 1: SQL Grants (Table Privileges):** Revoke direct client DML from `anon` and `authenticated`. Grant constrained operational privileges to `service_role`.
   - **Layer 2: Row Level Security (RLS):** Strictly isolates tenants on direct `SELECT` queries for `authenticated`. `service_role` retains `BYPASSRLS` for cross-tenant batch processing.
   - **Layer 3: Trigger Invariants:** Physical `BEFORE UPDATE OR DELETE` triggers on financial and audit tables execute for **ALL** database roles, including `service_role` (since `BYPASSRLS` does not bypass PostgreSQL triggers).
   - **Layer 4: Trusted RPC Layer (`SECURITY DEFINER`):** All client-facing mutations are executed through vetted database functions running with table-owner (`postgres`) privileges.

---

## 2. Table-by-Table Master Privilege Matrix

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                     TABLE-BY-TABLE SQL PRIVILEGE SPECIFICATION                                                    │
├──────────────────────────────────┬──────────────┬───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ Database Entity / Table          │ `anon`       │ `authenticated` (Client JWT)  │ `service_role` (Backend Key)  │ `postgres` (Definer Role)       │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.organizations`           │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (via RPC/DBA)  │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.memberships`             │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (Protected)    │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.organization_ownership`  │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (Protected)    │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.custom_roles`            │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE, DELETE│ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ (Subject to trigger bounds)   │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.role_permissions`        │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE, DELETE│ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │                               │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.membership_permission_   │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE, DELETE│ ALL PRIVILEGES                  │
│ overrides`                       │              │ DML Revoked (via RPC only)    │                               │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.branches`                │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (FK Protected) │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.document_sequences`      │ None         │ SELECT (RLS: Member Only)     │ SELECT, UPDATE                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (Seq Protected)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.approval_rules`          │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE, DELETE│ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │                               │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.approval_requests`       │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked                │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.approval_decisions`      │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ UPDATE/DELETE Revoked (Log)   │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.invoices`                │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (Trigger Bound)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.invoice_items`           │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked (Trigger Bound)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.payments`                │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ UPDATE/DELETE Revoked (Ledger)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.payment_allocations`     │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ UPDATE/DELETE Revoked (Ledger)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.stock_movements`         │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ UPDATE/DELETE Revoked (Ledger)│                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.audit_events`            │ None         │ SELECT (RLS: Member Only)     │ SELECT, INSERT                │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ UPDATE/DELETE Revoked (Log)   │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.user_deprovisioning_req` │ None         │ SELECT (RLS: Self/Admin Only) │ SELECT, INSERT, UPDATE        │ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ DELETE Revoked                │                                 │
├──────────────────────────────────┼──────────────┼───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ `public.idempotency_keys`        │ None         │ SELECT (RLS: Self Only)       │ SELECT, INSERT, UPDATE, DELETE│ ALL PRIVILEGES                  │
│                                  │              │ DML Revoked (via RPC only)    │ (Worker TTL Cleanup Permitted)│                                 │
└──────────────────────────────────┴──────────────┴───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

---

## 3. The Four-Tier Enforcement Architecture

### 3.1 Tier 1: Client Privileges (`anon` and `authenticated`)
- **Direct Table Privileges:**
  - `GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;`
  - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated, anon;`
- **Result:** Any direct PostgREST attempt to issue `POST /rest/v1/invoices` or `DELETE /rest/v1/memberships?id=...` is immediately aborted at the PostgreSQL parser stage with:
  `ERROR: 42501: permission denied for table <table_name>`
- **Execution Path:** Authenticated users mutate data **exclusively** by calling whitelisted `SECURITY DEFINER` RPCs (`/rest/v1/rpc/create_invoice_with_items`, etc.).

### 3.2 Tier 2: Backend Worker Privileges (`service_role`)
- **Preserved Operational Capabilities:**
  - `service_role` retains `SELECT`, `INSERT`, and constrained `UPDATE` on operational entities (`invoices`, `memberships`, `approval_requests`).
  - This allows Edge Functions, background workers, and automated integrations to perform bulk syncs or system tasks without running into privilege denial.
- **Revoked Destructive Capabilities:**
  - `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM service_role;` (Blocks accidental or malicious whole-table purges).
  - `REVOKE DELETE ON TABLE invoices, invoice_items, payments, payment_allocations, stock_movements, audit_events FROM service_role;` (Guarantees append-only ledger survival).

### 3.3 Tier 3: Trigger Invariant Boundary (Unbypassable by `service_role`)
- **PostgreSQL Execution Principle:**
  In Supabase PostgreSQL, the `service_role` user possesses the `BYPASSRLS` attribute. This means `service_role` queries bypass Row Level Security `USING` and `WITH CHECK` clauses.
- **CRITICAL FACT:** **`BYPASSRLS` DOES NOT BYPASS POSTGRESQL TRIGGERS.**
  Triggers attached with `BEFORE UPDATE OR DELETE` fire unconditionally for `service_role`, `authenticated`, and ordinary database roles. The only way to bypass triggers in PostgreSQL is by altering the session configuration (`SET session_replication_role = replica`), which requires **superuser (`SUPERUSER`)** privileges that `service_role` does not possess.
- **Security Invariant:** Even if an Edge Function operating under `service_role` attempts to execute:
  ```sql
  UPDATE public.invoices SET total_amount = 0.00 WHERE id = '...';
  ```
  The trigger `trg_enforce_financial_immutability` intercepts the operation and raises error `23514 (check_violation)`, protecting the ledger against rogue backend code!

### 3.4 Tier 4: Database Administrator / Superuser (`postgres` / `supabase_admin`)
- Retains full unconstrained DDL and DML capabilities.
- Governed exclusively by operational DBA break-glass runbooks, cold backups, and physical audit logs.

---

## 4. DDL Specification for Privilege Enforcement (Migration 015)

```sql
-- Architectural Specification: Precision Grant & Revoke Protocol

-- 1. Revoke all DML from public and anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- 2. Client Role: authenticated (Read-Only via RLS; Zero Direct DML)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 3. Backend Role: service_role (Constrained Operations; Zero Ledger Delete; Zero Truncate)
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM service_role;
REVOKE DELETE ON TABLE 
    public.invoices, 
    public.invoice_items, 
    public.payments, 
    public.payment_allocations, 
    public.stock_movements, 
    public.audit_events,
    public.approval_decisions,
    public.organizations,
    public.organization_ownership,
    public.memberships
FROM service_role;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT DELETE ON TABLE public.idempotency_keys, public.custom_roles, public.role_permissions TO service_role;

-- 4. Trusted Functions: Revoke default PUBLIC execution, grant to authenticated
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION 
    public.create_organization,
    public.appoint_co_owner,
    public.remove_co_owner,
    public.initiate_primary_ownership_transfer,
    public.accept_primary_ownership_transfer,
    public.cancel_primary_ownership_transfer,
    public.save_custom_role,
    public.create_invoice_with_items,
    public.submit_approval_decision,
    public.record_payment_and_allocate,
    public.dispatch_stock_transfer,
    public.receive_stock_transfer,
    public.initiate_user_deprovisioning
TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
```

---

## 5. Security Responsibility & Privilege Verification Summary

| Security Boundary | Enforced By | Bypassed By `authenticated`? | Bypassed By `service_role`? |
| :--- | :--- | :---: | :---: |
| **Direct Client DML Block** | PostgreSQL Table Privileges | **NO** (SQL Error `42501`) | N/A (Permitted where safe) |
| **Tenant Data Isolation** | Row Level Security (RLS) | **NO** (Scoped to Tenant) | **YES** (`BYPASSRLS` for batch) |
| **Financial Ledger Immutability** | `BEFORE UPDATE/DELETE` Triggers | **NO** (Error `23514`) | **NO** (Error `23514`) |
| **Last-Owner Invariant** | Deferred Constraint Triggers | **NO** (Error `23514`) | **NO** (Error `23514`) |
| **Deadlock Freedom** | Global Lock Hierarchy | **NO** (Serialized) | **NO** (Serialized) |
