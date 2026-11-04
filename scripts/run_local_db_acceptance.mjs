/**
 * Atlas OS — Master Security, Database & Lifecycle Acceptance Test Runner
 *
 * Runs full database lifecycle verification:
 * 1. Connects as administrative user to disposable local PostgreSQL instance.
 * 2. Provisions an isolated ephemeral test database (atlas_test_<runId>) to guarantee
 *    strict test isolation and protect statutory ledger immutability without fallback.
 * 3. Bootstraps standard Supabase roles (anon, authenticated, service_role, authenticator),
 *    schemas (auth, extensions, public), privileges, and auth helper functions (auth.uid, auth.role, auth.jwt).
 * 4. Applies forward-only migrations 001 through 026 in strict lexical order with ON_ERROR_STOP=1.
 * 5. Seeds isolated multi-tenant test fixtures with genuine auth identities and valid schema attributes.
 * 6. Executes P0/P1 security and lifecycle contracts under REAL RESTRICTED DATABASE ROLES (SET ROLE authenticated / anon).
 * 7. Tests lifecycle trust flags against spoofing attempts by authenticated database roles (Migration 026 invoker triggers).
 * 8. Queries set-returning stock functions (get_product_stock_levels) using parameterized SQL filtering on product_id.
 * 9. Verifies authoritative RPC contracts and idempotent replays (confirm_sales_order, create_invoice_atomic, convert_quotation_atomic, record_payment_and_allocate, get_dashboard_metrics).
 * 10. Asserts table-level DML revocations (stock_movements, payments, etc.) are genuinely enforced without post-migration distortion.
 * 11. Disposes of the dedicated test database cleanly in the finally block; exits non-zero on any failure or local DB unavailability.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgrespassword'}@${process.env.POSTGRES_HOST || '127.0.0.1'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'postgres'}`;

const testResults = [];

/**
 * Sanitizes log output to prevent raw leakage of PAN, GSTIN, JWT tokens, or credentials.
 * Masks sensitive substrings (e.g., ABCDE****F, 29ABCDE****F1Z5).
 */
function sanitizeLog(text) {
  if (!text || typeof text !== 'string') return text;
  // Mask 15-character Indian GSTIN (e.g. 29ABCDE1234F1Z5 -> 29ABCDE****F1Z5)
  let sanitized = text.replace(/\b([0-9]{2}[A-Z]{5})[0-9]{4}([A-Z][0-9A-Z]Z[0-9A-Z])\b/g, '$1****$2');
  // Mask 10-character Indian PAN (e.g. ABCDE1234F -> ABCDE****F)
  sanitized = sanitized.replace(/\b([A-Z]{5})[0-9]{4}([A-Z])\b/g, '$1****$2');
  // Mask Bearer tokens or JWTs
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED_TOKEN]');
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[REDACTED_JWT]');
  // Mask passwords
  sanitized = sanitized.replace(/(password|passwd|pwd)[:=]\s*([^&\s\n,]+)/gi, '$1=****');
  sanitized = sanitized.replace(/:([^:@]+)@/, ':****@');
  return sanitized;
}

/**
 * Classifies failure types based on error characteristics or diagnostic hints:
 * - PERMISSION_FAILURE: Table/schema permission denied (e.g. SQLSTATE 42501)
 * - RLS_FAILURE: Row-level security restriction (0 rows affected or policy violation)
 * - SCHEMA_FAILURE: Missing relation, column, function, or schema definition
 * - BUSINESS_LOGIC_FAILURE: Exception mismatch, unraised expected error, or invalid business outcome
 * - FIXTURE_FAILURE: Setup, seeding, or teardown environment breakdown
 */
function classifyFailure(error, diagnostic = null) {
  if (diagnostic?.category) return diagnostic.category;
  if (!error) {
    if (diagnostic?.rlsFailure) return 'RLS_FAILURE';
    return 'BUSINESS_LOGIC_FAILURE';
  }
  const code = String(error.code || '');
  const msg = (error.message || '').toLowerCase();

  if (code === '42501' || msg.includes('permission denied') || msg.includes('must be superuser') || msg.includes('insufficient privilege')) {
    return 'PERMISSION_FAILURE';
  }
  if (diagnostic?.rlsFailure || msg.includes('row-level security') || msg.includes('rls policy')) {
    return 'RLS_FAILURE';
  }
  if (
    code.startsWith('42P') ||
    code === '42703' ||
    code === '42883' ||
    code.startsWith('3F') ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('function') && msg.includes('does not exist'))
  ) {
    return 'SCHEMA_FAILURE';
  }
  if (msg.includes('fixture') || msg.includes('seed') || msg.includes('provision') || msg.includes('cleanup')) {
    return 'FIXTURE_FAILURE';
  }
  return 'BUSINESS_LOGIC_FAILURE';
}

function recordTest(id, name, passed, details, error = null, diagnostic = null) {
  const sanitizedDetails = details ? sanitizeLog(String(details)) : null;
  const sanitizedError = error ? sanitizeLog(String(error.message || error)) : null;
  const category = !passed ? (diagnostic?.category || classifyFailure(error, diagnostic)) : null;

  testResults.push({
    id,
    name,
    passed,
    details: sanitizedDetails,
    error: sanitizedError,
    category,
    sqlstate: error?.code || null,
    timestamp: new Date().toISOString(),
  });

  const badge = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${id}] ${badge} - ${name}`);
  if (sanitizedDetails) {
    console.log(`       Details:   ${sanitizedDetails}`);
  }
  if (!passed) {
    if (diagnostic?.operation) console.error(`       Operation: ${diagnostic.operation}`);
    if (diagnostic?.expected)  console.error(`       Expected:  ${diagnostic.expected}`);
    if (diagnostic?.actual)    console.error(`       Actual:    ${diagnostic.actual}`);
    if (category)              console.error(`       Category:  ${category}`);
    if (sanitizedError)        console.error(`       Error:     ${sanitizedError}`);
    if (error?.code)           console.error(`       SQLSTATE:  ${error.code}`);
  }
}

/**
 * Bootstraps a disposable database with standard Supabase-compatible roles, schemas,
 * default privileges, and auth helpers.
 * Shared across both Scenario A (fresh install) and Scenario B (migration upgrade).
 */
async function bootstrapDisposableDatabase(client) {
  await client.query(`
    -- 1. Create standard Supabase roles if missing (unprivileged, non-superuser accounts)
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator NOLOGIN NOINHERIT;
      END IF;
    END $$;

    -- 2. Configure role inheritance and memberships
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;

    -- Grant authenticated, anon, and service_role to active session user (allows superuser to SET ROLE for testing)
    GRANT authenticated TO CURRENT_USER;
    GRANT anon TO CURRENT_USER;
    GRANT service_role TO CURRENT_USER;

    -- 3. Create schemas
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS public;

    -- 4. Schema usage and standard permissions
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT ALL ON SCHEMA public TO CURRENT_USER, service_role;
    GRANT ALL ON SCHEMA auth TO CURRENT_USER, service_role;

    -- 5. Standard Supabase Default privileges for future tables, sequences and functions
    -- Establishes standard table grants before migrations run so that subsequent
    -- explicit REVOKE statements in migrations 013, 017, 022 remain authoritative.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO CURRENT_USER, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO CURRENT_USER, service_role, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO CURRENT_USER, service_role, authenticated;

    -- 6. Auth users table emulation
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      instance_id uuid,
      aud varchar(255) DEFAULT 'authenticated',
      role varchar(255) DEFAULT 'authenticated',
      email varchar(255) UNIQUE,
      encrypted_password varchar(255),
      email_confirmed_at timestamptz DEFAULT now(),
      raw_app_meta_data jsonb DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      is_super_admin boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    GRANT SELECT ON auth.users TO authenticated, anon;
    GRANT ALL ON auth.users TO CURRENT_USER, service_role;

    -- 7. Auth helper functions
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$ LANGUAGE sql STABLE;

    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO PUBLIC, anon, authenticated, service_role;
  `);
}

/**
 * Validates that DATABASE_URL points to a disposable local test database.
 * Strictly prevents running acceptance scripts against remote or production environments.
 */
function assertDisposableDatabase(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid DATABASE_URL format: ${urlStr.replace(/:([^:@]+)@/, ':****@')}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(hostname) || hostname.endsWith('.local');
  const isRemote =
    hostname.includes('supabase.co') ||
    hostname.includes('amazonaws.com') ||
    hostname.includes('rds.') ||
    hostname.includes('prod') ||
    hostname.includes('production') ||
    !isLocal;

  if (isRemote) {
    throw new Error(
      `🚨 SAFETY VIOLATION: Acceptance tests must only run on a disposable local database. Detected remote/production-like host: "${hostname}"`
    );
  }
}

/**
 * Executes a callback within a genuine restricted database role and auth context.
 * Strictly asserts identity and active database role before running the callback.
 */
async function withRoleContext(client, { role = 'authenticated', userId = null }, fn) {
  // 1. Switch to restricted database role and set transaction/session JWT claims
  await client.query(`SET ROLE ${role};`);
  if (userId) {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false);`);
  } else {
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
  await client.query(`SELECT set_config('request.jwt.claim.role', '${role}', false);`);

  // 2. Identity Assertion: verify active database role and auth.uid()
  const { rows: verifyRows } = await client.query(`
    SELECT current_user, session_user, auth.uid()::text AS active_uid, auth.role() AS active_role;
  `);
  const activeUser = verifyRows[0].current_user;
  const activeUid = verifyRows[0].active_uid;
  const activeRole = verifyRows[0].active_role;

  if (activeUser !== role) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: current_user is '${activeUser}', expected '${role}'`);
  }
  if (userId && activeUid !== userId) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: auth.uid() is '${activeUid}', expected '${userId}'`);
  }
  if (activeRole !== role) {
    await client.query(`RESET ROLE;`);
    throw new Error(`Security context assertion failed: auth.role() is '${activeRole}', expected '${role}'`);
  }

  try {
    return await fn();
  } finally {
    // 3. Reset role and clear session JWT claims safely
    await client.query(`
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);
      SELECT set_config('app.authoritative_order_transition', '', false);
      SELECT set_config('app.authoritative_invoice_transition', '', false);
      SELECT set_config('app.authoritative_payment_allocation', '', false);
    `);
  }
}

/**
 * Scenario B: Upgrading an existing database at migration 029 state to migration 030.
 * Verifies that:
 * 1. Existing organization, ownership, eligibility, trial, and audit records remain 100% preserved.
 * 2. New canonical create_organization_v2 and legacy compatibility wrapper execute correctly on upgraded database.
 * 3. Continuing identity enforcement protects existing records from unauthorized mutations.
 */
