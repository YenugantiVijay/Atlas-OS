import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runOwnerConsoleAcceptance({ client, withRoleContext, recordTest }) {
  const [owner, staff, visitor, spare] = Array.from({ length: 4 }, () => randomUUID());
  const asUser = (userId, callback, options = {}) => withRoleContext(client, { userId, ...options }, callback);
  const asOwner = callback => asUser(owner, async () => {
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ aal: 'aal2', sub: owner })]);
    try { return await callback(); }
    finally { await client.query("SELECT set_config('request.jwt.claims','',false)"); }
  });
  const request = async (action, fields = {}) => (
    await client.query('SELECT public.owner_console_request($1,$2) AS data', [action, JSON.stringify(fields)])
  ).rows[0].data;
  async function check(id, name, test) {
    try { await test(); recordTest(id, name, true); }
    catch (error) { recordTest(id, name, false, null, error); }
  }

  await client.query(`INSERT INTO auth.users(id,email)
    SELECT id,id::text||'@example.test' FROM unnest($1::uuid[]) id`, [[owner, staff, visitor, spare]]);
  const { rows: [{ org }] } = await asUser(staff, () => client.query(`SELECT public.create_organization_v2(
    p_name := 'Owner Console Test Workspace',p_pan := 'BCTPK4567L',p_business_category := 'ecommerce',
    p_sells_electrical_products := false,p_product_lines := ARRAY['Home accessories'],p_idempotency_key := $1
  ) AS org`, [randomUUID()]));
  await client.query('INSERT INTO atlas_private.owner_console_accounts(slot,user_id) VALUES(1,$1)', [owner]);

  await check('OWNER-01', 'Owner Console requires a private seat and AAL2 and has exactly three assignable slots', async () => {
    await assert.rejects(asUser(owner, () => request('overview')), { code: '42501' });
    await assert.rejects(asUser(staff, async () => {
      await client.query("SELECT set_config('request.jwt.claims','{\"aal\":\"aal2\"}',false)");
      try { return await request('overview'); }
      finally { await client.query("SELECT set_config('request.jwt.claims','',false)"); }
    }), { code: '42501' });
    await assert.rejects(asUser(null, () => request('overview'), { role: 'anon' }), { code: '42501' });
    await assert.rejects(asUser(staff, () => client.query('SELECT * FROM atlas_private.owner_console_accounts')), { code: '42501' });
    await assert.rejects(client.query('INSERT INTO atlas_private.owner_console_accounts(slot,user_id) VALUES(4,$1)', [spare]), { code: '23514' });
    await assert.rejects(client.query('INSERT INTO atlas_private.owner_console_accounts(slot,user_id) VALUES(1,$1)', [spare]), { code: '23505' });
    assert.equal((await asOwner(() => request('overview'))).months.length, 6);
  });

  await check('OWNER-02', 'Support sources share one owner inbox while ERP reporters can only see their own reports', async () => {
    const first = (await asUser(staff, () => client.query("SELECT public.report_client_problem($1,'orders','Cannot confirm order','Confirmation gives an unexpected error.') AS id", [org.id]))).rows[0].id;
    await client.query("INSERT INTO public.memberships (organization_id,user_id,role) VALUES($1,$2,'viewer')", [org.id, visitor]);
    const own = async () => (await client.query('SELECT public.my_client_problem_reports($1) AS reports', [org.id])).rows[0].reports;
    assert.equal((await asUser(staff, own))[0].id, first);
    assert.deepEqual(await asUser(visitor, own), []);
    await assert.rejects(asUser(owner, own), { code: '42501' });
    const web = randomUUID();
    const intake = () => client.query('SELECT public.record_website_support($1,$2,$3,$4)', [web, 'report@example.test', 'Example store', 'Website unable to open the calculators.']);
    await assert.rejects(asUser(staff, intake), { code: '42501' });
    await asUser(null, intake, { role: 'service_role' });
    await asUser(null, intake, { role: 'service_role' });
    const tickets = await asOwner(() => request('tickets'));
    assert(tickets.some(ticket => ticket.id === web && ticket.source === 'website'));
    assert.equal(tickets.filter(ticket => ticket.id === web).length, 1);
    const entry = tickets.find(ticket => ticket.id === first);
    const update = { id: first, version: entry.updated_at, status: 'investigating', priority: 'urgent', client_update: 'We are investigating.' };
    await asOwner(() => request('update_ticket', update));
    await assert.rejects(asOwner(() => request('update_ticket', update)), { code: '40001' });
    assert.equal((await asUser(staff, own))[0].client_update, 'We are investigating.');
    assert((await asOwner(() => request('overview'))).urgent_reports > 0);
  });

  await check('OWNER-03', 'Verified purchases deduplicate, aggregate by month and edition, and subscription changes check the version', async () => {
    const { rows: [{ today, end }] } = await client.query(`SELECT
      ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today,
      ((now() AT TIME ZONE 'Asia/Kolkata')::date+30)::text AS end`);
    const purchase = { organization_id: org.id, product: 'professional', amount: 2499, paid_on: today, reference: 'TEST-' + randomUUID() };
    const before = await asOwner(() => request('overview'));
    const saved = await asOwner(() => request('record_purchase', purchase));
    assert.deepEqual(await asOwner(() => request('record_purchase', purchase)), saved);
    await assert.rejects(asOwner(() => request('record_purchase', { ...purchase, amount: 50 })), { code: '23505' });
    const after = await asOwner(() => request('overview'));
    assert.equal(after.months.at(-1).revenue - before.months.at(-1).revenue, 2499);
    assert.equal(after.months.at(-1).purchases - before.months.at(-1).purchases, 1);
    assert(after.products.some(item => item.product === 'professional'));
    const { rows: [{ version }] } = await client.query('SELECT updated_at::text AS version FROM public.organization_subscriptions WHERE organization_id=$1', [org.id]);
    const change = { organization_id: org.id, version, product: 'professional', status: 'active', end_date: end, reason: 'Verified payment' };
    await asOwner(() => request('set_subscription', change));
    await assert.rejects(asOwner(() => request('set_subscription', change)), { code: '40001' });
    assert((await asOwner(() => request('clients', { search: 'Owner Console Test Workspace' }))).some(item =>
      item.id === org.id && item.subscription_status === 'active' && item.plan_tier === 'professional'));
  });

  await check('OWNER-04', 'AI snapshot requires owner MFA, redacts contact data and enforces usage limits', async () => {
    await asUser(staff, () => client.query("SELECT public.report_client_problem($1,'billing','Invoice export issue','Contact demo@example.test or +91 98765 43210 regarding the error.')", [org.id]));
    const data = await asOwner(() => request('ai_input'));
    assert(data.recent_reports.some(report => report.excerpt?.includes('[email]')));
    assert(!JSON.stringify(data).includes('demo@example.test'));
    assert(!JSON.stringify(data).includes('98765'));
    await assert.rejects(asOwner(() => request('ai_input')), { code: '54000' });
  });
}
