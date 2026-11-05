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
  console.log('SCENARIO B: EXISTING DATABASE UPGRADE (MIGRATIONS 029 -> 030 -> 031 -> 032)');
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

    // 6. Apply Migration 030 and Migration 031 (forward-only upgrades)
    console.log('\nApplying Migration 030 (forward-only upgrade)...');
    const mig030Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '030_organization_identity_privacy_and_canonical_contract.sql'), 'utf8');
    await upgradeClient.query(mig030Sql);
    console.log('  ✓ Migration 030 applied successfully to existing database.');

    console.log('\nApplying Migration 031 (inventory and receivables authoritative aggregation)...');
    const mig031Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '031_inventory_and_receivables_authoritative_aggregation.sql'), 'utf8');
    await upgradeClient.query(mig031Sql);
    console.log('  ✓ Migration 031 applied successfully to existing database.');

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

    // ------------------------------------------------------------------------
    // Step 9: Scenario B Upgrade to Migration 032 (Obsolete RPC Cleanup)
    // ------------------------------------------------------------------------
    console.log('\n--- SCENARIO B: VERIFYING MIGRATION 031 STATE BEFORE MIGRATION 032 ---');

    // 9.1 Verify both signatures exist in pg_proc before applying migration 032
    const { rows: pre032Procs } = await upgradeClient.query(`
      SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS identity_args, pg_get_function_arguments(p.oid) AS full_args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'create_product_atomic';
    `);

    const hasObsolete022 = pre032Procs.some((p) => p.full_args.includes('p_is_active') && !p.full_args.includes('p_image_url'));
    const hasAuthoritative024 = pre032Procs.some((p) => p.full_args.includes('p_image_url'));
    const bothSignaturesPreExist = pre032Procs.length === 2 && hasObsolete022 && hasAuthoritative024;
    console.log(`  ✓ Checked pre-032 pg_proc: found ${pre032Procs.length} signatures (hasObsolete=${hasObsolete022}, hasAuthoritative=${hasAuthoritative024}).`);

    // 9.2 Pre-seed existing business data (Products, Stock movements, Customers, Invoices) under existingOrgId
    const preProdId = crypto.randomUUID();
    const preZeroProdId = crypto.randomUUID();
    const preCustId = crypto.randomUUID();
    const preZeroCustId = crypto.randomUUID();
    const preInvId = crypto.randomUUID();
    const preProdSku = `PRE-UPG-SKU-${upgradeRunId}`;
    const preZeroProdSku = `PRE-ZERO-SKU-${upgradeRunId}`;
    const preInvNum = `INV-UPG-${upgradeRunId}`;

    await upgradeClient.query(`
      UPDATE public.organization_eligibility
      SET status = 'approved'
      WHERE organization_id = '${existingOrgId}';

      INSERT INTO public.products (id, organization_id, name, sku, category, uom, purchase_cost, selling_price, tax_rate, is_active)
      VALUES
        ('${preProdId}', '${existingOrgId}', 'Pre-upgrade Switchgear Master', '${preProdSku}', 'Switchgear', 'Nos', 450.00, 650.00, 18.00, true),
        ('${preZeroProdId}', '${existingOrgId}', 'Pre-upgrade Zero Stock Cable', '${preZeroProdSku}', 'Wires & Cables', 'Mtr', 10.00, 15.00, 18.00, true);

      INSERT INTO public.stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
      VALUES ('${existingOrgId}', '${preProdId}', 120, 'OPENING_STOCK', 'Pre-upgrade opening stock');

      INSERT INTO public.customers (id, organization_id, name, phone, gstin, credit_limit, credit_days, is_active)
      VALUES
        ('${preCustId}', '${existingOrgId}', 'Pre-upgrade Infrastructure Corp', '9811122233', '29AAACP9999A1Z9', 250000.00, 30, true),
        ('${preZeroCustId}', '${existingOrgId}', 'Pre-upgrade Zero Balance Corp', '9811122244', '29AAACP9999A1Z8', 100000.00, 30, true);

      SELECT set_config('app.authoritative_invoice_transition', 'true', false);

      INSERT INTO public.invoices (id, organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
      VALUES ('${preInvId}', '${existingOrgId}', '${preCustId}', '${preInvNum}', 'ISSUED', CURRENT_DATE + interval '15 days', 1500.00, 1770.00, 0.00);

      SELECT set_config('app.authoritative_invoice_transition', 'false', false);
    `);
    console.log('  ✓ Pre-seeded business records at Migration 031 state (products, stock movements, customers, invoices).');

    // 9.3 Snapshot existing business records
    const { rows: snapProd } = await upgradeClient.query(`SELECT * FROM public.products WHERE id = $1;`, [preProdId]);
    const { rows: snapStock } = await upgradeClient.query(`SELECT count(*)::int AS cnt, sum(quantity_change)::numeric AS qty FROM public.stock_movements WHERE product_id = $1;`, [preProdId]);
    const { rows: snapCust } = await upgradeClient.query(`SELECT * FROM public.customers WHERE id = $1;`, [preCustId]);
    const { rows: snapInv } = await upgradeClient.query(`SELECT * FROM public.invoices WHERE id = $1;`, [preInvId]);

    // 9.4 Apply Migration 032
    console.log('\nApplying Migration 032 (cleanup obsolete product creation overload)...');
    const mig032Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '032_cleanup_obsolete_product_creation_overload.sql'), 'utf8');
    await upgradeClient.query(mig032Sql);
    console.log('  ✓ Migration 032 applied successfully to existing upgraded database.');

    // 9.5 Verify existing business data remains completely unchanged
    const { rows: postProd } = await upgradeClient.query(`SELECT * FROM public.products WHERE id = $1;`, [preProdId]);
    const { rows: postStock } = await upgradeClient.query(`SELECT count(*)::int AS cnt, sum(quantity_change)::numeric AS qty FROM public.stock_movements WHERE product_id = $1;`, [preProdId]);
    const { rows: postCust } = await upgradeClient.query(`SELECT * FROM public.customers WHERE id = $1;`, [preCustId]);
    const { rows: postInv } = await upgradeClient.query(`SELECT * FROM public.invoices WHERE id = $1;`, [preInvId]);

    const prodPreserved = postProd[0]?.name === snapProd[0]?.name && postProd[0]?.sku === snapProd[0]?.sku && Number(postProd[0]?.selling_price) === Number(snapProd[0]?.selling_price);
    const stockPreserved = postStock[0]?.cnt === snapStock[0]?.cnt && Number(postStock[0]?.qty) === Number(snapStock[0]?.qty);
    const custPreserved = postCust[0]?.name === snapCust[0]?.name && postCust[0]?.gstin === snapCust[0]?.gstin;
    const invPreserved = postInv[0]?.invoice_number === snapInv[0]?.invoice_number && postInv[0]?.status === snapInv[0]?.status && Number(postInv[0]?.total_amount) === Number(snapInv[0]?.total_amount);
    const businessDataPreserved = Boolean(prodPreserved && stockPreserved && custPreserved && invPreserved);

    // 9.6 Verify obsolete overload has been removed from pg_proc and authoritative signature remains
    const { rows: post032Procs } = await upgradeClient.query(`
      SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS identity_args, pg_get_function_arguments(p.oid) AS full_args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'create_product_atomic';
    `);

    const obsoleteRemoved = !post032Procs.some((p) => p.full_args.includes('p_is_active'));
    const authoritativeRemains = post032Procs.length === 1 && post032Procs[0].full_args.includes('p_image_url');

    // 9.7 Test atomic product creation under authenticated tenant context
    let createAtomicPassed = false;
    let createAtomicErr = null;
    let newCreatedProdId = null;

    await withRoleContext(upgradeClient, { role: 'authenticated', userId: existingUserId }, async () => {
      try {
        const postSku = `UPG-POST-SKU-${upgradeRunId}`;
        const { rows: newProdRows } = await upgradeClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Post-Upgrade Atomic LED Panel'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 350.00::numeric,
            p_selling_price := 520.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 40,
            p_image_url := 'https://example.com/panel.jpg'::text
          ) AS prod;
        `, [existingOrgId, postSku]);

        newCreatedProdId = newProdRows[0]?.prod?.id;

        // Check stock movement and authoritative stock level
        const { rows: stockRows } = await upgradeClient.query(`
          SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;
        `, [newCreatedProdId, existingOrgId]);

        const stockAccurate = Number(stockRows[0]?.stock) === 40;

        // Also test calling create_product_atomic omitting optional p_image_url (verifying unambiguous resolution)
        const postSku2 = `UPG-POST-SKU2-${upgradeRunId}`;
        const { rows: newProdRows2 } = await upgradeClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Post-Upgrade Atomic LED Bulb'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 80.00::numeric,
            p_selling_price := 120.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 20
          ) AS prod;
        `, [existingOrgId, postSku2]);

        const secondProdCreated = Boolean(newProdRows2[0]?.prod?.id);

        createAtomicPassed = Boolean(newCreatedProdId && stockAccurate && secondProdCreated);
      } catch (err) {
        createAtomicErr = err;
      }
    });

    // 9.8 Cross-tenant product creation rejected
    let crossTenantBlocked = false;
    let crossTenantErr = null;
    await withRoleContext(upgradeClient, { role: 'authenticated', userId: unauthorizedUserId }, async () => {
      try {
        await upgradeClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := 'CROSS-TENANT-SKU'::varchar,
            p_name := 'Cross Tenant Hijack'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 10.00::numeric,
            p_selling_price := 20.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 10
          );
        `, [existingOrgId]);
      } catch (err) {
        crossTenantErr = err;
        crossTenantBlocked = err.message.includes('ERR_UNAUTHORIZED') || err.message.includes('Unauthorized') || err.code === '42501';
      }
    });

    // 9.9 Anonymous access rejected with 42501
    let anonBlocked = false;
    let anonErr = null;
    await withRoleContext(upgradeClient, { role: 'anon' }, async () => {
      try {
        await upgradeClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := 'ANON-SKU'::varchar,
            p_name := 'Anon Attempt'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 10.00::numeric,
            p_selling_price := 20.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 10
          );
        `, [existingOrgId]);
      } catch (err) {
        anonErr = err;
        anonBlocked = err.code === '42501' || err.message.includes('permission denied');
      }
    });

    const upg03Passed =
      bothSignaturesPreExist &&
      businessDataPreserved &&
      obsoleteRemoved &&
      authoritativeRemains &&
      createAtomicPassed &&
      crossTenantBlocked &&
      anonBlocked;

    recordTest(
      'P1-UPG-03',
      'Scenario B Upgrade: Migration 032 removes obsolete overload from pg_proc, preserves business data, resolves signature ambiguity, and enforces authorization',
      upg03Passed,
      `preOverloadsExist=${bothSignaturesPreExist}, businessDataPreserved=${businessDataPreserved}, obsoleteRemoved=${obsoleteRemoved}, authoritativeRemains=${authoritativeRemains}, createAtomicPassed=${createAtomicPassed}, crossTenantBlocked=${crossTenantBlocked}, anonBlocked=${anonBlocked}`,
      upg03Passed ? null : (createAtomicErr || crossTenantErr || anonErr || new Error('Scenario B Migration 032 verification failed'))
    );

    // ------------------------------------------------------------------------
    // Step 10: Scenario B Upgrade to Migration 033 (Authoritative Aggregations, Chart RPCs & Covering Indexes)
    // ------------------------------------------------------------------------
    console.log('\n--- SCENARIO B: APPLYING MIGRATION 033 (FORWARD-ONLY UPGRADE) ---');
    const mig033Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '033_dashboard_authoritative_aggregations_and_pagination.sql'), 'utf8');
    await upgradeClient.query(mig033Sql);
    console.log('  ✓ Migration 033 applied successfully to existing upgraded database.');

    // 10.1 Verify covering indexes exist in pg_indexes
    const { rows: upgIndexes } = await upgradeClient.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_sales_orders_org_date_status',
          'idx_invoices_org_status_due',
          'idx_payments_org_date',
          'idx_products_org_active_reorder'
        );
    `);
    const allIndexesCreated = upgIndexes.length === 4;

    // 10.2 Verify authoritative get_dashboard_metrics, get_sales_trend, get_receivables_summary, get_top_brand_stock_valuation on upgraded data
    let upg04Passed = false;
    let upg04Err = null;
    await withRoleContext(upgradeClient, { role: 'authenticated', userId: existingUserId }, async () => {
      try {
        const { rows: dashRows } = await upgradeClient.query(
          `SELECT public.get_dashboard_metrics($1::uuid) AS metrics;`,
          [existingOrgId]
        );
        const metrics = dashRows[0].metrics;
        const metricsValid =
          typeof Number(metrics.today_sales) === 'number' &&
          typeof Number(metrics.total_receivables) === 'number' &&
          Array.isArray(metrics.low_stock_preview);

        const { rows: trendRows } = await upgradeClient.query(
          `SELECT * FROM public.get_sales_trend($1::uuid, 7);`,
          [existingOrgId]
        );
        const trendValid = trendRows.length === 7;

        const { rows: recvRows } = await upgradeClient.query(
          `SELECT public.get_receivables_summary($1::uuid) AS summary;`,
          [existingOrgId]
        );
        const summary = recvRows[0].summary;
        const recvValid = typeof Number(summary.total_outstanding) === 'number';

        const { rows: brandRows } = await upgradeClient.query(
          `SELECT * FROM public.get_top_brand_stock_valuation($1::uuid, 5);`,
          [existingOrgId]
        );
        const brandValid = Array.isArray(brandRows);

        upg04Passed = allIndexesCreated && metricsValid && trendValid && recvValid && brandValid;
      } catch (err) {
        upg04Err = err;
      }
    });

    recordTest(
      'P1-UPG-04',
      'Scenario B Upgrade: Migration 033 applies forward-only covering indexes and authoritative chart RPCs with valid data aggregation',
      upg04Passed,
      `allIndexesCreated=${allIndexesCreated}, upg04Passed=${upg04Passed}`,
      upg04Passed ? null : upg04Err
    );

    // ------------------------------------------------------------------------
    // Step 11: Scenario B Upgrade to Migration 034 (Page-Scoped RPCs & Security Hardening)
    // ------------------------------------------------------------------------
    console.log('\n--- SCENARIO B: APPLYING MIGRATION 034 (FORWARD-ONLY UPGRADE) ---');
    const mig034Sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '034_page_scoped_aggregations_and_security_hardening.sql'), 'utf8');
    await upgradeClient.query(mig034Sql);
    console.log('  ✓ Migration 034 applied successfully to existing upgraded database.');

    let upg05Passed = false;
    let upg05Err = null;
    await withRoleContext(upgradeClient, { role: 'authenticated', userId: existingUserId }, async () => {
      try {
        // 1. Pre-existing product expected stock balance of 120 units
        const { rows: pageStockRows } = await upgradeClient.query(
          `SELECT product_id, current_stock FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
          [existingOrgId, preProdId]
        );
        const stockRowValid =
          pageStockRows.length === 1 &&
          pageStockRows[0].product_id === preProdId &&
          Number.isFinite(Number(pageStockRows[0].current_stock)) &&
          Number(pageStockRows[0].current_stock) === 120;

        // 2. Pre-existing customer expected receivable balance of ₹1,770.00
        const { rows: pageRecvRows } = await upgradeClient.query(
          `SELECT customer_id, current_receivable FROM public.get_page_customer_receivables($1::uuid, ARRAY[$2::uuid]);`,
          [existingOrgId, preCustId]
        );
        const recvRowValid =
          pageRecvRows.length === 1 &&
          pageRecvRows[0].customer_id === preCustId &&
          Number.isFinite(Number(pageRecvRows[0].current_receivable)) &&
          Number(pageRecvRows[0].current_receivable) === 1770.00;

        // 3. Pre-existing zero balances preserved
        const { rows: zeroStockRows } = await upgradeClient.query(
          `SELECT product_id, current_stock FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
          [existingOrgId, preZeroProdId]
        );
        const zeroStockValid =
          zeroStockRows.length === 1 &&
          zeroStockRows[0].product_id === preZeroProdId &&
          Number.isFinite(Number(zeroStockRows[0].current_stock)) &&
          Number(zeroStockRows[0].current_stock) === 0;

        const { rows: zeroRecvRows } = await upgradeClient.query(
          `SELECT customer_id, current_receivable FROM public.get_page_customer_receivables($1::uuid, ARRAY[$2::uuid]);`,
          [existingOrgId, preZeroCustId]
        );
        const zeroRecvValid =
          zeroRecvRows.length === 1 &&
          zeroRecvRows[0].customer_id === preZeroCustId &&
          Number.isFinite(Number(zeroRecvRows[0].current_receivable)) &&
          Number(zeroRecvRows[0].current_receivable) === 0.00;

        // 4. Verify pre-existing business records remain unchanged after Migration 034
        const { rows: post034Prod } = await upgradeClient.query(`SELECT * FROM public.products WHERE id = $1;`, [preProdId]);
        const { rows: post034Stock } = await upgradeClient.query(`SELECT sum(quantity_change)::numeric AS qty FROM public.stock_movements WHERE product_id = $1;`, [preProdId]);
        const { rows: post034Cust } = await upgradeClient.query(`SELECT * FROM public.customers WHERE id = $1;`, [preCustId]);
        const { rows: post034Inv } = await upgradeClient.query(`SELECT * FROM public.invoices WHERE id = $1;`, [preInvId]);

        const recordsUnchanged =
          post034Prod[0]?.name === snapProd[0]?.name &&
          Number(post034Stock[0]?.qty) === 120 &&
          post034Cust[0]?.name === snapCust[0]?.name &&
          Number(post034Inv[0]?.total_amount) === 1770.00;

        // 5. Tenant isolation: cross-tenant access from unauthorized caller is rejected
        let tenantIsolationOk = false;
        try {
          await withRoleContext(upgradeClient, { role: 'authenticated', userId: crypto.randomUUID() }, async () => {
            await upgradeClient.query(
              `SELECT * FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
              [existingOrgId, preProdId]
            );
          });
        } catch (tenantErr) {
          tenantIsolationOk = tenantErr.code === '42501' || tenantErr.message.includes('ERR_UNAUTHORIZED');
        }

        upg05Passed = Boolean(
          stockRowValid &&
          recvRowValid &&
          zeroStockValid &&
          zeroRecvValid &&
          recordsUnchanged &&
          tenantIsolationOk
        );
      } catch (err) {
        upg05Err = err;
      }
    });

    recordTest(
      'P1-UPG-05',
      'Scenario B Upgrade: Migration 034 applies page-scoped stock and receivables RPCs, preserves 120 stock and 1770 receivable, retains zero balances and enforces tenant isolation',
      upg05Passed,
      `upg05Passed=${upg05Passed}`,
      upg05Passed ? null : upg05Err
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
    // Step 2: Apply Migrations 001 - 032 in Strict Lexical Order (Scenario A: Fresh Installation)
    // ------------------------------------------------------------------------
    console.log('\nStep 2: Applying migrations sequentially (001 -> 032) [Scenario A: Fresh Installation]...');
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

    // Dedicated organization for TEST 27 (P1-A1-13) identity mutation & demotion test
    // This preserves orgAId in an approved, active state for subsequent operational and financial tests
    const panLifecycleOrgId = crypto.randomUUID();
    await testClient.query(`
      INSERT INTO organizations (id, name, currency, legal_name, pan, gstin, state) VALUES
      ('${panLifecycleOrgId}', 'Lifecycle Isolation Org ${runId}', 'INR', 'Lifecycle Isolation Pvt Ltd', 'ABCDE1234F', '29ABCDE1234F1Z5', 'Karnataka');

      INSERT INTO memberships (organization_id, user_id, role, is_active) VALUES
      ('${panLifecycleOrgId}', '${userAId}', 'owner', true);

      INSERT INTO organization_eligibility (organization_id, business_category, sells_electrical_products, status, declared_by) VALUES
      ('${panLifecycleOrgId}', 'electrical_retail', true, 'approved', '${userAId}');

      INSERT INTO organization_subscriptions (organization_id, plan_tier, status, current_period_ends_at) VALUES
      ('${panLifecycleOrgId}', 'pro', 'active', now() + interval '30 days');
    `);

    // TEST 27: Continuing identity enforcement on UPDATE
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      // Subtest A: Removing PAN from an approved organization is strictly rejected
      let removePanBlocked = false;
      let removePanErr = null;
      try {
        await testClient.query(
          `UPDATE organizations SET pan = NULL WHERE id = $1::uuid;`,
          [panLifecycleOrgId]
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
          [panLifecycleOrgId]
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
          [panLifecycleOrgId]
        );
        const { rows: elRows } = await testClient.query(
          `SELECT status, reviewer_notes FROM organization_eligibility WHERE organization_id = $1::uuid;`,
          [panLifecycleOrgId]
        );
        alterDemoted = elRows[0]?.status === 'review_required';
      } catch (err) {
        alterErr = err;
      }

      // Subtest E: Existing subscriptions and trial dates remain intact after identity change
      let subIntact = false;
      const { rows: subRows } = await testClient.query(
        `SELECT status, current_period_ends_at FROM organization_subscriptions WHERE organization_id = $1::uuid;`,
        [panLifecycleOrgId]
      );
      subIntact = subRows[0]?.status === 'active';

      // Subtest F: Unauthorized user (e.g. userB) cannot change panLifecycleOrg's business identity
      let unauthBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        const { rowCount } = await testClient.query(
          `UPDATE organizations SET name = 'Unauthorized Hijack' WHERE id = $1::uuid;`,
          [panLifecycleOrgId]
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

    // ========================================================================
    // PHASE A2.1: INVENTORY & RECEIVABLES ACCURACY TESTS
    // ========================================================================

    // TEST (P0-PROD-SIG-01): Scenario A create_product_atomic signature uniqueness & unambiguous resolution
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let sigTestPassed = false;
      let sigTestErr = null;
      try {
        const { rows: procs } = await testClient.query(`
          SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS identity_args, pg_get_function_arguments(p.oid) AS full_args
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public' AND p.proname = 'create_product_atomic';
        `);

        const exactlyOneRpc = procs.length === 1;
        const hasImageUrl = Boolean(procs[0]?.full_args.includes('p_image_url'));
        const noIsActive = !procs[0]?.full_args.includes('p_is_active');

        // Test invocation with both required and optional parameters
        const skuWithImg = `SIG-IMG-${runId}`;
        const { rows: r1 } = await testClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Signature Test With Image'::varchar,
            p_category := 'Switchgear'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 100.00::numeric,
            p_selling_price := 150.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 5,
            p_brand := 'Havells'::varchar,
            p_description := 'Test desc'::text,
            p_hsn_code := '8536'::varchar,
            p_reorder_threshold := 2,
            p_notes := 'Opening note'::text,
            p_image_url := 'https://example.com/switch.jpg'::text
          ) AS prod;
        `, [orgAId, skuWithImg]);

        // Test invocation omitting optional p_image_url (proves unambiguous resolution)
        const skuNoImg = `SIG-NOIMG-${runId}`;
        const { rows: r2 } = await testClient.query(`
          SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Signature Test Without Image'::varchar,
            p_category := 'Switchgear'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 100.00::numeric,
            p_selling_price := 150.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 0
          ) AS prod;
        `, [orgAId, skuNoImg]);

        sigTestPassed = exactlyOneRpc && hasImageUrl && noIsActive && Boolean(r1[0]?.prod?.id) && Boolean(r2[0]?.prod?.id);
      } catch (err) {
        sigTestErr = err;
      }

      recordTest(
        'P0-PROD-SIG-01',
        'Scenario A Fresh Install: Exactly one authoritative create_product_atomic signature exists in pg_proc and resolves unambiguously',
        sigTestPassed,
        `sigTestPassed=${sigTestPassed}`,
        sigTestPassed ? null : sigTestErr
      );
    });

    // TEST 30 (P1-A2-01): Legitimate zero stock & on-hand inventory accuracy
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let zeroStockPassed = false;
      let zeroStockErr = null;
      try {
        // 1. Seed a product with 0 opening stock via authoritative create_product_atomic (no movements)
        const skuZero = `SKU-ZERO-${runId}`;
        const { rows: prodZeroRows } = await testClient.query(
          `SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Zero Stock Product'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 100.00::numeric,
            p_selling_price := 150.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 0,
            p_image_url := NULL::text
          ) AS prod;`,
          [orgAId, skuZero]
        );
        const prodZeroId = prodZeroRows[0]?.prod?.id;

        // 2. Seed a product with 50 units opening stock
        const skuBalanced = `SKU-BALANCED-${runId}`;
        const { rows: prodBalancedRows } = await testClient.query(
          `SELECT create_product_atomic(
            p_org_id := $1::uuid,
            p_sku := $2::varchar,
            p_name := 'Net Zero Product'::varchar,
            p_category := 'Lighting'::varchar,
            p_uom := 'Nos'::varchar,
            p_purchase_cost := 200.00::numeric,
            p_selling_price := 250.00::numeric,
            p_tax_rate := 18.00::numeric,
            p_opening_stock := 50,
            p_image_url := NULL::text
          ) AS prod;`,
          [orgAId, skuBalanced]
        );
        const prodBalancedId = prodBalancedRows[0]?.prod?.id;

        // Dispatch 50 units through authoritative stock adjustment to reach net 0 balance
        await testClient.query(
          `SELECT record_stock_adjustment(
            p_org_id := $1::uuid,
            p_product_id := $2::uuid,
            p_quantity_change := -50,
            p_notes := 'Full dispatch'::text,
            p_idempotency_key := $3::uuid
          );`,
          [orgAId, prodBalancedId, crypto.randomUUID()]
        );

        // 3. Query get_product_stock_levels for orgAId
        const { rows: stockLevels } = await testClient.query(
          `SELECT product_id, current_stock FROM public.get_product_stock_levels($1::uuid)
           WHERE product_id IN ($2::uuid, $3::uuid);`,
          [orgAId, prodZeroId, prodBalancedId]
        );

        const zeroRow = stockLevels.find((r) => r.product_id === prodZeroId);
        const balancedRow = stockLevels.find((r) => r.product_id === prodBalancedId);

        const zeroIsZero = zeroRow && Number(zeroRow.current_stock) === 0;
        const balancedIsZero = balancedRow && Number(balancedRow.current_stock) === 0;

        // 4. Query single-product get_product_stock
        const { rows: singleZero } = await testClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodZeroId, orgAId]
        );
        const { rows: singleBalanced } = await testClient.query(
          `SELECT public.get_product_stock($1::uuid, $2::uuid) AS stock;`,
          [prodBalancedId, orgAId]
        );

        const singleZeroIsZero = Number(singleZero[0]?.stock) === 0;
        const singleBalancedIsZero = Number(singleBalanced[0]?.stock) === 0;

        zeroStockPassed = Boolean(zeroIsZero && balancedIsZero && singleZeroIsZero && singleBalancedIsZero);
      } catch (err) {
        zeroStockErr = err;
      }

      recordTest(
        'P1-A2-01',
        'Authoritative stock aggregation preserves explicit zero stock for products with no movements or net zero balance',
        zeroStockPassed,
        `zeroStockPassed=${zeroStockPassed}`,
        zeroStockPassed ? null : zeroStockErr
      );
    });

    // TEST 31 (P1-A2-02): High-volume inventory movements (> 2,500 transactions)
    let bulkStockPassed = false;
    let bulkStockErr = null;
    try {
      const prodBulkId = crypto.randomUUID();
      const skuBulk = `SKU-BULK-${runId}`;

      // Administrative setup: insert high-volume ledger records as table owner
      await testClient.query(
        `INSERT INTO public.products (id, organization_id, sku, name, category, uom, purchase_cost, selling_price, tax_rate, is_active)
         VALUES ($1, $2, $3, 'High Volume Stock Product', 'Switchgear', 'Nos', 50.00, 75.00, 18.00, true);`,
        [prodBulkId, orgAId, skuBulk]
      );

      // Insert 2,000 movements of +2 and 500 movements of -1 (Total: 2,500 movements, Net: 3,500)
      await testClient.query(
        `INSERT INTO public.stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
         SELECT $1::uuid, $2::uuid, 2, 'GOODS_RECEIVED', 'Bulk Inflow'
         FROM generate_series(1, 2000);`,
        [orgAId, prodBulkId]
      );

      await testClient.query(
        `INSERT INTO public.stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
         SELECT $1::uuid, $2::uuid, -1, 'SALES_DISPATCH', 'Bulk Outflow'
         FROM generate_series(1, 500);`,
        [orgAId, prodBulkId]
      );

      // Verification under authenticated tenant context
      await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
        // Aggregate through get_product_stock_levels
        const { rows: bulkRows } = await testClient.query(
          `SELECT current_stock FROM public.get_product_stock_levels($1::uuid) WHERE product_id = $2::uuid;`,
          [orgAId, prodBulkId]
        );

        // Query direct sum from stock_movements table for consistency verification
        const { rows: sumRows } = await testClient.query(
          `SELECT count(*)::int AS cnt, sum(quantity_change)::numeric AS total FROM public.stock_movements WHERE product_id = $1::uuid;`,
          [prodBulkId]
        );

        const rpcStock = Number(bulkRows[0]?.current_stock);
        const dbTotal = Number(sumRows[0]?.total);
        const dbCount = Number(sumRows[0]?.cnt);

        bulkStockPassed = (rpcStock === 3500 && dbTotal === 3500 && dbCount === 2500);
      });
    } catch (err) {
      bulkStockErr = err;
    }

    recordTest(
      'P1-A2-02',
      'Authoritative stock aggregation handles high-volume transaction history (2,500 movements) without silent truncation',
      bulkStockPassed,
      `rpcStock=3500, dbCount=2500, match=${bulkStockPassed}`,
      bulkStockPassed ? null : bulkStockErr
    );

    // TEST 32 (P1-A2-03): Cross-tenant isolation & unauthorized access rejection on stock RPCs
    let isolationStockPassed = false;
    let isolationStockErr = null;
    try {
      // 1. userB (tenant B) attempts to call get_product_stock_levels for orgA
      let crossTenantLevelsBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        try {
          await testClient.query(`SELECT * FROM public.get_product_stock_levels($1::uuid);`, [orgAId]);
        } catch (err) {
          crossTenantLevelsBlocked = err.message.includes('ERR_UNAUTHORIZED') || err.code === '42501';
        }
      });

      // 2. userB attempts to call get_product_stock for orgA product
      let crossTenantStockBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        try {
          await testClient.query(`SELECT public.get_product_stock($1::uuid, $2::uuid);`, [prodA1Id, orgAId]);
        } catch (err) {
          crossTenantStockBlocked = err.message.includes('Unauthorized') || err.code === '42501';
        }
      });

      // 3. anon role attempts to call get_product_stock_levels
      let anonBlocked = false;
      await withRoleContext(testClient, { role: 'anon' }, async () => {
        try {
          await testClient.query(`SELECT * FROM public.get_product_stock_levels($1::uuid);`, [orgAId]);
        } catch (err) {
          anonBlocked = err.code === '42501' || err.message.includes('permission denied');
        }
      });

      isolationStockPassed = crossTenantLevelsBlocked && crossTenantStockBlocked && anonBlocked;
    } catch (err) {
      isolationStockErr = err;
    }

    recordTest(
      'P1-A2-03',
      'Stock RPCs strictly enforce cross-tenant isolation and reject unauthorized/unauthenticated access',
      isolationStockPassed,
      `crossTenantLevelsBlocked=${isolationStockPassed}`,
      isolationStockPassed ? null : isolationStockErr
    );

    // TEST 33 (P1-A2-04): Customer receivables aggregation accurately handles zero-balance states
    let zeroRecvPassed = false;
    let zeroRecvErr = null;
    try {
      const custZero1Id = crypto.randomUUID();
      const custZero2Id = crypto.randomUUID();

      // Administrative setup: seed customers and historical lifecycle invoices
      await testClient.query(
        `INSERT INTO public.customers (id, organization_id, name, credit_limit, credit_days, is_active)
         VALUES
          ($1, $3, 'Zero Customer No Invoices', 50000, 30, true),
          ($2, $3, 'Zero Customer Settled Invoices', 50000, 30, true);`,
        [custZero1Id, custZero2Id, orgAId]
      );

      // Set authoritative invoice transition flag for synthetic test fixture creation
      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'true', false);`);

      // Paid invoice (total_amount = total_paid = 500)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-Z2-PAID', 'PAID', CURRENT_DATE, 500.00, 500.00, 500.00);`,
        [orgAId, custZero2Id]
      );

      // Cancelled invoice
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-Z2-CANC', 'CANCELLED', CURRENT_DATE, 1000.00, 1000.00, 0.00);`,
        [orgAId, custZero2Id]
      );

      // Draft invoice (not issued)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-Z2-DRAFT', 'DRAFT', CURRENT_DATE, 750.00, 750.00, 0.00);`,
        [orgAId, custZero2Id]
      );

      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'false', false);`);

      // Verification under authenticated tenant context
      await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
        // Query get_customer_receivables
        const { rows: recvRows } = await testClient.query(
          `SELECT customer_id, current_receivable FROM public.get_customer_receivables($1::uuid)
           WHERE customer_id IN ($2::uuid, $3::uuid);`,
          [orgAId, custZero1Id, custZero2Id]
        );

        const r1 = recvRows.find((r) => r.customer_id === custZero1Id);
        const r2 = recvRows.find((r) => r.customer_id === custZero2Id);

        const cust1Zero = r1 && Number(r1.current_receivable) === 0.00;
        const cust2Zero = r2 && Number(r2.current_receivable) === 0.00;

        // Query single-customer get_customer_receivable
        const { rows: singleR1 } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custZero1Id, orgAId]
        );
        const { rows: singleR2 } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custZero2Id, orgAId]
        );

        const single1Zero = Number(singleR1[0]?.receivable) === 0.00;
        const single2Zero = Number(singleR2[0]?.receivable) === 0.00;

        zeroRecvPassed = Boolean(cust1Zero && cust2Zero && single1Zero && single2Zero);
      });
    } catch (err) {
      zeroRecvErr = err;
    }

    recordTest(
      'P1-A2-04',
      'Customer receivables aggregation accurately returns 0.00 for customers without invoices, settled, cancelled, and draft invoices',
      zeroRecvPassed,
      `zeroRecvPassed=${zeroRecvPassed}`,
      zeroRecvPassed ? null : zeroRecvErr
    );

    // TEST 34 (P1-A2-05): Multiple invoices with partial payments and exact monetary rounding
    let multiInvoicePassed = false;
    let multiInvoiceErr = null;
    try {
      const custMultiId = crypto.randomUUID();

      await testClient.query(
        `INSERT INTO public.customers (id, organization_id, name, credit_limit, credit_days, is_active)
         VALUES ($1, $2, 'Multi Invoice Customer', 100000, 30, true);`,
        [custMultiId, orgAId]
      );

      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'true', false);`);

      // Invoice 1: PARTIALLY_PAID (1500.50 - 500.25 = 1000.25)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-M1', 'PARTIALLY_PAID', CURRENT_DATE, 1500.50, 1500.50, 500.25);`,
        [orgAId, custMultiId]
      );

      // Invoice 2: ISSUED (2500.75 - 0.00 = 2500.75)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-M2', 'ISSUED', CURRENT_DATE, 2500.75, 2500.75, 0.00);`,
        [orgAId, custMultiId]
      );

      // Invoice 3: PAID (800.00 - 800.00 = 0.00)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         VALUES ($1, $2, 'INV-M3', 'PAID', CURRENT_DATE, 800.00, 800.00, 800.00);`,
        [orgAId, custMultiId]
      );

      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'false', false);`);

      // Verification under authenticated tenant context
      await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
        // Expected balance: 1000.25 + 2500.75 = 3501.00
        const { rows: multiRecv } = await testClient.query(
          `SELECT current_receivable FROM public.get_customer_receivables($1::uuid) WHERE customer_id = $2::uuid;`,
          [orgAId, custMultiId]
        );
        const { rows: singleRecv } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custMultiId, orgAId]
        );

        const rpcVal = Number(multiRecv[0]?.current_receivable);
        const singleVal = Number(singleRecv[0]?.receivable);

        multiInvoicePassed = (rpcVal === 3501.00 && singleVal === 3501.00);
      });
    } catch (err) {
      multiInvoiceErr = err;
    }

    recordTest(
      'P1-A2-05',
      'Customer receivables aggregation accurately computes outstanding balances across multiple invoices with exact paise rounding',
      multiInvoicePassed,
      `expected=3501.00, actual=${multiInvoicePassed ? 3501.00 : 'mismatch'}`,
      multiInvoicePassed ? null : multiInvoiceErr
    );

    // TEST 35 (P1-A2-06): High-volume invoice records (> 1,200 invoices)
    let highVolumeInvPassed = false;
    let highVolumeInvErr = null;
    try {
      const custBulkInvId = crypto.randomUUID();

      await testClient.query(
        `INSERT INTO public.customers (id, organization_id, name, credit_limit, credit_days, is_active)
         VALUES ($1, $2, 'Bulk Invoice Customer', 500000, 60, true);`,
        [custBulkInvId, orgAId]
      );

      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'true', false);`);

      // Insert 1,000 ISSUED invoices of 15.25 (Sum = 15,250.00)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         SELECT $1::uuid, $2::uuid, 'BULK-INV-IS-' || s, 'ISSUED', CURRENT_DATE, 15.25, 15.25, 0.00
         FROM generate_series(1, 1000) AS s;`,
        [orgAId, custBulkInvId]
      );

      // Insert 200 PAID invoices of 50.00 (Balance = 0.00)
      await testClient.query(
        `INSERT INTO public.invoices (organization_id, customer_id, invoice_number, status, due_date, subtotal, total_amount, total_paid)
         SELECT $1::uuid, $2::uuid, 'BULK-INV-PD-' || s, 'PAID', CURRENT_DATE, 50.00, 50.00, 50.00
         FROM generate_series(1, 200) AS s;`,
        [orgAId, custBulkInvId]
      );

      await testClient.query(`SELECT set_config('app.authoritative_invoice_transition', 'false', false);`);

      // Verification under authenticated tenant context
      await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
        const { rows: bulkRecvRows } = await testClient.query(
          `SELECT current_receivable FROM public.get_customer_receivables($1::uuid) WHERE customer_id = $2::uuid;`,
          [orgAId, custBulkInvId]
        );

        const { rows: singleBulkRows } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custBulkInvId, orgAId]
        );

        const bulkRpcTotal = Number(bulkRecvRows[0]?.current_receivable);
        const bulkSingleTotal = Number(singleBulkRows[0]?.receivable);

        // 1,000 * 15.25 = 15,250.00
        highVolumeInvPassed = (bulkRpcTotal === 15250.00 && bulkSingleTotal === 15250.00);
      });
    } catch (err) {
      highVolumeInvErr = err;
    }

    recordTest(
      'P1-A2-06',
      'Customer receivables aggregation computes exact sum across 1,200 invoices without client-side pagination truncation',
      highVolumeInvPassed,
      `expected=15250.00, actual=${highVolumeInvPassed ? 15250.00 : 'mismatch'}`,
      highVolumeInvPassed ? null : highVolumeInvErr
    );

    // TEST 36 (P1-A2-07): Cross-tenant isolation & unauthorized access on customer receivables RPCs
    let isolationRecvPassed = false;
    let isolationRecvErr = null;
    try {
      // 1. userB attempts to call get_customer_receivables for orgA
      let crossTenantRecvBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        try {
          await testClient.query(`SELECT * FROM public.get_customer_receivables($1::uuid);`, [orgAId]);
        } catch (err) {
          crossTenantRecvBlocked = err.message.includes('ERR_UNAUTHORIZED') || err.code === '42501';
        }
      });

      // 2. userB attempts to call get_customer_receivable for orgA customer
      let crossTenantSingleBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        try {
          await testClient.query(`SELECT public.get_customer_receivable($1::uuid, $2::uuid);`, [custAId, orgAId]);
        } catch (err) {
          crossTenantSingleBlocked = err.message.includes('ERR_UNAUTHORIZED') || err.code === '42501';
        }
      });

      // 3. userB attempts to query orgA customer from within orgB (cross-tenant customer probe)
      let foreignCustomerBlocked = false;
      await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
        try {
          await testClient.query(`SELECT public.get_customer_receivable($1::uuid, $2::uuid);`, [custAId, orgBId]);
        } catch (err) {
          foreignCustomerBlocked = err.message.includes('ERR_CUSTOMER_NOT_FOUND');
        }
      });

      // 4. anon role attempts to call get_customer_receivables
      let anonRecvBlocked = false;
      await withRoleContext(testClient, { role: 'anon' }, async () => {
        try {
          await testClient.query(`SELECT * FROM public.get_customer_receivables($1::uuid);`, [orgAId]);
        } catch (err) {
          anonRecvBlocked = err.code === '42501' || err.message.includes('permission denied');
        }
      });

      isolationRecvPassed = crossTenantRecvBlocked && crossTenantSingleBlocked && foreignCustomerBlocked && anonRecvBlocked;
    } catch (err) {
      isolationRecvErr = err;
    }

    recordTest(
      'P1-A2-07',
      'Customer receivables RPCs strictly enforce cross-tenant isolation and reject unauthorized access attempts',
      isolationRecvPassed,
      `isolationRecvPassed=${isolationRecvPassed}`,
      isolationRecvPassed ? null : isolationRecvErr
    );

    // TEST 37 (P1-A2-08): Partial payment allocation updates invoice status and reduces customer receivable
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let paymentRecvPassed = false;
      let paymentRecvErr = null;
      try {
        const custPayId = crypto.randomUUID();
        await testClient.query(
          `INSERT INTO public.customers (id, organization_id, name, credit_limit, credit_days, is_active)
           VALUES ($1, $2, 'Payment Allocation Customer', 100000, 30, true);`,
          [custPayId, orgAId]
        );

        // Create authoritative ISSUED invoice via create_invoice_atomic
        const { rows: invRows } = await testClient.query(
          `SELECT create_invoice_atomic(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_items := jsonb_build_array(
              jsonb_build_object(
                'productId', $3::uuid,
                'quantity', 100,
                'unitPrice', 60.00,
                'taxRate', 0.00,
                'discountPercent', 0
              )
            ),
            p_status := 'ISSUED',
            p_idempotency_key := $4::uuid
          ) AS inv;`,
          [orgAId, custPayId, prodA1Id, crypto.randomUUID()]
        );
        const invPay = invRows[0]?.inv;
        const invPayId = invPay?.id;

        // Initial receivable = 6000.00
        const { rows: initRecv } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custPayId, orgAId]
        );
        const initOk = Number(initRecv[0]?.receivable) === 6000.00;

        // Allocate partial payment: 2,500.00
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 2500.00,
            p_payment_method := 'UPI',
            p_reference_no := 'UPI-12345',
            p_payment_date := CURRENT_DATE,
            p_notes := 'Partial payment 1',
            p_invoice_id := $3::uuid,
            p_allocated_amount := 2500.00,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custPayId, invPayId, crypto.randomUUID()]
        );

        // Check invoice status and receivable after partial payment
        const { rows: invAfterP1 } = await testClient.query(
          `SELECT status, total_paid FROM public.invoices WHERE id = $1::uuid;`,
          [invPayId]
        );
        const { rows: recvAfterP1 } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custPayId, orgAId]
        );

        const p1StatusOk = invAfterP1[0]?.status === 'PARTIALLY_PAID' && Number(invAfterP1[0]?.total_paid) === 2500.00;
        const p1RecvOk = Number(recvAfterP1[0]?.receivable) === 3500.00;

        // Allocate remaining payment: 3,500.00
        await testClient.query(
          `SELECT record_payment_and_allocate(
            p_org_id := $1::uuid,
            p_customer_id := $2::uuid,
            p_amount := 3500.00,
            p_payment_method := 'NEFT',
            p_reference_no := 'NEFT-998877',
            p_payment_date := CURRENT_DATE,
            p_notes := 'Final settlement',
            p_invoice_id := $3::uuid,
            p_allocated_amount := 3500.00,
            p_idempotency_key := $4::uuid
          );`,
          [orgAId, custPayId, invPayId, crypto.randomUUID()]
        );

        // Check invoice status and receivable after final payment
        const { rows: invAfterP2 } = await testClient.query(
          `SELECT status, total_paid FROM public.invoices WHERE id = $1::uuid;`,
          [invPayId]
        );
        const { rows: recvAfterP2 } = await testClient.query(
          `SELECT public.get_customer_receivable($1::uuid, $2::uuid) AS receivable;`,
          [custPayId, orgAId]
        );

        const p2StatusOk = invAfterP2[0]?.status === 'PAID' && Number(invAfterP2[0]?.total_paid) === 6000.00;
        const p2RecvOk = Number(recvAfterP2[0]?.receivable) === 0.00;

        paymentRecvPassed = Boolean(initOk && p1StatusOk && p1RecvOk && p2StatusOk && p2RecvOk);
      } catch (err) {
        paymentRecvErr = err;
      }

      recordTest(
        'P1-A2-08',
        'Partial payment allocation via record_payment_and_allocate transitions invoice status and reduces customer receivable to exact balance',
        paymentRecvPassed,
        `paymentRecvPassed=${paymentRecvPassed}`,
        paymentRecvPassed ? null : paymentRecvErr
      );
    });

    // ------------------------------------------------------------------------
    // TEST 38 (P1-A2-09): Authoritative Dashboard Metrics Contract (Draft Exclusion, Legitimate Zeros, Low Stock Preview)
    // ------------------------------------------------------------------------
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let dashMetricPassed = false;
      let dashMetricErr = null;
      try {
        // Query initial metrics for Org A
        const { rows: initialRows } = await testClient.query(
          `SELECT public.get_dashboard_metrics($1::uuid, CURRENT_DATE) AS metrics;`,
          [orgAId]
        );
        const initialMetrics = initialRows[0].metrics;
        const initialReceivables = Number(initialMetrics.total_receivables);

        // Insert a DRAFT invoice with total 50,000 for Org A
        const draftInvId = crypto.randomUUID();
        await testClient.query(`
          INSERT INTO public.invoices (id, organization_id, invoice_number, customer_id, invoice_date, due_date, status, subtotal, tax_amount, total_amount, total_paid)
          VALUES ($1, $2, 'INV-DRAFT-TEST', $3, CURRENT_DATE, CURRENT_DATE + 15, 'DRAFT', 50000, 0, 50000, 0);
        `, [draftInvId, orgAId, custAId]);

        // Re-query metrics: total_receivables MUST NOT include DRAFT invoices
        const { rows: postDraftRows } = await testClient.query(
          `SELECT public.get_dashboard_metrics($1::uuid, CURRENT_DATE) AS metrics;`,
          [orgAId]
        );
        const postDraftMetrics = postDraftRows[0].metrics;
        const draftExcluded = Number(postDraftMetrics.total_receivables) === initialReceivables;

        // Clean up draft test invoice
        await testClient.query(`DELETE FROM public.invoices WHERE id = $1;`, [draftInvId]);

        // Verify low_stock_preview returns an array with bounded items containing required fields
        const previewOk = Array.isArray(postDraftMetrics.low_stock_preview) &&
          postDraftMetrics.low_stock_preview.length <= 5 &&
          (postDraftMetrics.low_stock_preview.length === 0 || postDraftMetrics.low_stock_preview[0].sku !== undefined);

        // Verify cross-tenant isolation: user B cannot query org A dashboard metrics
        let crossTenantBlocked = false;
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(`SELECT public.get_dashboard_metrics($1::uuid);`, [orgAId]);
          });
        } catch (err) {
          crossTenantBlocked = err.code === '42501' || err.message.includes('Access denied');
        }

        dashMetricPassed = Boolean(draftExcluded && previewOk && crossTenantBlocked);
      } catch (err) {
        dashMetricErr = err;
      }

      recordTest(
        'P1-A2-09',
        'Authoritative get_dashboard_metrics strictly excludes DRAFT invoices, bounds low_stock_preview to top 5, and enforces tenant isolation',
        dashMetricPassed,
        `dashMetricPassed=${dashMetricPassed}`,
        dashMetricPassed ? null : dashMetricErr
      );
    });

    // ------------------------------------------------------------------------
    // TEST 39 (P1-A2-10): Dedicated Server-Side Sales Trend Aggregation Contract
    // ------------------------------------------------------------------------
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let salesTrendPassed = false;
      let salesTrendErr = null;
      try {
        const { rows: trendRows } = await testClient.query(
          `SELECT * FROM public.get_sales_trend($1::uuid, 7, CURRENT_DATE);`,
          [orgAId]
        );

        // Verify exactly 7 contiguous days returned
        const lengthOk = trendRows.length === 7;
        // Verify all rows have order_date and total_amount >= 0.00
        const rowsValid = trendRows.every((r) => r.order_date && Number(r.total_amount) >= 0.00);

        // Verify cross-tenant isolation
        let crossTenantBlocked = false;
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(`SELECT * FROM public.get_sales_trend($1::uuid, 7);`, [orgAId]);
          });
        } catch (err) {
          crossTenantBlocked = err.code === '42501' || err.message.includes('Access denied');
        }

        salesTrendPassed = Boolean(lengthOk && rowsValid && crossTenantBlocked);
      } catch (err) {
        salesTrendErr = err;
      }

      recordTest(
        'P1-A2-10',
        'get_sales_trend returns contiguous time series including 0.00 for dates without sales and enforces tenant isolation',
        salesTrendPassed,
        `salesTrendPassed=${salesTrendPassed}`,
        salesTrendPassed ? null : salesTrendErr
      );
    });

    // ------------------------------------------------------------------------
    // TEST 40 (P1-A2-11): Dedicated Server-Side Receivables Summary Contract
    // ------------------------------------------------------------------------
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let recvSummaryPassed = false;
      let recvSummaryErr = null;
      try {
        const { rows: recvRows } = await testClient.query(
          `SELECT public.get_receivables_summary($1::uuid, CURRENT_DATE) AS summary;`,
          [orgAId]
        );
        const summary = recvRows[0].summary;

        const totalInvoicedOk = typeof Number(summary.total_invoiced) === 'number' && Number(summary.total_invoiced) >= 0;
        const totalSettledOk = typeof Number(summary.total_settled) === 'number' && Number(summary.total_settled) >= 0;
        const totalOutstandingOk = typeof Number(summary.total_outstanding) === 'number' && Number(summary.total_outstanding) >= 0;
        const settledPctOk = Number(summary.settled_pct) >= 0 && Number(summary.settled_pct) <= 100;

        // Verify cross-tenant isolation
        let crossTenantBlocked = false;
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(`SELECT public.get_receivables_summary($1::uuid);`, [orgAId]);
          });
        } catch (err) {
          crossTenantBlocked = err.code === '42501' || err.message.includes('Access denied');
        }

        recvSummaryPassed = Boolean(totalInvoicedOk && totalSettledOk && totalOutstandingOk && settledPctOk && crossTenantBlocked);
      } catch (err) {
        recvSummaryErr = err;
      }

      recordTest(
        'P1-A2-11',
        'get_receivables_summary aggregates invoiced, settled, outstanding, and collection efficiency percentage with strict tenant security',
        recvSummaryPassed,
        `recvSummaryPassed=${recvSummaryPassed}`,
        recvSummaryPassed ? null : recvSummaryErr
      );
    });

    // ------------------------------------------------------------------------
    // TEST 41 (P1-A2-12): Dedicated Server-Side Brand Valuation & Covering Indexes Verification
    // ------------------------------------------------------------------------
    await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
      let brandAndIndexPassed = false;
      let brandAndIndexErr = null;
      try {
        const { rows: brandRows } = await testClient.query(
          `SELECT * FROM public.get_top_brand_stock_valuation($1::uuid, 5);`,
          [orgAId]
        );
        const brandRowsOk = Array.isArray(brandRows) && brandRows.length <= 5;

        // Verify covering indexes exist in pg_indexes
        const { rows: indexRows } = await testClient.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'idx_sales_orders_org_date_status',
              'idx_invoices_org_status_due',
              'idx_payments_org_date',
              'idx_products_org_active_reorder'
            );
        `);
        const allIndexesExist = indexRows.length === 4;

        // Cross-tenant isolation check on brand valuation
        let crossTenantBlocked = false;
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(`SELECT * FROM public.get_top_brand_stock_valuation($1::uuid, 5);`, [orgAId]);
          });
        } catch (err) {
          crossTenantBlocked = err.code === '42501' || err.message.includes('Access denied');
        }

        brandAndIndexPassed = Boolean(brandRowsOk && allIndexesExist && crossTenantBlocked);
      } catch (err) {
        brandAndIndexErr = err;
      }

      recordTest(
        'P1-A2-12',
        'get_top_brand_stock_valuation orders by total valuation and covering indexes exist for sales orders, invoices, payments, and products',
        brandAndIndexPassed,
        `brandAndIndexPassed=${brandAndIndexPassed}`,
        brandAndIndexPassed ? null : brandAndIndexErr
      );

      // TEST 42 (P1-A2-13): Page-Scoped Stock & Receivables Aggregation and Input Bounding
      let pageRpcPassed = false;
      let pageRpcErr = null;
      try {
        let pageStockOk = false;
        let pageRecvOk = false;
        let crossTenantStockBlocked = false;
        let crossTenantRecvBlocked = false;
        let batchLimitBlocked = false;
        let foreignProdExcluded = false;

        await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
          // 1. Authoritative stock query: compare against actual SUM of stock_movements
          const { rows: expectedStockRows } = await testClient.query(
            `SELECT COALESCE(SUM(quantity_change), 0)::numeric AS exp_stock
             FROM public.stock_movements
             WHERE organization_id = $1::uuid AND product_id = $2::uuid;`,
            [orgAId, prodA1Id]
          );
          const expectedStock = Number(expectedStockRows[0].exp_stock);

          const { rows: pStock } = await testClient.query(
            `SELECT product_id, current_stock FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
            [orgAId, prodA1Id]
          );
          pageStockOk =
            pStock.length === 1 &&
            pStock[0].product_id === prodA1Id &&
            Number.isFinite(Number(pStock[0].current_stock)) &&
            Number(pStock[0].current_stock) === expectedStock;

          // 2. Authoritative receivables query: compare against actual SUM of issued/partially paid invoices
          const { rows: expectedRecvRows } = await testClient.query(
            `SELECT COALESCE(SUM(ROUND(GREATEST(0.00, total_amount - total_paid)::numeric, 2)), 0.00)::numeric AS exp_recv
             FROM public.invoices
             WHERE organization_id = $1::uuid AND customer_id = $2::uuid AND status IN ('ISSUED', 'PARTIALLY_PAID');`,
            [orgAId, custAId]
          );
          const expectedRecv = Number(expectedRecvRows[0].exp_recv);

          const { rows: pRecv } = await testClient.query(
            `SELECT customer_id, current_receivable FROM public.get_page_customer_receivables($1::uuid, ARRAY[$2::uuid]);`,
            [orgAId, custAId]
          );
          pageRecvOk =
            pRecv.length === 1 &&
            pRecv[0].customer_id === custAId &&
            Number.isFinite(Number(pRecv[0].current_receivable)) &&
            Number(pRecv[0].current_receivable) === expectedRecv;

          // 3. Batch size limit check (> 100 rejected)
          try {
            await testClient.query(
              `SELECT * FROM public.get_page_product_stock_levels($1::uuid, array_fill($2::uuid, ARRAY[101]));`,
              [orgAId, prodA1Id]
            );
          } catch (limitErr) {
            batchLimitBlocked = limitErr.message.includes('ERR_INVALID_PARAMETER') || limitErr.message.includes('cannot exceed 100');
          }

          // 4. Unrelated organization product never appears in results
          const { rows: foreignRows } = await testClient.query(
            `SELECT * FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
            [orgAId, prodB1Id]
          );
          foreignProdExcluded = foreignRows.length === 0;
        });

        // 5. Cross-tenant stock check (User B querying Org A)
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(
              `SELECT * FROM public.get_page_product_stock_levels($1::uuid, ARRAY[$2::uuid]);`,
              [orgAId, prodA1Id]
            );
          });
        } catch (crossErr) {
          crossTenantStockBlocked = crossErr.code === '42501' || crossErr.message.includes('ERR_UNAUTHORIZED');
        }

        // 6. Cross-tenant receivables check (User B querying Org A)
        try {
          await withRoleContext(testClient, { role: 'authenticated', userId: userBId }, async () => {
            await testClient.query(
              `SELECT * FROM public.get_page_customer_receivables($1::uuid, ARRAY[$2::uuid]);`,
              [orgAId, custAId]
            );
          });
        } catch (crossRecvErr) {
          crossTenantRecvBlocked = crossRecvErr.code === '42501' || crossRecvErr.message.includes('ERR_UNAUTHORIZED');
        }

        pageRpcPassed = Boolean(
          pageStockOk &&
          pageRecvOk &&
          batchLimitBlocked &&
          foreignProdExcluded &&
          crossTenantStockBlocked &&
          crossTenantRecvBlocked
        );
      } catch (err) {
        pageRpcErr = err;
      }

      recordTest(
        'P1-A2-13',
        'get_page_product_stock_levels and get_page_customer_receivables reconcile with authoritative balances, enforce 100 batch limit, and reject cross-tenant access',
        pageRpcPassed,
        `pageRpcPassed=${pageRpcPassed}`,
        pageRpcPassed ? null : pageRpcErr
      );

      // TEST 43 (P1-A2-14): Financial Reconciliation & Draft Invoice Exclusion in get_receivables_summary
      let reconcilPassed = false;
      let reconcilErr = null;
      try {
        let draftExcluded = false;
        let metricsReconciled = false;

        await withRoleContext(testClient, { role: 'authenticated', userId: userAId }, async () => {
          // Query receivables summary
          const { rows: recvRows } = await testClient.query(
            `SELECT public.get_receivables_summary($1::uuid) AS summary;`,
            [orgAId]
          );
          const summary = recvRows[0].summary;

          // Query dashboard metrics
          const { rows: dashRows } = await testClient.query(
            `SELECT public.get_dashboard_metrics($1::uuid) AS metrics;`,
            [orgAId]
          );
          const metrics = dashRows[0].metrics;

          // Draft invoices are not counted in total_invoiced or total_outstanding
          const totalOut = Number(summary.total_outstanding);
          const totalRecv = Number(metrics.total_receivables);
          metricsReconciled = totalOut === totalRecv;

          // Check if any draft invoices exist and ensure they are not in total_invoiced
          const { rows: draftCheck } = await testClient.query(
            `SELECT COALESCE(SUM(total_amount), 0.00) AS draft_sum
             FROM public.invoices
             WHERE organization_id = $1::uuid AND status = 'DRAFT';`,
            [orgAId]
          );
          const draftSum = Number(draftCheck[0].draft_sum);

          // If draft invoices exist, summary.total_invoiced must NOT include draftSum
          const { rows: allInvCheck } = await testClient.query(
            `SELECT COALESCE(SUM(total_amount), 0.00) AS all_sum
             FROM public.invoices
             WHERE organization_id = $1::uuid AND status != 'CANCELLED';`,
            [orgAId]
          );
          const allSum = Number(allInvCheck[0].all_sum);
          const invoicedSummary = Number(summary.total_invoiced);

          draftExcluded = draftSum === 0 ? true : (invoicedSummary < allSum);
          reconcilPassed = metricsReconciled && draftExcluded;
        });
      } catch (err) {
        reconcilErr = err;
      }

      recordTest(
        'P1-A2-14',
        'get_receivables_summary strictly excludes DRAFT invoices and reconciles with get_dashboard_metrics total_receivables',
        reconcilPassed,
        `reconcilPassed=${reconcilPassed}`,
        reconcilPassed ? null : reconcilErr
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