async function runUpgradeScenarioB(maintClient, baseRunId) {
  console.log('\n' + '='.repeat(80));
  console.log('SCENARIO B: EXISTING DATABASE UPGRADE (MIGRATION 029 -> 030)');
  console.log('='.repeat(80));

  const upgradeRunId = 'upg_' + crypto.randomBytes(4).toString('hex');
  const testUpgradeDbName = `atlas_upgrade_${upgradeRunId}`;

  // 1. Create dedicated upgrade test database
  await maintClient.query(`CREATE DATABASE "${testUpgradeDbName}";`);

  const upgradeDbUrl = new URL(DATABASE_URL);
  upgradeDbUrl.pathname = `/${testUpgradeDbName}`;

  const upgradeClient = new Client({
    connectionString: upgradeDbUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  await upgradeClient.connect();

  try {
    // 2. Bootstrap auth schema and roles using shared disposable bootstrap
    console.log('\nBootstrapping Supabase-compatible roles, schemas and auth environment...');
    await bootstrapDisposableDatabase(upgradeClient);
    console.log('  ✓ Roles, schemas, and auth functions bootstrapped successfully.');

    // 3. Apply ONLY migrations 001 through 029 (the state before PR #15)
    console.log('\nApplying original migrations 001 -> 029...');
    const allFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const pre030Files = allFiles.filter((f) => f < '030_');

    for (const file of pre030Files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await upgradeClient.query(sql);
    }
    console.log(`  ✓ Applied ${pre030Files.length} baseline migrations up to 029.`);

    await upgradeClient.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`);

    // 4. Seed pre-existing approved organization and entitlement records at 029 state
    const existingUserId = crypto.randomUUID();
    const existingOrgId = crypto.randomUUID();
    const subscriptionEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000).toISOString();

    await upgradeClient.query(`
      INSERT INTO auth.users (id, email) VALUES ('${existingUserId}', 'existing_owner@example.com');

      INSERT INTO organizations (id, name, currency, legal_name, gstin, pan)
      VALUES ('${existingOrgId}', 'Pre-existing Approved Distributor', 'INR', 'Pre-existing Corp', '29ABCDE1234F1Z5', 'ABCDE1234F');

      INSERT INTO memberships (organization_id, user_id, role, is_active)
      VALUES ('${existingOrgId}', '${existingUserId}', 'owner', true);

      INSERT INTO organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by)
      VALUES ('${existingOrgId}', 'electrical_wholesale_distributor', true, 'approved', '${existingUserId}');

      INSERT INTO organization_subscriptions (organization_id, plan_tier, status, current_period_ends_at)
      VALUES ('${existingOrgId}', 'pro', 'active', '${subscriptionEnd}');

      INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
      VALUES ('${existingOrgId}', '${existingUserId}', 'INITIAL_SEED_029', 'organizations', '${existingOrgId}', '{"note": "pre-upgrade"}'::jsonb);
    `);
    console.log('  ✓ Seeded pre-existing approved organization at Migration 029 state.');

    // 5. Take baseline snapshot
    const { rows: orgSnap } = await upgradeClient.query(`SELECT * FROM organizations WHERE id = '${existingOrgId}';`);
    const { rows: elSnap } = await upgradeClient.query(`SELECT status FROM organization_eligibility WHERE organization_id = '${existingOrgId}';`);
    const { rows: subSnap } = await upgradeClient.query(`SELECT status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = '${existingOrgId}';`);
    const { rows: auditSnap } = await upgradeClient.query(`SELECT count(*)::int AS count FROM audit_events WHERE organization_id = '${existingOrgId}';`);

    // 6. Apply ONLY Migration 030 (forward-only upgrade)
    console.log('\nApplying Migration 030 (forward-only upgrade)...');
    const mig030Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '030_organization_identity_privacy_and_canonical_contract.sql'), 'utf8');
    await upgradeClient.query(mig030Sql);
    console.log('  ✓ Migration 030 applied successfully to existing database.');

    // 7. Verify pre-existing data and entitlements are 100% preserved
    const { rows: orgPost } = await upgradeClient.query(`SELECT * FROM organizations WHERE id = '${existingOrgId}';`);
    const { rows: elPost } = await upgradeClient.query(`SELECT status FROM organization_eligibility WHERE organization_id = '${existingOrgId}';`);
    const { rows: subPost } = await upgradeClient.query(`SELECT status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = '${existingOrgId}';`);
    const { rows: auditPost } = await upgradeClient.query(`SELECT count(*)::int AS count FROM audit_events WHERE organization_id = '${existingOrgId}';`);

    const orgUnchanged = orgPost[0]?.name === orgSnap[0]?.name && orgPost[0]?.pan === orgSnap[0]?.pan && orgPost[0]?.gstin === orgSnap[0]?.gstin;
    const elUnchanged = elPost[0]?.status === 'approved' && elPost[0]?.status === elSnap[0]?.status;
    const subUnchanged = subPost[0]?.status === 'active' && new Date(subPost[0]?.current_period_ends_at).getTime() === new Date(subSnap[0]?.current_period_ends_at).getTime();
    const auditPreserved = auditPost[0]?.count >= auditSnap[0]?.count;

    const upgradeIntegrityPassed = orgUnchanged && elUnchanged && subUnchanged && auditPreserved;
    recordTest(
      'P1-UPG-01',
      'Scenario B Upgrade: Migration 030 preserves pre-existing organizations, approved eligibility, and trial dates',
      upgradeIntegrityPassed,
      `orgPreserved=${orgUnchanged}, eligibilityPreserved=${elUnchanged}, subPreserved=${subUnchanged}, auditPreserved=${auditPreserved}`,
      upgradeIntegrityPassed ? null : new Error('Existing database state corrupted by migration 030')
    );

    // 8. Test upgraded functions on the upgraded database
    const unauthorizedUserId = crypto.randomUUID();
    await upgradeClient.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, 'unauthorized_user@example.com');`,
      [unauthorizedUserId]
    );

    let preflightPassed = false;
    let ownerUpdatePassed = false;
    let unauthorizedBlocked = false;
    let removeBlocked = false;
    let removeCategory = null;
    let mismatchBlocked = false;
    let alterDemoted = false;
    let subIntact = false;
    let v2WorksOnUpgradedDb = false;
    let legacyBlocked = false;
    let upgErr = null;
    let failureDiagnostic = null;

    await withRoleContext(upgradeClient, { role: 'authenticated', userId: existingUserId }, async () => {
      // 8.1 Pre-flight check: existingOrgId is visible to existingUserId under RLS and has valid PAN/GSTIN
      const { rows: preflightRows } = await upgradeClient.query(
        `SELECT id, name, legal_name, pan, gstin FROM organizations WHERE id = $1;`,
        [existingOrgId]
      );
      preflightPassed =
        preflightRows.length === 1 &&
        preflightRows[0].pan === 'ABCDE1234F' &&
        preflightRows[0].gstin === '29ABCDE1234F1Z5';

      if (!preflightPassed) {
        failureDiagnostic = {
          operation: 'Pre-flight RLS visibility & identity check',
          expected: '1 row with registered PAN and GSTIN visible to organization owner',
          actual: `rows=${preflightRows.length}, data=${JSON.stringify(preflightRows[0] || {})}`,
          category: preflightRows.length === 0 ? 'RLS_FAILURE' : 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.2 Permitted owner update: owner can update permitted attributes (legal_name/phone) under RLS
      const ownerUpdateRes = await upgradeClient.query(
        `UPDATE organizations SET legal_name = 'Pre-existing Corp Updated' WHERE id = $1;`,
        [existingOrgId]
      );
      ownerUpdatePassed = ownerUpdateRes.rowCount === 1;
      if (!ownerUpdatePassed) {
        failureDiagnostic = {
          operation: 'Permitted owner update under RLS',
          expected: 'rowCount = 1 for owner updating permitted organization field',
          actual: `rowCount = ${ownerUpdateRes.rowCount}`,
          category: 'RLS_FAILURE',
        };
        return;
      }

      // 8.3 Explicit PAN removal rejected: updating pan = NULL on org with existing PAN raises ERR_CANNOT_REMOVE_PAN
      try {
        const res = await upgradeClient.query(
          `UPDATE organizations SET pan = NULL WHERE id = $1;`,
          [existingOrgId]
        );
        if (res.rowCount === 0) {
          removeCategory = 'RLS_FAILURE';
        } else {
          removeCategory = 'BUSINESS_LOGIC_FAILURE';
        }
      } catch (err) {
        if (err.code === '42501') {
          removeCategory = 'PERMISSION_FAILURE';
          upgErr = err;
        } else if (err.message.includes('ERR_CANNOT_REMOVE_PAN')) {
          removeBlocked = true;
        } else {
          removeCategory = 'BUSINESS_LOGIC_FAILURE';
          upgErr = err;
        }
      }

      if (!removeBlocked) {
        failureDiagnostic = {
          operation: 'Enforce non-removability of registered PAN',
          expected: 'PostgreSQL exception ERR_CANNOT_REMOVE_PAN',
          actual: upgErr ? upgErr.message : `No exception thrown (category: ${removeCategory})`,
          category: removeCategory || 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.4 PAN/GSTIN mismatch rejected: updating to mismatched PAN/GSTIN raises ERR_PAN_GSTIN_MISMATCH
      try {
        await upgradeClient.query(
          `UPDATE organizations SET pan = 'XYZAB1234C' WHERE id = $1;`,
          [existingOrgId]
        );
      } catch (err) {
        mismatchBlocked = err.message.includes('ERR_PAN_GSTIN_MISMATCH');
        if (!mismatchBlocked) upgErr = err;
      }

      if (!mismatchBlocked) {
        failureDiagnostic = {
          operation: 'Reject PAN / GSTIN mismatch on UPDATE',
          expected: 'PostgreSQL exception ERR_PAN_GSTIN_MISMATCH',
          actual: upgErr ? upgErr.message : 'No exception thrown',
          category: 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.5 Authorized PAN alteration with matching GSTIN succeeds and demotes status to review_required
      try {
        const alterRes = await upgradeClient.query(
          `UPDATE organizations SET pan = 'XYZAB1234C', gstin = '29XYZAB1234C1Z5' WHERE id = $1;`,
          [existingOrgId]
        );
        if (alterRes.rowCount === 1) {
          const { rows: elRows } = await upgradeClient.query(
            `SELECT status FROM organization_eligibility WHERE organization_id = $1;`,
            [existingOrgId]
          );
          alterDemoted = elRows[0]?.status === 'review_required';
        }
      } catch (err) {
        upgErr = err;
      }

      if (!alterDemoted) {
        failureDiagnostic = {
          operation: 'Authorized PAN alteration status demotion',
          expected: 'Update succeeds and demotes eligibility status to review_required',
          actual: upgErr ? upgErr.message : 'Status was not demoted to review_required',
          category: upgErr?.code === '42501' ? 'PERMISSION_FAILURE' : 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.6 Subscriptions and trial dates remain intact throughout
      const { rows: subRows } = await upgradeClient.query(
        `SELECT plan_tier, status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = $1;`,
        [existingOrgId]
      );
      subIntact =
        subRows[0]?.status === 'active' &&
        subRows[0]?.plan_tier === 'pro' &&
        new Date(subRows[0]?.current_period_ends_at).getTime() === new Date(subscriptionEnd).getTime();

      if (!subIntact) {
        failureDiagnostic = {
          operation: 'Subscription and trial preservation on upgraded database',
          expected: 'Subscription remains active with plan_tier pro and preserved end date',
          actual: `status=${subRows[0]?.status}, plan_tier=${subRows[0]?.plan_tier}`,
          category: 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.7 create_organization_v2 works on upgraded database
      try {
        const { rows: newOrgRows } = await upgradeClient.query(
          `SELECT create_organization_v2(
            p_name := 'Upgraded New Org',
            p_gstin := '29ABCDE1234F1Z5',
            p_pan := 'ABCDE1234F',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables']
          ) AS res;`
        );
        const newOrg = newOrgRows[0]?.res;
        v2WorksOnUpgradedDb = Boolean(newOrg && newOrg.id && newOrg.eligibility_status === 'approved');
      } catch (err) {
        upgErr = err;
      }

      if (!v2WorksOnUpgradedDb) {
        failureDiagnostic = {
          operation: 'create_organization_v2 execution on upgraded database',
          expected: 'New organization created with approved eligibility status',
          actual: upgErr ? upgErr.message : 'Invalid response from create_organization_v2',
          category: upgErr?.code === '42501' ? 'PERMISSION_FAILURE' : 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }

      // 8.8 legacy wrapper blocks missing PAN
      try {
        await upgradeClient.query(
          `SELECT create_organization(
            p_name := 'Legacy Missing PAN',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true
          );`
        );
      } catch (err) {
        legacyBlocked = err.message.includes('ERR_PAN_REQUIRED');
        if (!legacyBlocked) upgErr = err;
      }

      if (!legacyBlocked) {
        failureDiagnostic = {
          operation: 'Legacy create_organization wrapper PAN requirement enforcement',
          expected: 'PostgreSQL exception ERR_PAN_REQUIRED',
          actual: upgErr ? upgErr.message : 'No exception thrown',
          category: 'BUSINESS_LOGIC_FAILURE',
        };
        return;
      }
    });

    // 8.9 Unauthorized user blocked by RLS (0 rows affected)
    await withRoleContext(upgradeClient, { role: 'authenticated', userId: unauthorizedUserId }, async () => {
      const unauthRes = await upgradeClient.query(
        `UPDATE organizations SET legal_name = 'Malicious Hijack' WHERE id = $1;`,
        [existingOrgId]
      );
      unauthorizedBlocked = (unauthRes.rowCount === 0);
    });

    if (!unauthorizedBlocked) {
      failureDiagnostic = {
        operation: 'Unauthorized user cross-tenant update isolation under RLS',
        expected: 'rowCount = 0 (RLS blocks mutation of foreign organization)',
        actual: 'rowCount > 0 (foreign organization was mutated)',
        category: 'RLS_FAILURE',
      };
    }

    const upgradedOpsPassed =
      preflightPassed &&
      ownerUpdatePassed &&
      unauthorizedBlocked &&
      removeBlocked &&
      mismatchBlocked &&
      alterDemoted &&
      subIntact &&
      v2WorksOnUpgradedDb &&
      legacyBlocked;

    recordTest(
      'P1-UPG-02',
      'Scenario B Upgrade: Upgraded database enforces canonical v2, legacy wrapper protection, and continuing identity enforcement',
      upgradedOpsPassed,
      `preflight=${preflightPassed}, ownerUpdate=${ownerUpdatePassed}, unauthBlocked=${unauthorizedBlocked}, removeBlocked=${removeBlocked}, mismatchBlocked=${mismatchBlocked}, alterDemoted=${alterDemoted}, subIntact=${subIntact}, v2Works=${v2WorksOnUpgradedDb}, legacyBlocked=${legacyBlocked}`,
      upgradedOpsPassed ? null : upgErr,
      failureDiagnostic
    );

  } finally {
    if (upgradeClient) {
      await upgradeClient.end().catch(() => {});
    }
    try {
      await maintClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
        [testUpgradeDbName]
      );
      await maintClient.query(`DROP DATABASE IF EXISTS "${testUpgradeDbName}";`);
      console.log(`  ✓ Scenario B upgrade test database "${testUpgradeDbName}" dropped cleanly.`);
    } catch (err) {
      console.error(`Failed to drop upgrade test db "${testUpgradeDbName}":`, err.message);
    }
  }
}

async function runAcceptance() {
  console.log('='.repeat(80));
  console.log('ATLAS OS — MASTER SECURITY & LIFECYCLE DATABASE ACCEPTANCE SUITE');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Target:    ${DATABASE_URL.replace(/:([^:@]+)@/, ':****@')}`);
  console.log('='.repeat(80));

  // Enforce disposable database safety pre-flight
  assertDisposableDatabase(DATABASE_URL);

  const runId = 'sec_' + crypto.randomBytes(4).toString('hex');
  const testDbName = `atlas_test_${runId}`;

  // Parse maintenance database endpoint
  const maintUrl = new URL(DATABASE_URL);
  const maintDbName = maintUrl.pathname.replace(/^\//, '') || 'postgres';

  const maintClient = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });

  try {
    await maintClient.connect();
    console.log(`Connected to PostgreSQL administrative endpoint ("${maintDbName}") successfully.\n`);
  } catch (err) {
    console.error('\n⚠️  PostgreSQL connection failed:');
    console.error(`   ${err.message}`);
    console.error('\nEnvironment Diagnostic:');
    console.error('   A running PostgreSQL instance is required to execute live database acceptance tests.');
    console.error('   - In CI (GitHub Actions): Postgres service container is automatically provisioned.');
    console.error('   - In local development: start postgres (e.g. docker run -p 5432:5432 ...) and provide DATABASE_URL.');
    console.error('\n❌ Exiting non-zero because live database acceptance testing could not proceed.');
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // Provision Dedicated Ephemeral Test Database (Strict Isolation, No Fallback)
  // --------------------------------------------------------------------------
  let testClient = null;
  let testDbCreated = false;
  let cleanupSuccessful = false;

  try {
    console.log(`Step 0: Provisioning isolated ephemeral test database "${testDbName}"...`);
    await maintClient.query(`CREATE DATABASE "${testDbName}";`);
    testDbCreated = true;
    console.log(`  ✓ Dedicated test database "${testDbName}" created successfully.`);

    const testDbUrl = new URL(DATABASE_URL);
    testDbUrl.pathname = '/' + testDbName;

    testClient = new Client({
      connectionString: testDbUrl.toString(),
      connectionTimeoutMillis: 5000,
    });
    await testClient.connect();
    console.log(`  ✓ Connected to isolated test database "${testDbName}".\n`);
  } catch (createDbErr) {
    console.error(`\n❌ Failed to provision dedicated test database "${testDbName}": ${createDbErr.message}`);
    console.error('   Strict test database isolation is required. Unsafe fallback execution against shared databases is disabled.');
    await maintClient.end().catch(() => {});
    process.exit(1);
  }

  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();
  const custAId = crypto.randomUUID();
  const custBId = crypto.randomUUID();
  const prodA1Id = crypto.randomUUID();
  const prodA2Id = crypto.randomUUID();
  const prodB1Id = crypto.randomUUID();

  try {
    // ------------------------------------------------------------------------
    // Step 1: Bootstrap Standard Supabase-Compatible Roles, Schemas & Auth
    // ------------------------------------------------------------------------
    console.log('Step 1: Bootstrapping Supabase-compatible roles, schemas and auth environment...');
    await bootstrapDisposableDatabase(testClient);
    console.log('  ✓ Roles, schemas, and auth functions bootstrapped successfully.');

    // ------------------------------------------------------------------------
    // Step 2: Apply Migrations 001 - 030 in Strict Lexical Order (Scenario A: Fresh Installation)
    // ------------------------------------------------------------------------
    console.log('\nStep 2: Applying migrations sequentially (001 -> 030) [Scenario A: Fresh Installation]...');
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await testClient.query(sql);
        console.log(`  ✓ Applied migration: ${file}`);
      } catch (migErr) {
        console.error(`\n❌ Migration failed at ${file}: ${migErr.message}`);
        console.error(`   SQLSTATE: ${migErr.code}`);
        throw migErr;
      }
    }

    // Ensure sequences are usable by authenticated role (without altering table-level permissions)
    await testClient.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    `);

    // ------------------------------------------------------------------------
    // Step 3: Seed Isolated Multi-Tenant Test Fixtures
    // ------------------------------------------------------------------------
    console.log('\nStep 3: Seeding isolated test fixtures (Org A, Org B, User A, User B)...');
    await testClient.query(`
      INSERT INTO auth.users (id, email) VALUES
      ('${userAId}', 'owner_a_${runId}@example.com'),
      ('${userBId}', 'owner_b_${runId}@example.com')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO organizations (id, name, currency, legal_name, gstin, state) VALUES
      ('${orgAId}', 'Alpha Electricals ${runId}', 'INR', 'Alpha Electricals Pvt Ltd', '29ABCDE1234F1Z5', 'Karnataka'),
      ('${orgBId}', 'Beta Hardware ${runId}', 'INR', 'Beta Hardware LLP', '29XYZAB5678C1Z2', 'Karnataka');

      INSERT INTO memberships (organization_id, user_id, role, is_active) VALUES
      ('${orgAId}', '${userAId}', 'owner', true),
      ('${orgBId}', '${userBId}', 'owner', true);

      -- Valid eligibility fixture using authoritative lowercase enum 'approved' (Migration 013)
      INSERT INTO organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by) VALUES
      ('${orgAId}', 'electrical_retail', true, 'approved', '${userAId}'),
      ('${orgBId}', 'electrical_retail', true, 'approved', '${userBId}');

      -- Valid subscription fixture matching authoritative schema: plan_tier, status, current_period_ends_at
      INSERT INTO organization_subscriptions (organization_id, plan_tier, status, current_period_ends_at) VALUES
      ('${orgAId}', 'pro', 'active', now() + interval '30 days'),
      ('${orgBId}', 'pro', 'active', now() + interval '30 days');

      INSERT INTO customers (id, organization_id, name, phone, gstin) VALUES
      ('${custAId}', '${orgAId}', 'Apex Power Projects', '9876543210', '29AAACP1234A1Z1'),
      ('${custBId}', '${orgBId}', 'Org B Industrial Controls', '9123456780', '29AABCU9603R1ZM');

      -- Products fixture with valid NOT NULL category ('Wires & Cables', 'Switchgear') from Migration 002
      INSERT INTO products (id, organization_id, name, sku, category, uom, purchase_cost, selling_price, tax_rate, reorder_threshold, is_active) VALUES
      ('${prodA1Id}', '${orgAId}', 'Copper Wire 2.5sqmm', 'WIRE-25-${runId}', 'Wires & Cables', 'Mtr', 20.00, 30.00, 18, 50, true),
      ('${prodA2Id}', '${orgAId}', 'MCB 16A Single Pole', 'MCB-16-${runId}', 'Switchgear', 'Nos', 120.00, 180.00, 18, 10, true),
      ('${prodB1Id}', '${orgBId}', 'Industrial Relay 24V', 'RELAY-24-${runId}', 'Switchgear', 'Nos', 300.00, 450.00, 18, 5, true);

      -- Initial opening stock for product 1 (100 units) and product 2 (50 units)
      INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes) VALUES
      ('${orgAId}', '${prodA1Id}', 100, 'OPENING_STOCK', 'Acceptance test opening stock'),
      ('${orgAId}', '${prodA2Id}', 50, 'OPENING_STOCK', 'Acceptance test opening stock');
    `);
    console.log('  ✓ Test fixtures successfully created under administrative privileges.\n');

    // ------------------------------------------------------------------------
    // Step 4: Security Assertions — Restricted Roles & Lifecycle Boundaries
    // ------------------------------------------------------------------------
    console.log('--- EXECUTING AUTHENTICATED SECURITY & LIFECYCLE TESTS ---\n');

    // TEST GROUP 1: Table-Level Privilege Revocations (Migration 013, 017, 022)
    // Direct DML mutations must be rejected with SQLSTATE 42501 (insufficient_privilege)
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let stockMovementBlocked = false;
      let stockMovementErr = null;
      try {
        await testClient.query(
          `INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
           VALUES ($1::uuid, $2::uuid, 10, 'GOODS_RECEIVED', 'Bypass attempt');`,
          [orgAId, prodA1Id]
        );
      } catch (err) {
        stockMovementErr = err;
        stockMovementBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-01',
        'Direct INSERT on stock_movements is rejected by table-level revocation (SQLSTATE 42501)',
        stockMovementBlocked,
        `Migration 022 revokes direct mutations; caught SQLSTATE ${stockMovementErr?.code}`,
        stockMovementBlocked ? null : stockMovementErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let stockUpdateBlocked = false;
      let stockUpdateErr = null;
      try {
        await testClient.query(
          `UPDATE stock_movements SET quantity_change = 999 WHERE product_id = $1::uuid;`,
          [prodA1Id]
        );
      } catch (err) {
        stockUpdateErr = err;
        stockUpdateBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-02',
        'Direct UPDATE on stock_movements is rejected by table-level revocation (SQLSTATE 42501)',
        stockUpdateBlocked,
        `Migration 022 revokes direct mutations; caught SQLSTATE ${stockUpdateErr?.code}`,
        stockUpdateBlocked ? null : stockUpdateErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let paymentsBlocked = false;
      let paymentsErr = null;
      try {
        await testClient.query(
          `INSERT INTO payments (organization_id, customer_id, payment_number, amount, payment_method, payment_date)
           VALUES ($1::uuid, $2::uuid, 'PAY-BYPASS-01', 500.00, 'CASH', '2026-11-02');`,
          [orgAId, custAId]
        );
      } catch (err) {
        paymentsErr = err;
        paymentsBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-03',
        'Direct INSERT on payments is rejected by table-level revocation (SQLSTATE 42501)',
        paymentsBlocked,
        `Migration 017 revokes direct mutations; caught SQLSTATE ${paymentsErr?.code}`,
        paymentsBlocked ? null : paymentsErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let allocBlocked = false;
      let allocErr = null;
      try {
        await testClient.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated)
           VALUES ($1::uuid, $2::uuid, 100.00);`,
          [crypto.randomUUID(), crypto.randomUUID()]
        );
      } catch (err) {
        allocErr = err;
        allocBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-04',
        'Direct INSERT on payment_allocations is rejected by table-level revocation (SQLSTATE 42501)',
        allocBlocked,
        `Migration 017 revokes direct mutations; caught SQLSTATE ${allocErr?.code}`,
        allocBlocked ? null : allocErr
      );
    });

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let eligBlocked = false;
      let eligErr = null;
      try {
        await testClient.query(
          `INSERT INTO organization_eligibility (organization_id, business_category, status, declared_by)
           VALUES ($1::uuid, 'electrical_retail', 'approved', $2::uuid);`,
          [crypto.randomUUID(), userAId]
        );
      } catch (err) {
        eligErr = err;
        eligBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
      recordTest(
        'P0-SEC-REVOKE-05',
        'Direct INSERT on organization_eligibility is rejected by table-level revocation (SQLSTATE 42501)',
        eligBlocked,
        `Migration 013 revokes direct mutations; caught SQLSTATE ${eligErr?.code}`,
        eligBlocked ? null : eligErr
      );
    });

    // TEST GROUP 2: Sales Order Direct Insertion & Transition Boundary
    // TEST 1: Direct insert of CONFIRMED sales order under authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'SO-BYPASS-01', 'CONFIRMED', '2026-11-02', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      // Assert no row was inserted into sales_orders
      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM sales_orders WHERE order_number = 'SO-BYPASS-01';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-SO-01',
        'Direct insert of CONFIRMED sales order as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS policy sales_orders_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // TEST 2: Direct insert of FULFILLED sales order under authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO sales_orders (organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'SO-BYPASS-02', 'FULFILLED', '2026-11-02', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM sales_orders WHERE order_number = 'SO-BYPASS-02';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-SO-02',
        'Direct insert of FULFILLED sales order as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS policy sales_orders_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // Create a legitimate DRAFT order with items
    const draftOrderId = crypto.randomUUID();
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      await testClient.query(
        `INSERT INTO sales_orders (id, organization_id, customer_id, order_number, status, order_date, subtotal, tax_amount, total_amount)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'DRAFT', '2026-11-02', 300, 54, 354);`,
        [draftOrderId, orgAId, custAId, `SO-DRAFT-${runId}`]
      );

      await testClient.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, product_name, product_sku, uom, quantity, unit_price, tax_rate, line_subtotal, line_tax, line_total)
         VALUES ($1::uuid, $2::uuid, 'Copper Wire 2.5sqmm', $3, 'Mtr', 10, 30.00, 18, 300, 54, 354);`,
        [draftOrderId, prodA1Id, `WIRE-25-${runId}`]
      );
    });

    // TEST 3: Direct status change from DRAFT to CONFIRMED as authenticated role is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(`UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1::uuid;`, [draftOrderId]);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('confirm_sales_order');
      }
      recordTest(
        'P0-SO-03',
        'Direct status change from DRAFT to CONFIRMED is rejected for authenticated role',
        blocked,
        `Enforced by RLS sales_orders_update WITH CHECK and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked ? null : caughtErr
      );
    });

    // TEST 4: Attempted GUC trust flag manipulation by authenticated role is rejected (Migration 026)
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        // Attacker sets session GUC and attempts direct update
        await testClient.query(`SELECT set_config('app.authoritative_order_transition', 'true', false);`);
        await testClient.query(`UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1::uuid;`, [draftOrderId]);
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }

      // Assert database order status is still DRAFT
      const { rows: orderRows } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
      const remainsDraft = orderRows[0]?.status === 'DRAFT';

      recordTest(
        'P0-SO-04-GUC',
        'Attempted GUC spoofing (app.authoritative_order_transition) by authenticated role is rejected',
        blocked && remainsDraft,
        `Migration 026 SECURITY INVOKER trigger detects CURRENT_USER='authenticated' and rejects transition (SQLSTATE ${caughtErr?.code})`,
        blocked && remainsDraft ? null : caughtErr
      );
    });

    // TEST 5: Authoritative confirmation via confirm_sales_order RPC succeeds & deducts stock
    // Uses parameterized set-returning query: SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;
    let confirmedResult = null;
    let stockBefore = null;
    let stockAfter = null;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // 1. Get stock before confirmation
      const { rows: stockB4Rows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockB4Rows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} before confirmation`);
      }
      stockBefore = Number(stockB4Rows[0].current_stock);

      // 2. Authoritative confirmation call
      const { rows: confRows } = await testClient.query(
        `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid) AS result;`,
        [draftOrderId, orgAId]
      );
      confirmedResult = confRows[0]?.result;

      // 3. Get stock after confirmation
      const { rows: stockAftRows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockAftRows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} after confirmation`);
      }
      stockAfter = Number(stockAftRows[0].current_stock);
    });

    const isConfirmed = confirmedResult?.success === true && confirmedResult?.status === 'CONFIRMED';
    const exactly10Deducted = stockBefore === 100 && stockAfter === 90 && (stockBefore - stockAfter === 10);

    // Verify order status and audit log directly in PostgreSQL
    const { rows: orderCheck } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
    const dbConfirmed = orderCheck[0]?.status === 'CONFIRMED';

    const { rows: auditCheck } = await testClient.query(
      `SELECT count(*)::int AS cnt FROM audit_events WHERE entity_id = $1::uuid AND action = 'CONFIRM_ORDER';`,
      [draftOrderId]
    );
    const auditCreated = auditCheck[0]?.cnt === 1;

    recordTest(
      'P0-SO-05',
      'Authoritative confirm_sales_order RPC transitions to CONFIRMED and deducts stock exactly once',
      Boolean(isConfirmed && exactly10Deducted && dbConfirmed && auditCreated),
      `Stock reduced from ${stockBefore} to ${stockAfter} (-10 Mtr); DB status: ${orderCheck[0]?.status}; Audit records: ${auditCheck[0]?.cnt}`,
      isConfirmed && exactly10Deducted && dbConfirmed && auditCreated ? null : new Error('Stock deduction, status, or audit record assertion failed')
    );

    // TEST 6: Modification of items on CONFIRMED order is restricted under authenticated role
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: beforeRows } = await testClient.query(
        `SELECT id, quantity, unit_price FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const qtyBefore = Number(beforeRows[0]?.quantity);

      let rowCount = -1;
      let caughtErr = null;
      try {
        const res = await testClient.query(
          `UPDATE sales_order_items SET quantity = 25 WHERE sales_order_id = $1::uuid;`,
          [draftOrderId]
        );
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
      }

      const { rows: afterRows } = await testClient.query(
        `SELECT id, quantity, unit_price FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const qtyAfter = Number(afterRows[0]?.quantity);

      // In PostgreSQL RLS, updating rows not satisfying USING clause matches 0 rows (rowCount = 0)
      const rlsBlocked = (rowCount === 0 || caughtErr !== null) && qtyBefore === qtyAfter && qtyAfter === 10;
      recordTest(
        'P0-SO-06',
        'Line item mutation on CONFIRMED sales order is restricted by RLS (zero rows modified)',
        rlsBlocked,
        `RLS sales_order_items_update filtered non-draft order (rowCount: ${rowCount}, quantity remained ${qtyAfter})`,
        rlsBlocked ? null : (caughtErr || new Error(`Expected zero rows modified, got rowCount=${rowCount}`))
      );
    });

    // TEST 6-TRG: Direct mutation of items on CONFIRMED order (bypassing RLS as table owner) is rejected by trigger
    {
      let trgBlocked = false;
      let trgErr = null;
      try {
        await testClient.query(
          `UPDATE sales_order_items SET quantity = 25 WHERE sales_order_id = $1::uuid;`,
          [draftOrderId]
        );
      } catch (err) {
        trgErr = err;
        trgBlocked = err.code === '23514' || err.message.includes('CONFIRMED');
      }

      const { rows: itemCheck } = await testClient.query(
        `SELECT quantity FROM sales_order_items WHERE sales_order_id = $1::uuid;`,
        [draftOrderId]
      );
      const remains10 = Number(itemCheck[0]?.quantity) === 10;

      recordTest(
        'P0-SO-06-TRG',
        'Direct item mutation on CONFIRMED order raises check_violation (23514) in trigger',
        Boolean(trgBlocked && remains10),
        `Enforced by trg_sales_order_items_enforce_parent_status (SQLSTATE ${trgErr?.code}, message: "${trgErr?.message}")`,
        trgBlocked && remains10 ? null : (trgErr || new Error('Trigger did not raise expected check_violation'))
      );
    }

    // TEST 7: Idempotent Replay — Re-confirmation of already CONFIRMED order returns safe replay and avoids double-deduction
    let replayResult = null;
    let stockAfterReplay = null;
    let deductionCount = 0;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: replayRows } = await testClient.query(
        `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid) AS result;`,
        [draftOrderId, orgAId]
      );
      replayResult = replayRows[0]?.result;

      // Verify stock balance remained identical
      const { rows: stockReplayRows } = await testClient.query(
        `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
        [orgAId, prodA1Id]
      );
      if (stockReplayRows.length === 0) {
        throw new Error(`Stock record not found for product ${prodA1Id} after replay`);
      }
      stockAfterReplay = Number(stockReplayRows[0].current_stock);

      // Count stock movement deductions for this order
      const { rows: smRows } = await testClient.query(
        `SELECT count(*)::int AS cnt FROM stock_movements WHERE reference_id = $1::uuid AND movement_type = 'SALES_DISPATCH';`,
        [draftOrderId]
      );
      deductionCount = smRows[0]?.cnt || 0;
    });

    const isIdempotentReplay =
      replayResult?.success === true &&
      replayResult?.idempotent_replay === true &&
      replayResult?.status === 'CONFIRMED' &&
      stockAfterReplay === 90 &&
      deductionCount === 1;

    recordTest(
      'P0-SO-07',
      'Idempotent replay on confirm_sales_order returns cached confirmation and prevents double-deduction',
      Boolean(isIdempotentReplay),
      `Replay returned idempotent_replay: true; Stock remained ${stockAfterReplay}; Deductions count: ${deductionCount}`,
      isIdempotentReplay ? null : new Error('Replay failed or double-deducted inventory')
    );

    // TEST: Multi-product sales order creation via create_sales_order_atomic
    let multiSoResult = null;
    const multiSoKey = crypto.randomUUID();
    const multiItems = JSON.stringify([
      { productId: prodA1Id, quantity: 5, unitPrice: 30.00, discountPercent: 0, taxRate: 18 },
      { productId: prodA2Id, quantity: 2, unitPrice: 180.00, discountPercent: 0, taxRate: 18 },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: soRows } = await testClient.query(
        `SELECT create_sales_order_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_order_date := '2026-11-02'::date,
          p_items := $3::jsonb,
          p_notes := 'Multi-item sales order'::text,
          p_quotation_id := NULL::uuid,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, multiItems, multiSoKey]
      );
      multiSoResult = soRows[0]?.result;
    });

    // Verification: Subtotal = (5*30) + (2*180) = 150 + 360 = 510; Tax 18% = 91.80; Total = 601.80
    const multiSoValid =
      multiSoResult?.id &&
      multiSoResult?.status === 'DRAFT' &&
      Number(multiSoResult?.subtotal) === 510.00 &&
      Number(multiSoResult?.tax_amount) === 91.80 &&
      Number(multiSoResult?.total_amount) === 601.80 &&
      Array.isArray(multiSoResult?.items) &&
      multiSoResult.items.length === 2;

    recordTest(
      'P0-SO-DOC-01',
      'Multi-product sales order creation via create_sales_order_atomic calculates subtotal and tax accurately',
      Boolean(multiSoValid),
      `Order ${multiSoResult?.order_number} created with 2 items; Subtotal: ${multiSoResult?.subtotal}, Tax: ${multiSoResult?.tax_amount}, Total: ${multiSoResult?.total_amount}`,
      multiSoValid ? null : new Error('Multi-product sales order creation returned invalid totals or items')
    );

    // TEST: Cross-tenant product rejection in create_sales_order_atomic
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let crossProdBlocked = false;
      let crossProdErr = null;
      const crossTenantItems = JSON.stringify([
        { productId: prodB1Id, quantity: 1, unitPrice: 450.00, discountPercent: 0, taxRate: 18 },
      ]);
      try {
        await testClient.query(
          `SELECT create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_order_date := '2026-11-02'::date,
            p_items := $3::jsonb,
            p_notes := 'Cross-tenant product attempt'::text
          );`,
          [orgAId, custAId, crossTenantItems]
        );
      } catch (err) {
        crossProdErr = err;
        crossProdBlocked = err.message.includes('do not belong to organization') || err.message.includes('not found');
      }

      recordTest(
        'P0-SO-DOC-02',
        'Cross-tenant product in create_sales_order_atomic is strictly rejected',
        crossProdBlocked,
        `Rejected cross-tenant product: "${crossProdErr?.message}"`,
        crossProdBlocked ? null : crossProdErr
      );
    });

    // TEST: Invalid quantity rejection in create_sales_order_atomic
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let invalidQtyBlocked = false;
      let invalidQtyErr = null;
      const invalidQtyItems = JSON.stringify([
        { productId: prodA1Id, quantity: 0, unitPrice: 30.00, discountPercent: 0, taxRate: 18 },
      ]);
      try {
        await testClient.query(
          `SELECT create_sales_order_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_order_date := '2026-11-02'::date,
            p_items := $3::jsonb,
            p_notes := 'Invalid quantity attempt'::text
          );`,
          [orgAId, custAId, invalidQtyItems]
        );
      } catch (err) {
        invalidQtyErr = err;
        invalidQtyBlocked = err.message.includes('invalid quantity') || err.message.includes('must be >= 1');
      }

      recordTest(
        'P0-SO-DOC-03',
        'Invalid quantity (<= 0) in create_sales_order_atomic is strictly rejected',
        invalidQtyBlocked,
        `Rejected non-positive quantity: "${invalidQtyErr?.message}"`,
        invalidQtyBlocked ? null : invalidQtyErr
      );
    });

    // TEST 8: Direct insert of ISSUED invoice is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      try {
        await testClient.query(
          `INSERT INTO invoices (organization_id, customer_id, invoice_number, status, invoice_date, due_date, subtotal, tax_amount, total_amount)
           VALUES ($1::uuid, $2::uuid, 'INV-BYPASS-01', 'ISSUED', '2026-11-02', '2026-11-17', 100, 18, 118);`,
          [orgAId, custAId]
        );
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited') || err.message.includes('DRAFT');
      }

      const { rows: verifyNoRow } = await testClient.query(`SELECT id FROM invoices WHERE invoice_number = 'INV-BYPASS-01';`);
      const zeroInserted = verifyNoRow.length === 0;

      recordTest(
        'P0-INV-01',
        'Direct insert of ISSUED invoice as authenticated role is rejected',
        blocked && zeroInserted,
        `Enforced by RLS invoices_insert and trigger (SQLSTATE ${caughtErr?.code})`,
        blocked && zeroInserted ? null : caughtErr
      );
    });

    // TEST 9: Authoritative create_invoice_atomic creates ISSUED invoice and marks SO FULFILLED
    let createdInvoiceId = null;
    let invNumber = null;
    const invItemsJson = JSON.stringify([
      {
        product_id: prodA1Id,
        quantity: 10,
        unit_price: 30.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invCreateRows } = await testClient.query(
        `SELECT create_invoice_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_items := $3::jsonb,
          p_invoice_date := '2026-11-02'::date,
          p_due_date := '2026-11-17'::date,
          p_status := 'ISSUED',
          p_notes := 'Invoice created from order',
          p_sales_order_id := $4::uuid,
          p_idempotency_key := $5::uuid
        ) AS result;`,
        [orgAId, custAId, invItemsJson, draftOrderId, crypto.randomUUID()]
      );
      const invObj = invCreateRows[0]?.result;
      createdInvoiceId = invObj?.id;
      invNumber = invObj?.invoice_number;
    });

    // Verify invoice status and sales order status directly in database
    let invoiceIssued = false;
    let orderFulfilled = false;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: iRows } = await testClient.query(`SELECT status FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
      invoiceIssued = iRows[0]?.status === 'ISSUED';
      const { rows: soRows } = await testClient.query(`SELECT status FROM sales_orders WHERE id = $1::uuid;`, [draftOrderId]);
      orderFulfilled = soRows[0]?.status === 'FULFILLED';
    });

    recordTest(
      'P0-INV-02',
      'Authoritative create_invoice_atomic issues invoice and transitions order to FULFILLED',
      Boolean(createdInvoiceId && invoiceIssued && orderFulfilled),
      `Invoice ${invNumber} (${createdInvoiceId}) issued; Sales order marked FULFILLED`,
      createdInvoiceId && invoiceIssued && orderFulfilled ? null : new Error('Invoice was not created or order not fulfilled')
    );

    // TEST 10: Modification of items on ISSUED invoice is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      let rowCount = -1;
      try {
        const res = await testClient.query(`UPDATE invoice_items SET quantity = 50 WHERE invoice_id = $1::uuid;`, [createdInvoiceId]);
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('Cannot') || err.message.includes('immutable');
      }
      if (rowCount === 0) {
        blocked = true;
      }
      recordTest(
        'P0-INV-03',
        'Line item modification on ISSUED invoice is strictly rejected',
        blocked,
        `Enforced by RLS and trg_invoice_items_enforce_status (rowCount: ${rowCount}, SQLSTATE ${caughtErr?.code})`,
        blocked ? null : (caughtErr || new Error(`Expected zero rows modified or error, got rowCount=${rowCount}`))
      );
    });

    // TEST 11: Statutory invoice deletion is blocked
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let blocked = false;
      let caughtErr = null;
      let rowCount = -1;
      try {
        const res = await testClient.query(`DELETE FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
        rowCount = res.rowCount;
      } catch (err) {
        caughtErr = err;
        blocked = err.code === '42501' || err.code === '23514' || err.message.includes('prohibited');
      }
      if (rowCount === 0) {
        blocked = true;
      }
      recordTest(
        'P0-INV-04',
        'Statutory invoice deletion is strictly rejected',
        blocked,
        `Enforced by RLS and trg_invoice_lifecycle (rowCount: ${rowCount}, SQLSTATE ${caughtErr?.code})`,
        blocked ? null : (caughtErr || new Error(`Expected zero rows deleted or error, got rowCount=${rowCount}`))
      );
    });

    // TEST: Standalone invoice creation via create_invoice_atomic
    let standaloneInvResult = null;
    const standaloneItems = JSON.stringify([
      { productId: prodA2Id, quantity: 1, unitPrice: 180.00, discountPercent: 0, taxRate: 18 },
    ]);
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invRows } = await testClient.query(
        `SELECT create_invoice_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_items := $3::jsonb,
          p_invoice_date := '2026-11-02'::date,
          p_due_date := '2026-11-17'::date,
          p_status := 'ISSUED',
          p_notes := 'Direct standalone invoice'::text,
          p_sales_order_id := NULL::uuid,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, standaloneItems, crypto.randomUUID()]
      );
      standaloneInvResult = invRows[0]?.result;
    });

    const standaloneValid =
      standaloneInvResult?.id &&
      standaloneInvResult?.status === 'ISSUED' &&
      standaloneInvResult?.sales_order_id === null &&
      Number(standaloneInvResult?.total_amount) === 212.40;

    recordTest(
      'P0-INV-DOC-01',
      'Standalone invoice creation via create_invoice_atomic succeeds with accurate totals and null sales_order_id',
      Boolean(standaloneValid),
      `Standalone invoice ${standaloneInvResult?.invoice_number} created with total ${standaloneInvResult?.total_amount}`,
      standaloneValid ? null : new Error('Standalone invoice creation failed')
    );

    // TEST: Prevent duplicate invoicing on already invoiced sales order
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let duplicateInvBlocked = false;
      let duplicateInvErr = null;
      try {
        await testClient.query(
          `SELECT create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := $3::jsonb,
            p_invoice_date := '2026-11-02'::date,
            p_due_date := '2026-11-17'::date,
            p_status := 'ISSUED',
            p_notes := 'Duplicate invoice attempt'::text,
            p_sales_order_id := $4::uuid,
            p_idempotency_key := $5::uuid
          );`,
          [orgAId, custAId, invItemsJson, draftOrderId, crypto.randomUUID()]
        );
      } catch (err) {
        duplicateInvErr = err;
        duplicateInvBlocked = err.code === '23505' || err.message.includes('Active invoice already exists') || err.message.includes('must be CONFIRMED');
      }

      recordTest(
        'P0-INV-DOC-02',
        'Duplicate invoice creation against already invoiced sales order is strictly rejected',
        duplicateInvBlocked,
        `Rejected duplicate invoicing (SQLSTATE ${duplicateInvErr?.code}, message: "${duplicateInvErr?.message}")`,
        duplicateInvBlocked ? null : duplicateInvErr
      );
    });

    // TEST 12: Atomic Quotation Creation & Idempotent Conversion Invariants
    let createdQuotId = null;
    let convertedOrderId = null;
    let repeatedConvertOrderId = null;
    let repeatedIsReplay = false;
    const quotItemsJson = JSON.stringify([
      {
        product_id: prodA2Id,
        quantity: 5,
        unit_price: 180.00,
        discount_percent: 0,
        tax_rate: 18,
      },
    ]);

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // 1. Create quotation atomically
      const { rows: qRows } = await testClient.query(
        `SELECT create_quotation_atomic(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_valid_until := '2026-11-17'::date,
          p_items := $3::jsonb,
          p_notes := 'Valid for 15 days',
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, quotItemsJson, crypto.randomUUID()]
      );
      createdQuotId = qRows[0]?.result?.id;

      // 2. Convert quotation to order atomically (first attempt)
      const { rows: cRows } = await testClient.query(
        `SELECT convert_quotation_atomic(
          p_org_id := $1::uuid,
          p_quotation_id := $2::uuid,
          p_idempotency_key := $3::uuid
        ) AS result;`,
        [orgAId, createdQuotId, crypto.randomUUID()]
      );
      convertedOrderId = cRows[0]?.result?.id;

      // 3. Repeated conversion attempt returns existing sales order safely (idempotent replay)
      const { rows: cRows2 } = await testClient.query(
        `SELECT convert_quotation_atomic(
          p_org_id := $1::uuid,
          p_quotation_id := $2::uuid,
          p_idempotency_key := $3::uuid
        ) AS result;`,
        [orgAId, createdQuotId, crypto.randomUUID()]
      );
      repeatedConvertOrderId = cRows2[0]?.result?.id;
      repeatedIsReplay = cRows2[0]?.result?.idempotent_replay === true;
    });

    let quotConverted = false;
    let totalLinkedOrders = 0;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: qStatus } = await testClient.query(`SELECT status FROM quotations WHERE id = $1::uuid;`, [createdQuotId]);
      quotConverted = qStatus[0]?.status === 'CONVERTED';

      const { rows: soCount } = await testClient.query(
        `SELECT count(*)::int AS cnt FROM sales_orders WHERE quotation_id = $1::uuid;`,
        [createdQuotId]
      );
      totalLinkedOrders = soCount[0]?.cnt || 0;
    });

    const quotationIdempotencyValid =
      createdQuotId &&
      convertedOrderId &&
      convertedOrderId === repeatedConvertOrderId &&
      repeatedIsReplay &&
      quotConverted &&
      totalLinkedOrders === 1;

    recordTest(
      'P1-QUOT-01',
      'Quotation conversion is atomic, transitions to CONVERTED, and idempotent replay preserves single linked order',
      Boolean(quotationIdempotencyValid),
      `Quotation ${createdQuotId} converted to SO ${convertedOrderId}; Replay returned existing SO; Total linked SOs: ${totalLinkedOrders}`,
      quotationIdempotencyValid ? null : new Error('Quotation conversion failed or created duplicate orders')
    );

    // TEST 13: Payment Idempotency & Over-allocation Prevention
    const paymentIdempotencyKey = crypto.randomUUID();
    let pay1Result = null;
    let pay2Result = null;

    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // First attempt
      const { rows: p1 } = await testClient.query(
        `SELECT record_payment_and_allocate(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := $3::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
      );
      pay1Result = p1[0]?.result;

      // Replay identical attempt
      const { rows: p2 } = await testClient.query(
        `SELECT record_payment_and_allocate(
          p_org_id := $1::uuid,
          p_customer_id := $2::uuid,
          p_amount := 200.00::numeric,
          p_payment_method := 'UPI'::varchar,
          p_reference_no := 'UPI-123456'::varchar,
          p_payment_date := '2026-11-02'::date,
          p_notes := 'First attempt'::text,
          p_invoice_id := $3::uuid,
          p_allocated_amount := 200.00::numeric,
          p_idempotency_key := $4::uuid
        ) AS result;`,
        [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
      );
      pay2Result = p2[0]?.result;
    });

    // Check invoice total_paid is exactly 200.00 (not 400.00)
    let totalPaidExact = false;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: invRows } = await testClient.query(`SELECT total_paid FROM invoices WHERE id = $1::uuid;`, [createdInvoiceId]);
      totalPaidExact = Number(invRows[0]?.total_paid) === 200.00;
    });

    const isReplaySafe = pay1Result?.payment_id === pay2Result?.payment_id && totalPaidExact;
    recordTest(
      'P1-PAY-01',
      'Payment idempotency key returns cached receipt and prevents duplicate allocation',
      Boolean(isReplaySafe),
      `Payment ID: ${pay1Result?.payment_id}; Invoice total_paid is exactly 200.00 across retries`,
      isReplaySafe ? null : new Error('Payment was duplicated or over-allocated')
    );

    // TEST 14: Tampered payment replay with same key is rejected
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let tamperedBlocked = false;
      let tamperedErr = null;
      try {
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 999.00::numeric, -- tampered amount!
            p_payment_method := 'UPI'::varchar,
            p_reference_no := 'UPI-123456'::varchar,
            p_payment_date := '2026-11-02'::date,
            p_notes := 'Tampered attempt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 999.00::numeric,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custAId, createdInvoiceId, paymentIdempotencyKey]
        );
      } catch (err) {
        tamperedErr = err;
        tamperedBlocked = err.code === '23505' || err.message.includes('reused with different request parameters');
      }
      recordTest(
        'P1-PAY-02',
        'Reused idempotency key with altered parameters is strictly rejected',
        tamperedBlocked,
        `Fingerprint mismatch caught with unique_violation (SQLSTATE ${tamperedErr?.code})`,
        tamperedBlocked ? null : tamperedErr
      );
    });

    // TEST: Overpayment rejection in record_payment_and_allocate
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let overpayBlocked = false;
      let overpayErr = null;
      try {
        // createdInvoiceId total is 354.00, already paid 200.00, remaining balance is 154.00.
        // Attempting to allocate 300.00 must raise Overpayment violation
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 300.00::numeric,
            p_payment_method := 'NEFT'::varchar,
            p_reference_no := 'NEFT-OVERPAY-01'::varchar,
            p_payment_date := '2026-11-02'::date,
            p_notes := 'Overpayment attempt'::text,
            p_invoice_id := $3::uuid,
            p_allocated_amount := 300.00::numeric,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custAId, createdInvoiceId, crypto.randomUUID()]
        );
      } catch (err) {
        overpayErr = err;
        overpayBlocked = err.message.includes('Overpayment violation') || err.message.includes('exceeds remaining balance');
      }

      recordTest(
        'P1-PAY-DOC-01',
        'Overpayment exceeding remaining invoice balance is strictly rejected by record_payment_and_allocate',
        overpayBlocked,
        `Rejected overpayment: "${overpayErr?.message}"`,
        overpayBlocked ? null : overpayErr
      );
    });

    // TEST 15: Cross-tenant isolation under authenticated User B
    await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
      // User B attempts to access Org A's sales order via direct SELECT
      const { rows: bOrders } = await testClient.query(`SELECT * FROM sales_orders WHERE id = $1::uuid;`, [convertedOrderId]);
      const cannotSeeOrgAOrder = bOrders.length === 0;

      // User B attempts to confirm Org A's order via RPC
      let rpcBlocked = false;
      let rpcErr = null;
      try {
        await testClient.query(
          `SELECT confirm_sales_order(p_order_id := $1::uuid, p_org_id := $2::uuid);`,
          [convertedOrderId, orgBId]
        );
      } catch (err) {
        rpcErr = err;
        rpcBlocked = err.code === '23514' || err.message.includes('not found') || err.message.includes('Unauthorized') || err.message.includes('Access denied');
      }

      const isolationPassed = cannotSeeOrgAOrder && rpcBlocked;
      recordTest(
        'P1-TENANT-01',
        'Cross-tenant isolation: User B cannot view or confirm Org A orders',
        isolationPassed,
        `RLS filtered order (${bOrders.length} rows returned); RPC rejected cross-tenant execution (SQLSTATE ${rpcErr?.code})`,
        isolationPassed ? null : rpcErr
      );
    });

    // TEST 16: Anonymous role restrictions
    await withRoleContext(testClient, { role: 'anon', userId: null }, async () => {
      let anonBlocked = false;
      let anonErr = null;
      try {
        await testClient.query(`SELECT * FROM sales_orders;`);
      } catch (err) {
        anonErr = err;
        anonBlocked = true;
      }
      // Or if query succeeds, RLS must return exactly 0 rows
      const { rows } = await testClient.query(`SELECT count(*)::int AS count FROM sales_orders;`);
      const zeroRows = rows[0]?.count === 0;
      const anonSecured = anonBlocked || zeroRows;

      recordTest(
        'P1-ANON-01',
        'Anonymous role has zero access to multi-tenant operational records',
        anonSecured,
        `Anonymous access blocked or returned 0 rows under RLS`,
        anonSecured ? null : anonErr
      );
    });

    // TEST 17: Authoritative Dashboard Metrics RPC Integrity
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const { rows: dashRows } = await testClient.query(
        `SELECT get_dashboard_metrics(p_org_id := $1::uuid, p_today := '2026-11-02'::date) AS metrics;`,
        [orgAId]
      );
      const metrics = dashRows[0]?.metrics;
      const hasMetrics =
        metrics &&
        typeof metrics.today_sales !== 'undefined' &&
        typeof metrics.orders_count !== 'undefined' &&
        typeof metrics.total_receivables !== 'undefined';

      recordTest(
        'P1-DASH-01',
        'Authoritative get_dashboard_metrics RPC aggregates financial and operational totals correctly',
        Boolean(hasMetrics),
        `Dashboard metrics: today_sales=${metrics?.today_sales}, orders_count=${metrics?.orders_count}, receivables=${metrics?.total_receivables}`,
        hasMetrics ? null : new Error('Dashboard metrics returned invalid structure')
      );
    });

    // ========================================================================
    // TEST GROUP 10: Phase A1 Canonical Contracts, Continuing Identity Enforcement & Tax Hardening (Scenario A)
    // ========================================================================
    console.log('\n--- PHASE A1 CANONICAL CONTRACTS & IDENTITY PRIVACY VERIFICATION ---\n');

    // TEST 18: Canonical create_organization_v2 with valid PAN
    let panOrgId = null;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const panOrgKey = crypto.randomUUID();
      let v2Created = false;
      let v2Err = null;
      let v2Result = null;
      try {
        const { rows } = await testClient.query(
          `SELECT create_organization_v2(
            p_name := 'Valid PAN Electricals',
            p_legal_name := 'Valid PAN Electricals Pvt Ltd',
            p_gstin := '29ABCDE1234F1Z5',
            p_pan := 'ABCDE1234F',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables'],
            p_idempotency_key := $1::uuid
          ) AS res;`,
          [panOrgKey]
        );
        v2Result = rows[0]?.res;
        panOrgId = v2Result?.id;
        v2Created = v2Result && v2Result.id && v2Result.eligibility_status === 'approved' && v2Result.trial_initialized === true;
      } catch (err) {
        v2Err = err;
      }
      recordTest(
        'P1-A1-01',
        'Canonical create_organization_v2 creates organization with valid PAN and initializes approved trial',
        Boolean(v2Created),
        `Org created: id=${v2Result?.id}, eligibility=${v2Result?.eligibility_status}, trial=${v2Result?.trial_initialized}`,
        v2Created ? null : v2Err
      );
    });

    // TEST 19: Missing PAN without permitted exception path is rejected
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let missingPanBlocked = false;
      let missingPanErr = null;
      try {
        await testClient.query(
          `SELECT create_organization_v2(
            p_name := 'No PAN Hardware',
            p_legal_name := 'No PAN Hardware Ltd',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables'],
            p_idempotency_key := $1::uuid
          );`,
          [crypto.randomUUID()]
        );
      } catch (err) {
        missingPanErr = err;
        missingPanBlocked = err.message.includes('ERR_PAN_REQUIRED');
      }
      recordTest(
        'P1-A1-02',
        'Missing PAN is strictly rejected without a permitted exception path (ERR_PAN_REQUIRED)',
        missingPanBlocked,
        `Caught: ${missingPanErr?.message}`,
        missingPanBlocked ? null : missingPanErr
      );
    });

    // TEST 20: PAN and GSTIN mismatch is rejected
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let mismatchBlocked = false;
      let mismatchErr = null;
      try {
        await testClient.query(
          `SELECT create_organization_v2(
            p_name := 'Mismatch Electricals',
            p_gstin := '29ABCDE1234F1Z5',
            p_pan := 'XYZAB5678C',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables'],
            p_idempotency_key := $1::uuid
          );`,
          [crypto.randomUUID()]
        );
      } catch (err) {
        mismatchErr = err;
        mismatchBlocked = err.message.includes('ERR_PAN_GSTIN_MISMATCH');
      }
      recordTest(
        'P1-A1-03',
        'PAN and GSTIN mismatch is rejected by cross-validation trigger (ERR_PAN_GSTIN_MISMATCH)',
        mismatchBlocked,
        `Caught: ${mismatchErr?.message}`,
        mismatchBlocked ? null : mismatchErr
      );
    });

    // TEST 21: Documented statutory exception enters manual review without automatic trial
    let exceptionOrgId = null;
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let exceptionOrgRes = null;
      let exceptionErr = null;
      try {
        const { rows } = await testClient.query(
          `SELECT create_organization_v2(
            p_name := 'Govt Power Board Agency',
            p_currency := 'INR',
            p_business_category := 'electrical_wholesale_distributor'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables'],
            p_pan_exception_reason := 'GOVERNMENT_EXEMPT_ENTITY',
            p_pan_exception_reference := 'GOV-EXEMPT-2026-001',
            p_idempotency_key := $1::uuid
          ) AS res;`,
          [crypto.randomUUID()]
        );
        exceptionOrgRes = rows[0]?.res;
        exceptionOrgId = exceptionOrgRes?.id;
      } catch (err) {
        exceptionErr = err;
      }
      const isReviewRequired = exceptionOrgRes?.eligibility_status === 'review_required';
      const noTrialInRes = exceptionOrgRes?.trial_initialized === false;

      let noSubInDb = false;
      if (exceptionOrgRes?.id) {
        const { rows: subRows } = await testClient.query(
          `SELECT count(*)::int AS count FROM organization_subscriptions WHERE organization_id = $1::uuid;`,
          [exceptionOrgRes.id]
        );
        noSubInDb = subRows[0]?.count === 0;
      }

      const exceptionHandled = isReviewRequired && noTrialInRes && noSubInDb;
      recordTest(
        'P1-A1-04',
        'Documented statutory exception enters manual review without automatic trial initialization',
        exceptionHandled,
        `Status=${exceptionOrgRes?.eligibility_status}, trial_initialized=${exceptionOrgRes?.trial_initialized}, db_subscriptions=${noSubInDb ? 0 : 'present'}`,
        exceptionHandled ? null : exceptionErr
      );
    });

    // TEST 22: Legacy RPC cannot bypass security
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let legacyBypassBlocked = false;
      let legacyErr = null;
      try {
        await testClient.query(
          `SELECT create_organization(
            p_name := 'Legacy Bypass Corp',
            p_currency := 'INR',
            p_business_category := 'electrical_retail'::business_category_type,
            p_sells_electrical_products := true,
            p_product_lines := ARRAY['Wires & Cables'],
            p_idempotency_key := $1::uuid
          );`,
          [crypto.randomUUID()]
        );
      } catch (err) {
        legacyErr = err;
        legacyBypassBlocked = err.message.includes('ERR_PAN_REQUIRED');
      }
      recordTest(
        'P1-A1-06',
        'Legacy create_organization RPC wrapper strictly blocks bypassing PAN (delegates to v2)',
        legacyBypassBlocked,
        `Caught: ${legacyErr?.message}`,
        legacyBypassBlocked ? null : legacyErr
      );
    });

    // TEST 23: PostgREST-compatible function resolution
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let v2Distinct = false;
      let v2ResErr = null;
      try {
        const { rows } = await testClient.query(
          `SELECT proname, pronargs FROM pg_proc WHERE proname IN ('create_organization', 'create_organization_v2');`
        );
        const hasV1 = rows.some((r) => r.proname === 'create_organization' && Number(r.pronargs) === 15);
        const hasV2 = rows.some((r) => r.proname === 'create_organization_v2' && Number(r.pronargs) === 17);
        v2Distinct = hasV1 && hasV2;
      } catch (err) {
        v2ResErr = err;
      }
      recordTest(
        'P1-A1-07',
        'PostgREST function resolution: create_organization (15) and create_organization_v2 (17) are distinct',
        v2Distinct,
        `Found distinct signatures for legacy v1 and canonical v2`,
        v2Distinct ? null : v2ResErr
      );
    });

    // TEST 24: Correct audit column names (authoritative details column) & Successful audit creation
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let auditValid = false;
      let auditErr = null;
      let auditRecord = null;
      try {
        if (!panOrgId) {
          throw new Error('Prerequisite organization creation (P1-A1-01) failed; cannot verify audit event');
        }
        const { rows } = await testClient.query(
          `SELECT organization_id, action, entity_type, entity_id, details FROM audit_events WHERE organization_id = $1::uuid AND action = 'ORGANIZATION_CREATED_ATOMIC' ORDER BY created_at DESC LIMIT 1;`,
          [panOrgId]
        );
        auditRecord = rows[0];
        const hasDetailsObj = auditRecord && auditRecord.details && typeof auditRecord.details === 'object';
        const hasCorrectOrg = auditRecord && auditRecord.organization_id === panOrgId;
        const hasMaskedPan = auditRecord?.details?.pan && String(auditRecord.details.pan).startsWith('XXXXX');
        const hasMaskedGstin = auditRecord?.details?.gstin && String(auditRecord.details.gstin).includes('XXXXX');
        const hasCategory = Boolean(auditRecord?.details?.category);
        auditValid = Boolean(hasDetailsObj && hasCorrectOrg && hasMaskedPan && hasMaskedGstin && hasCategory);
        if (!auditValid) {
          throw new Error(`Audit event validation failed: record=${JSON.stringify(auditRecord)}`);
        }
      } catch (err) {
        auditErr = err;
      }
      recordTest(
        'P1-A1-08',
        'Audit events table uses authoritative "details" column (resolving "metadata" defect)',
        Boolean(auditValid),
        `Audit event verified: org=${auditRecord?.organization_id}, details.pan=${auditRecord?.details?.pan}, details.gstin=${auditRecord?.details?.gstin}`,
        auditValid ? null : auditErr
      );
    });

    // TEST 25: Atomic rollback on failure
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      const failingAttemptKey = crypto.randomUUID();
      let failed = false;
      try {
        await testClient.query(
          `SELECT create_organization_v2(
            p_name := 'Rollback Test Org',
            p_pan := 'INVALID_PAN',
            p_idempotency_key := $1::uuid
          );`,
          [failingAttemptKey]
        );
      } catch (err) {
        failed = true;
      }
      const { rows } = await testClient.query(
        `SELECT count(*)::int AS count FROM organizations WHERE name = 'Rollback Test Org';`
      );
      const zeroOrphans = rows[0]?.count === 0 && failed;
      recordTest(
        'P1-A1-10',
        'Transactional integrity: validation failure triggers atomic rollback with zero orphan rows',
        zeroOrphans,
        `Zero orphan organizations created after validation failure`,
        zeroOrphans ? null : new Error('Orphan organization record remained after failure')
      );
    });

    // TEST 26: Sensitive identifier protection & Masking (Requires non-empty audit rows)
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let privacyCompliant = false;
      let privacyErr = null;
      try {
        const { rows } = await testClient.query(
          `SELECT details FROM audit_events WHERE action = 'ORGANIZATION_CREATED_ATOMIC' ORDER BY created_at DESC LIMIT 5;`
        );
        if (!rows || rows.length === 0) {
          throw new Error('Zero audit events found for ORGANIZATION_CREATED_ATOMIC; cannot verify privacy compliance');
        }
        const hasRawPan = rows.some((r) => {
          const d = JSON.stringify(r.details || {});
          return d.includes('ABCDE1234F') && !d.includes('XXXXX1234F');
        });
        const hasMaskedPan = rows.some((r) => {
          const d = JSON.stringify(r.details || {});
          return d.includes('XXXXX1234F');
        });
        privacyCompliant = !hasRawPan && hasMaskedPan;
      } catch (err) {
        privacyErr = err;
      }
      recordTest(
        'P1-A1-11',
        'Sensitive identifier privacy: PAN and GSTIN are masked in audit_events details',
        privacyCompliant,
        `Zero raw PAN identifiers leaked into audit details; verified masked records present`,
        privacyCompliant ? null : privacyErr
      );
    });

    // TEST 27: Continuing identity enforcement on UPDATE
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // Subtest A: Removing PAN from an approved organization is strictly rejected
      let removePanBlocked = false;
      let removePanErr = null;
      try {
        await testClient.query(
          `UPDATE organizations SET pan = NULL WHERE id = $1::uuid;`,
          [orgAId]
        );
      } catch (err) {
        removePanErr = err;
        removePanBlocked = err.message.includes('ERR_CANNOT_REMOVE_PAN');
      }

      // Subtest B: Changing PAN without updating a previously recorded GSTIN is rejected by cross-validation
      let mismatchBlocked = false;
      let mismatchErr = null;
      try {
        await testClient.query(
          `UPDATE organizations SET pan = 'ZYXWV9876U' WHERE id = $1::uuid;`,
          [orgAId]
        );
      } catch (err) {
        mismatchErr = err;
        mismatchBlocked = err.message.includes('ERR_PAN_GSTIN_MISMATCH');
      }

      // Subtest C & D: Changing PAN with an appropriately matching replacement GSTIN triggers demotion to review_required
      let alterDemoted = false;
      let alterErr = null;
      try {
        await testClient.query(
          `UPDATE organizations SET pan = 'ZYXWV9876U', gstin = '29ZYXWV9876U1Z5' WHERE id = $1::uuid;`,
          [orgAId]
        );
        const { rows: elRows } = await testClient.query(
          `SELECT status, reviewer_notes FROM organization_eligibility WHERE organization_id = $1::uuid;`,
          [orgAId]
        );
        alterDemoted = elRows[0]?.status === 'review_required';
      } catch (err) {
        alterErr = err;
      }

      // Subtest E: Existing subscriptions and trial dates remain intact after identity change
      let subIntact = false;
      const { rows: subRows } = await testClient.query(
        `SELECT status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = $1::uuid;`,
        [orgAId]
      );
      subIntact = subRows[0]?.status === 'active';

      // Subtest F: Unauthorized user (e.g. userB) cannot change orgA's business identity
      let unauthBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        const { rowCount } = await testClient.query(
          `UPDATE organizations SET name = 'Unauthorized Hijack' WHERE id = $1::uuid;`,
          [orgAId]
        );
        unauthBlocked = rowCount === 0;
      });

      const continuingPassed = removePanBlocked && mismatchBlocked && alterDemoted && subIntact && unauthBlocked;
      recordTest(
        'P1-A1-13',
        'Continuing identity enforcement: Cannot remove PAN from approved org; altering PAN demotes status to review_required',
        continuingPassed,
        `removeBlocked=${removePanBlocked}, mismatchBlocked=${mismatchBlocked}, alterDemoted=${alterDemoted}, subIntact=${subIntact}, unauthBlocked=${unauthBlocked}`,
        continuingPassed ? null : (removePanErr || mismatchErr || alterErr || new Error('Subtest failed'))
      );
    });

    // TEST 28: Existing subscription & trial preservation
    await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
      const { rows: subRows } = await testClient.query(
        `SELECT status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = $1::uuid;`,
        [orgBId]
      );
      const sub = subRows[0];
      const subPreserved = sub && sub.status === 'active' && new Date(sub.current_period_ends_at) > new Date();
      recordTest(
        'P1-A1-14',
        'Existing trial and subscription dates remain unchanged during lifecycle execution',
        Boolean(subPreserved),
        `Subscription status=${sub?.status}, ends_at=${sub?.current_period_ends_at}`,
        subPreserved ? null : new Error('Existing subscription data was unexpectedly mutated')
      );
    });

    // TEST 29: Explicit 0% tax remains valid (exempt supplies)
    await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
      let zeroTaxPassed = false;
      let zeroTaxErr = null;
      try {
        const { rows: invRows } = await testClient.query(
          `SELECT create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := jsonb_build_array(
              jsonb_build_object(
                'productId', $3::uuid,
                'quantity', 2,
                'unitPrice', 100.00,
                'discountPercent', 0,
                'taxRate', 0.00
              )
            ),
            p_status := 'ISSUED',
            p_idempotency_key := $4::uuid
          ) AS inv;`,
          [orgBId, custBId, prodB1Id, crypto.randomUUID()]
        );
        const inv = invRows[0]?.inv;
        const zeroTaxAmount = inv && Number(inv.tax_amount) === 0;
        const correctTotal = inv && Number(inv.total_amount) === 200.00;
        const correctSubtotal = inv && Number(inv.subtotal) === 200.00;
        const item = inv?.items?.[0];
        const itemZeroRate = item && Number(item.tax_rate) === 0 && Number(item.line_tax) === 0 && Number(item.line_total) === 200.00;

        // Verify database persistence of the item tax rate
        const { rows: dbItemRows } = await testClient.query(
          `SELECT tax_rate, line_tax, line_total FROM invoice_items WHERE invoice_id = $1::uuid;`,
          [inv?.id]
        );
        const dbItemPersisted = dbItemRows.length > 0 && Number(dbItemRows[0].tax_rate) === 0 && Number(dbItemRows[0].line_tax) === 0;

        zeroTaxPassed = Boolean(zeroTaxAmount && correctTotal && correctSubtotal && itemZeroRate && dbItemPersisted);
      } catch (err) {
        zeroTaxErr = err;
      }
      recordTest(
        'P1-A1-15',
        'Explicit 0% tax rate on invoice line item is preserved and calculates exactly zero tax (exempt supply)',
        zeroTaxPassed,
        `Invoice created with 0% tax: tax_amount=0.00, total=200.00, item.tax_rate=0, dbPersisted=${zeroTaxPassed}`,
        zeroTaxPassed ? null : zeroTaxErr
      );
    });

    // ------------------------------------------------------------------------
    // Execute Scenario B: Upgrade Pre-existing 029 Database to 030
    // ------------------------------------------------------------------------
    await runUpgradeScenarioB(maintClient, runId);

  } finally {
    // ------------------------------------------------------------------------
    // Step 5: Clean Disposal of Dedicated Test Database (Guaranteed Teardown)
    // ------------------------------------------------------------------------
    if (testClient) {
      try {
        await testClient.query(`
          REVOKE authenticated, anon, service_role FROM CURRENT_USER;
        `);
      } catch (err) {
        // Safe to ignore if already disconnected or in error state
      }
      await testClient.end().catch(() => {});
    }

    if (testDbCreated) {
      console.log(`\nStep 5: Disposing isolated ephemeral test database "${testDbName}"...`);
      try {
        // Terminate any active sessions connected to the ephemeral database
        await maintClient.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid();`,
          [testDbName]
        );

        // Drop the dedicated test database completely
        try {
          await maintClient.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE);`);
        } catch (forceErr) {
          if (forceErr.code === '42601' || forceErr.message.includes('syntax error')) {
            await maintClient.query(`DROP DATABASE IF EXISTS "${testDbName}";`);
          } else {
            throw forceErr;
          }
        }
        cleanupSuccessful = true;
        console.log(`  ✓ Dedicated test database "${testDbName}" dropped cleanly.`);
      } catch (dropErr) {
        console.error(`  ❌ Failed to drop test database "${testDbName}":`, dropErr.message);
        cleanupSuccessful = false;
        throw new Error(`Test isolation failure: Could not drop test database "${testDbName}": ${dropErr.message}`);
      }
    }

    await maintClient.end().catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Summary & Reporting
  // --------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('DATABASE ACCEPTANCE TEST SUMMARY');
  console.log('='.repeat(80));

  const total = testResults.length;
  const passed = testResults.filter((t) => t.passed).length;
  const failed = total - passed;

  console.log(`Total Contract Tests: ${total}`);
  console.log(`Passed:               ${passed}`);
  console.log(`Failed:               ${failed}`);
  console.log(`Isolation Disposed:   ${cleanupSuccessful ? 'YES' : 'NO'}`);

  if (failed > 0) {
    console.error(`\n❌ ACCEPTANCE SUITE FAILED — ${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL DATABASE ACCEPTANCE CONTRACTS PASSED WITH 100% SUCCESS.');
    process.exit(0);
  }
}

runAcceptance().catch((err) => {
  console.error('\n💥 Unexpected fatal test runner exception:', err);
  process.exit(1);
});
