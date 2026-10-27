# ATLAS OS — Security & Tenant Isolation

## 1. Multi-Tenant Row Level Security (RLS)

All tenant-scoped tables feature mandatory RLS policies in PostgreSQL.
Policies verify that `auth.uid()` has an active membership in `organization_id`:

```sql
CREATE POLICY "Tenant isolation for products"
ON products FOR ALL
USING (
  organization_id IN (
    SELECT organization_id FROM memberships WHERE user_id = auth.uid()
  )
);
```

## 2. Role-Based Access Control (RBAC) Matrix

| Action / Capability | Owner | Admin | Sales | Inventory | Accounts | Viewer |
|---------------------|:-----:|:-----:|:-----:|:---------:|:--------:|:------:|
| Manage Org & Members|  ✅   |   ⚠️  |   ❌  |    ❌     |    ❌    |   ❌   |
| View Audit Logs     |  ✅   |   ✅  |   ❌  |    ❌     |    ❌    |   ❌   |
| Product Catalog (W) |  ✅   |   ✅  |   ❌  |    ✅     |    ❌    |   ❌   |
| Adjust Stock Ledger |  ✅   |   ✅  |   ❌  |    ✅     |    ❌    |   ❌   |
| Create Quotation    |  ✅   |   ✅  |   ✅  |    ❌     |    ❌    |   ❌   |
| Confirm Sales Order |  ✅   |   ✅  |   ✅  |    ❌     |    ❌    |   ❌   |
| Issue Invoice       |  ✅   |   ✅  |   ❌  |    ❌     |    ✅    |   ❌   |
| Record Payments     |  ✅   |   ✅  |   ❌  |    ❌     |    ✅    |   ❌   |
| View Reports        |  ✅   |   ✅  |   ❌  |    ❌     |    ✅    |   ❌   |
| Read-Only Access    |  ✅   |   ✅  |   ✅  |    ✅     |    ✅    |   ✅   |

*(⚠️ Admin can manage members below Owner level, cannot delete organization)*

## 3. Secret Management & Frontend Exposure Safeguards

- Only public client keys (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are permitted in frontend code.
- Service-role keys, database connection strings, and LLM provider secrets must NEVER be prefixed with `VITE_` or bundled in client builds.
- Critical mutations (order stock deductions, payment balance reconciliations) execute inside PostgreSQL functions (`SECURITY DEFINER` with fixed `search_path`) or trusted server endpoints.
