import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runTeamPayAcceptance({ client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId }) {
  const newMember = randomUUID();
  const email = 'invited-' + newMember + '@example.com';
  const location = randomUUID();
  const staff = randomUUID();
  const effective = '2026-01-01';
  const as = (userId, fn) => withRoleContext(client, { userId, role: userId ? 'authenticated' : 'anon' }, fn);
  const owner = fn => as(ownerAId, fn);
  const first = async (sql, args) => (await client.query(sql, args)).rows[0].result;
  const create = (address = email, role = 'viewer') => first(
    'SELECT public.create_team_invitation($1,$2,$3) AS result', [orgAId, address, role],
  );
  const accept = id => first('SELECT public.accept_team_invitation($1) AS result', [id]);
  const revoke = id => client.query('SELECT public.revoke_team_invitation($1,$2)', [orgAId,id]);
  const claim = id => first('SELECT public.claim_team_invite_delivery($1,$2) AS result', [orgAId,id]);
  const invitations = () => client.query('SELECT id,email,role FROM public.list_team_invitations($1)', [orgAId]);
  const correct = (revision, amount) => client.query(`
    INSERT INTO public.staff_pay_rate_corrections(organization_id,staff_id,effective_on,revision,basis,amount_paise,reason)
    VALUES ($1,$2,$3,$4,'monthly',$5,'Corrected agreement')`, [orgAId,staff,effective,revision,amount]);
  const history = () => client.query(`SELECT revision,amount_paise,reason,recorded_by,is_latest
    FROM public.staff_pay_rate_history WHERE staff_id=$1 ORDER BY revision`, [staff]);
  async function check(id, label, fn) {
    try {
      await fn();
      recordTest(id, label, true);
    } catch (error) {
      recordTest(id, label, false, null, error);
    }
  }

  await client.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,NULL)', [newMember,email]);
  await client.query("INSERT INTO public.memberships(organization_id,user_id,role) VALUES ($1,$2,'viewer')", [orgBId,newMember]);

  await check('TEAM-INVITE-01', 'An owner can issue an idempotent invitation and claim delivery for its verified target only', async () => {
    await assert.rejects(as(salesAId, () => create()), { code: '42501' });
    await assert.rejects(owner(() => create(email, 'owner')), { code: '22023' });
    const invite = await owner(() => create(email.toUpperCase()));
    assert.deepEqual(await owner(() => create()), invite);
    assert.equal((await as(salesAId, invitations)).rowCount, 0);
    assert.equal((await as(ownerBId, invitations)).rowCount, 0);
    assert.equal((await owner(invitations)).rowCount, 1);
    const delivery = await owner(() => claim(invite.id));
    assert.equal(delivery.email, email);
    await assert.rejects(owner(() => claim(invite.id)), { code: '23514' });
    await assert.rejects(as(salesAId, () => accept(invite.id)), { code: '42501' });
    await assert.rejects(as(newMember, () => accept(invite.id)), { code: '42501' });
    await client.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1', [newMember]);
    assert.equal(await as(newMember, () => accept(invite.id)), orgAId);
    assert.equal(await as(newMember, () => accept(invite.id)), orgAId);
    const directory = await owner(() => client.query('SELECT role,email FROM public.team_member_directory($1) WHERE user_id=$2', [orgAId,newMember]));
    assert.deepEqual(directory.rows, [{ role: 'viewer', email }]);
    assert.equal((await owner(invitations)).rowCount, 0);
    await assert.rejects(owner(() => create()), { code: '23505' });
    await assert.rejects(owner(() => revoke(invite.id)), { code: '23514' });
  });

  await check('TEAM-INVITE-02', 'Revoked and expired links cannot enroll a verified employee', async () => {
    const user = randomUUID();
    const address = 'pending-' + user + '@example.com';
    await client.query('INSERT INTO auth.users(id,email) VALUES ($1,$2)', [user,address]);
    let invite = await owner(() => create(address, 'inventory'));
    await assert.rejects(as(ownerBId, () => revoke(invite.id)), { code: '42501' });
    await owner(() => revoke(invite.id));
    await assert.rejects(as(user, () => accept(invite.id)), { code: '42501' });
    invite = await owner(() => create(address, 'inventory'));
    await client.query("UPDATE atlas_private.team_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [invite.id]);
    await assert.rejects(as(user, () => accept(invite.id)), { code: '42501' });
    assert.notEqual((await owner(() => create(address, 'inventory'))).id, invite.id);
    const member = await client.query('SELECT 1 FROM public.memberships WHERE organization_id=$1 AND user_id=$2', [orgAId,user]);
    assert.equal(member.rowCount, 0);
  });

  await check('STAFF-PAY-04', 'Same-date correction preserves the original pay and records an authoritative latest rate and actor', async () => {
    await owner(() => client.query("INSERT INTO public.staff_locations(id,organization_id,name) VALUES ($1,$2,'Pay test location')", [location,orgAId]));
    await owner(() => client.query("SELECT public.add_staff_profile($1,$2,'Pay test staff',$3,ARRAY[$4]::uuid[])", [orgAId,staff,effective,location]));
    await owner(() => client.query(`INSERT INTO public.staff_pay_rates(organization_id,staff_id,joining_on,effective_on,basis,amount_paise)
      VALUES ($1,$2,$3,$3,'monthly',1600000)`, [orgAId,staff,effective]));
    await assert.rejects(owner(() => correct(2,1600000)), { code: '23514' });
    await owner(() => correct(2,1750025));
    await assert.rejects(owner(() => correct(2,1850000)), { code: '40001' });
    await assert.rejects(owner(() => correct(4,1850000)), { code: '40001' });
    assert.deepEqual((await owner(history)).rows, [
      { revision: 1, amount_paise: '1600000', reason: null, recorded_by: ownerAId, is_latest: false },
      { revision: 2, amount_paise: '1750025', reason: 'Corrected agreement', recorded_by: ownerAId, is_latest: true },
    ]);
    await assert.rejects(as(salesAId, () => correct(2,1850000)), { code: '42501' });
    assert.equal((await as(salesAId, history)).rowCount, 0);
    assert.equal((await as(ownerBId, history)).rowCount, 0);
    await assert.rejects(as(null, history), { code: '42501' });
  });
}
