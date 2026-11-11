export const definitions = [["STG-01","Environment","Staging health","Check Supabase staging is ACTIVE_HEALTHY with a read-only SELECT 1.",false,["Open the ATLAS-OS-Staging project and verify ACTIVE_HEALTHY.","Run read-only SELECT 1, confirm this is not production.","Record evidence time, source link, and any issue."]],["MIG-01","Database","Migrations 001–048","Verify all 48 migrations exist in order, including 047 and 048.",false,["Read the staging migration history.","Compare version sequence to 001–048 and review migrations 047/048.","Record any mismatch and its migration evidence URL."]],["AUTH-01","Authentication","Real Supabase Auth login","Verify a real staging-issued JWT and tenant membership.",true,["Provision disposable staging-only users in two organizations.","Sign in with real Supabase Auth and inspect authenticated request identity without exposing JWT secrets.","Capture sanitized browser/network traces on the exact main SHA."]],["GRN-01","Goods receiving","Authenticated GRN draft","Draft must not change stock or create purchase-price history.",true,["Sign in as authorized inventory role.","Save a 10 cases × 12 units + 2 loose units draft.","Read back DRAFT status with zero movements and zero price snapshots."]],["GRN-02","Goods receiving","Authenticated GRN post","Post once and capture actual received rate and 122 units.",true,["Post the GRN created by GRN-01 as a real staging user.","Verify posted status, exactly 122 units and one stock movement.","Read back one GOODS_RECEIPT price snapshot and its audit actor."]],["QUOTE-01","Supplier quotes","Authenticated supplier quote","Permitted roles may record date-specific supplier notices.",true,["Authenticate with owner/admin/inventory role.","Record quote using stable UUID, product, supplier, date and new rate.","Read the appended SUPPLIER_QUOTE timeline row using the real session."]],["PRICE-01","Supplier prices","Supplier price comparison","Show preceding supplier-specific rate and ≥5% advisory.",true,["Create dated quotes and posted receipt rates for one supplier/product.","Check last as-of rate and ≥5% advisory in Goods Receiving.","Switch suppliers to prove histories do not mix; ensure selling prices remain intact."]],["DUP-01","Integrity","Duplicate prevention","Retry must not duplicate stock, price or audit events.",true,["Replay posted receipt with same idempotency key.","Replay identical quote UUID; verify exactly one price and audit row.","Reuse key with changed payload; expect error and no side effects."]],["TENANT-01","Isolation","Cross-tenant isolation","Organization B must never see or mutate organization A data.",true,["Authenticate using staging organization B-only user.","Attempt read of organization A stock, quotes, GRNs and rates.","Attempt unauthorized quote/post; verify access denial and unchanged A records."]],["ROLE-01","Permissions","Real role restrictions","Owner/admin/inventory, accounts, and sales must respect cost/RPC roles.",true,["Sign in as each of five organization roles with actual issued sessions.","Verify owner/admin/inventory can quote; accounts read only; sales cannot view rates.","Attempt direct denied REST/RPC actions and document responses."]],["AUDIT-01","Audit","Exactly one quote audit event","Quotes must create attributable audit records without duplicate replay.",true,["Record a valid quote with authenticated user and stable UUID.","Read audit_events by organization/entity and actor.","Replay same quote; check audit count remains one."]],["IMMUT-01","Integrity","Append-only price history","Historical rate entries cannot be edited/deleted by any authenticated role.",true,["Attempt INSERT/UPDATE/DELETE directly using a real staging user.","Verify denial and that guarded quote RPC can only append.","Check old rate/date/source snapshots remain unchanged."]],["STOCK-01","Stock safeguards","Stock changed only on post","New product creation and drafts/quotes must not change stock.",true,["Create a product inside receiving with zero opening stock.","Save GRN draft and record quote; check no movements.","Post once and verify exact stock; retry does not duplicate movement."]],["SAFE-01","Price safeguards","Master and historic prices unchanged","Supplier rate events must never silently rewrite selling prices or old invoice values.",true,["Record product purchase cost and selling price and any prior invoice values.","Record new quote and post a changed-rate GRN.","Read back and prove unchanged master and historic records; advisory only."]],["SMOKE-01","Browser acceptance","Real Stock Movements browser smoke","Verify receipt screen, product suggestions and Stock Movements using actual staging auth.",true,["Sign in as staging inventory member with posted receipt.","Open Stock Movements; verify tenant scoped ledger and no relationship error.","Search stock and selling price; create product inline, enter cartons, save/post and attach trace."]]];
/** Verified read-only against ATLAS-OS-Staging. Supabase uses timestamp IDs for later migrations. */
export const migrationCatalog = Object.freeze([
  {
    "version": 1,
    "name": "multi_tenant_base",
    "observed_id": "001"
  },
  {
    "version": 2,
    "name": "products_customers_suppliers",
    "observed_id": "002"
  },
  {
    "version": 3,
    "name": "inventory_ledger",
    "observed_id": "003"
  },
  {
    "version": 4,
    "name": "quotations_and_orders",
    "observed_id": "004"
  },
  {
    "version": 5,
    "name": "invoices_and_payments",
    "observed_id": "005"
  },
  {
    "version": 6,
    "name": "security_audit_fixes",
    "observed_id": "006"
  },
  {
    "version": 7,
    "name": "security_and_integrity_audit_fixes",
    "observed_id": "007"
  },
  {
    "version": 8,
    "name": "fix_authorization_vulnerabilities_and_null_roles",
    "observed_id": "008"
  },
  {
    "version": 9,
    "name": "totals_version_and_document_discount_schema",
    "observed_id": "009"
  },
  {
    "version": 10,
    "name": "robust_document_numbering_sequences",
    "observed_id": "010"
  },
  {
    "version": 11,
    "name": "atomic_receipt_numbering",
    "observed_id": "011"
  },
  {
    "version": 12,
    "name": "organization_creation_rpc",
    "observed_id": "012"
  },
  {
    "version": 13,
    "name": "business_eligibility_and_trials",
    "observed_id": "013"
  },
  {
    "version": 14,
    "name": "harden_operational_rls_with_eligibility",
    "observed_id": "014"
  },
  {
    "version": 15,
    "name": "atomic_invoice_creation_rpc",
    "observed_id": "20261110181120"
  },
  {
    "version": 16,
    "name": "sales_order_invoicing_lifecycle",
    "observed_id": "20261110181142"
  },
  {
    "version": 17,
    "name": "revoke_direct_payment_dml",
    "observed_id": "20261110181145"
  },
  {
    "version": 18,
    "name": "atomic_organization_creation",
    "observed_id": "20261110181148"
  },
  {
    "version": 19,
    "name": "atomic_organization_and_eligibility",
    "observed_id": "20261110181153"
  },
  {
    "version": 20,
    "name": "reliability_and_security_hardening",
    "observed_id": "20261110181156"
  },
  {
    "version": 21,
    "name": "inventory_integrity_and_stock_validation",
    "observed_id": "20261110181159"
  },
  {
    "version": 22,
    "name": "secure_opening_stock_and_product_creation",
    "observed_id": "20261110181203"
  },
  {
    "version": 23,
    "name": "mandatory_inventory_idempotency_and_preflight",
    "observed_id": "20261110181207"
  },
  {
    "version": 24,
    "name": "master_security_lifecycle_and_order_integrity",
    "observed_id": "20261110181218"
  },
  {
    "version": 25,
    "name": "harden_authoritative_lifecycle_context",
    "observed_id": "20261110181222"
  },
  {
    "version": 26,
    "name": "authoritative_lifecycle_invoker_triggers",
    "observed_id": "20261110181225"
  },
  {
    "version": 27,
    "name": "fix_atomic_document_product_locking",
    "observed_id": "20261110181228"
  },
  {
    "version": 28,
    "name": "fix_atomic_document_product_id_normalization",
    "observed_id": "20261110181231"
  },
  {
    "version": 29,
    "name": "organization_pan_gstin_validation",
    "observed_id": "20261110181235"
  },
  {
    "version": 30,
    "name": "organization_identity_privacy_and_canonical_contract",
    "observed_id": "20261110181238"
  },
  {
    "version": 31,
    "name": "inventory_and_receivables_authoritative_aggregation",
    "observed_id": "20261110181242"
  },
  {
    "version": 32,
    "name": "cleanup_obsolete_product_creation_overload",
    "observed_id": "20261110181253"
  },
  {
    "version": 33,
    "name": "dashboard_authoritative_aggregations_and_pagination",
    "observed_id": "20261110181256"
  },
  {
    "version": 34,
    "name": "page_scoped_aggregations_and_security_hardening",
    "observed_id": "20261110181300"
  },
  {
    "version": 35,
    "name": "transaction_safety_and_workflow_reliability",
    "observed_id": "20261110181304"
  },
  {
    "version": 36,
    "name": "ledger_reconciliation_and_workflow_consistency",
    "observed_id": "20261110181307"
  },
  {
    "version": 37,
    "name": "financial_report_auth_gate",
    "observed_id": "20261110181309"
  },
  {
    "version": 38,
    "name": "restrict_raw_financial_reads",
    "observed_id": "20261110181313"
  },
  {
    "version": 39,
    "name": "financial_aggregate_role_gates",
    "observed_id": "20261110181316"
  },
  {
    "version": 40,
    "name": "financial_export_single_statement_snapshot",
    "observed_id": "20261110181319"
  },
  {
    "version": 41,
    "name": "financial_document_search",
    "observed_id": "20261110181334"
  },
  {
    "version": 42,
    "name": "customer_directory_phone_search",
    "observed_id": "20261110181337"
  },
  {
    "version": 43,
    "name": "operational_universal_search",
    "observed_id": "20261110181340"
  },
  {
    "version": 44,
    "name": "harden_privileged_rpc_and_search_paths",
    "observed_id": "20261110181343"
  },
  {
    "version": 45,
    "name": "website_lead_rate_limits",
    "observed_id": "20261110181346"
  },
  {
    "version": 46,
    "name": "search_directory_gstin_coverage",
    "observed_id": "20261110181350"
  },
  {
    "version": 47,
    "name": "bulk_goods_receipts",
    "observed_id": "20261110181354"
  },
  {
    "version": 48,
    "name": "supplier_price_history",
    "observed_id": "20261110181357"
  }
]);
export const statuses = ['verified','failed','blocked','unknown'];
export function createInitialState() {
 const evidence='https://supabase.com/dashboard/project/bwswqnhlebbzdxumlkih';
 const seenAt='2026-11-11T06:15:00.000Z';
 const checks=definitions.map(([id,section,title,description,requires_auth,next_steps],i)=>({
   id,section,title,description,priority:'critical',requires_auth,
   next_steps,status:id==='STG-01'||id==='MIG-01'?'verified':id==='AUTH-01'?'blocked':'unknown',
   evidence_method:id==='STG-01'||id==='MIG-01'?'schema-inspection':'',
   evidence_url:id==='STG-01'||id==='MIG-01'?evidence:'',
   evidence_notes:id==='STG-01'||id==='MIG-01'?'Read-only staging verification on 2026-11-11; recheck before release.':
     id==='AUTH-01'?'Staging had no test auth users or organizations at last inspection.':'',
   environment:'staging',tested_commit:'',verified_at:id==='STG-01'||id==='MIG-01'?seenAt:null,
   last_updated:seenAt,sort_order:i+1,pr_number:57
 }));
 const migrations=migrationCatalog.map(({version,name,observed_id})=>({
   version,name,observed_id,status:'verified',verified_at:seenAt,
   evidence_url:evidence+'/database/migrations',
   observed_from:'Read-only staging migration inventory on 2026-11-11'
 }));
 return {checks,migrations,runs:[],events:[],github:{repo:'YenugantiVijay/Atlas-OS',main_sha:'',dev_sha:'',pull_requests:[],ci_runs:[],last_synced_at:null,last_error:''}};
}
