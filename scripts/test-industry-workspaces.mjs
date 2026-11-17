import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runIndustryWorkspaceAcceptance({
  client,
  withRoleContext,
  recordTest,
  orgAId,
  orgBId,
  ownerAId,
  ownerBId,
}) {
  const as = (userId, action) => withRoleContext(client, { userId, role: 'authenticated' }, action);
  const save = (tool, command, request = randomUUID()) =>
    as(ownerAId, () =>
      client.query('select public.apply_industry_operation($1,$2,$3,$4)', [
        orgAId,
        tool,
        request,
        command,
      ]),
    );
  const read = async (tool, user = ownerAId, org = orgAId) =>
    (await as(user, () => client.query('select public.industry_workspace($1,$2) as data', [org, tool])))
      .rows[0].data;
  const report = async (id, title, body) => {
    try {
      await body();
      recordTest(id, title, true);
    } catch (error) {
      recordTest(id, title, false, error.message, error);
    }
  };
  const studio = 'banner-print-studio';
  const stalls = 'ice-cream-stalls';
  const depot = 'ice-cream-distribution';
  const { today } = await read(studio);

  await report('IND-01', 'Studio quote, proof, balance and due-date series', async () => {
    const id = randomUUID();
    const create = {
      kind: 'create',
      title: 'Store banners',
      customer: 'Fixture customer',
      due_on: today,
      fulfillment: 'pickup',
      lines: [
        { label: 'Banner', unit: 'sq ft', quantity: 12.5, rate_paise: 2000 },
        { label: 'Sign boards', unit: 'piece', quantity: 2, rate_paise: 15000 },
      ],
    };
    await save(studio, create, id);
    await save(studio, create, id);
    await assert.rejects(save(studio, { ...create, title: 'Different' }, id), /different details/i);
    await save(studio, { kind: 'advance', job_id: id, amount_paise: 20000 });
    await save(studio, { kind: 'proof', job_id: id, detail: 'Artwork v2' });
    await assert.rejects(
      save(studio, { kind: 'progress', job_id: id, expected_stage: 'approved' }),
      /stage changed/i,
    );
    const report = await read(studio);
    assert.deepEqual(report.series, [0, 1, 0, 0]);
    assert.equal(report.jobs[0].quoted_paise, 55000);
    assert.equal(report.jobs[0].paid_paise, 20000);
    assert.equal(report.jobs[0].proof_history[0], 'Artwork v2');
    for (const expected_stage of ['proof', 'approved', 'printing', 'ready']) {
      await save(studio, { kind: 'progress', job_id: id, expected_stage });
    }
    assert.deepEqual((await read(studio)).series, [0, 0, 0, 0]);
  });

  await report('IND-02', 'Stall stock, waste, till close and independent units', async () => {
    const entry = { site: 'stall one', sku: 'vanilla', unit: 'scoop' };
    await save(stalls, { ...entry, kind: 'receive', quantity: 20 });
    await save(stalls, {
      ...entry,
      kind: 'sale',
      quantity: 3,
      amount_paise: 9000,
      method: 'cash',
      detail: 'Cone',
    });
    await save(stalls, {
      ...entry,
      kind: 'sale',
      quantity: 2,
      amount_paise: 6000,
      method: 'upi',
      detail: 'Cup',
    });
    await save(stalls, { ...entry, kind: 'waste', quantity: 1, detail: 'Melted' });
    await assert.rejects(
      save(stalls, { ...entry, kind: 'waste', quantity: 15, detail: 'Damaged' }),
      /exceeds stock/i,
    );
    await save(stalls, { ...entry, kind: 'count', quantity: 13 });
    await save(stalls, { site: 'stall one', kind: 'close', amount_paise: 8800 });
    await assert.rejects(save(stalls, { ...entry, kind: 'receive', quantity: 1 }), /already closed/i);
    const data = await read(stalls);
    assert.equal(data.stock[0].quantity, 13);
    assert.deepEqual(data.series, [{ day: today, unit: 'scoop', first: 5, second: 1 }]);
    assert.deepEqual(data.tills, [{ site: 'STALL ONE', cash: 9000, upi: 6000, counted: 8800 }]);
  });

  await report(
    'IND-03',
    'Case quantity commitments, partial dispatch, expiry and returned stock',
    async () => {
      const entry = { site: 'freezer A', sku: 'vanilla', unit: 'case', batch: 'LOT-01' };
      const expiry = await client.query(
        "select (timezone('Asia/Kolkata',now())::date+30)::text as date",
      );
      await save(depot, { ...entry, kind: 'receive', quantity: 5000, expiry: expiry.rows[0].date });
      await save(depot, {
        ...entry,
        batch: '',
        kind: 'promise',
        quantity: 3200,
        reference: 'DROP-10',
        detail: 'Fixture outlet',
      });
      await save(depot, { ...entry, kind: 'dispatch', quantity: 2200, reference: 'DROP-10' });
      await assert.rejects(
        save(depot, { ...entry, kind: 'dispatch', quantity: 1001, reference: 'DROP-10' }),
        /exceeds the unshipped/i,
      );
      await save(depot, {
        ...entry,
        kind: 'return',
        quantity: 20,
        reference: 'DROP-10',
        detail: 'Restock',
        amount_paise: 3600,
      });
      await save(depot, {
        ...entry,
        kind: 'return',
        quantity: 10,
        reference: 'DROP-10',
        detail: 'Damaged',
        amount_paise: 1800,
      });
      await assert.rejects(
        save(depot, {
          ...entry,
          kind: 'return',
          quantity: 2171,
          reference: 'DROP-10',
          detail: 'Damaged',
        }),
        /exceeds shipped/i,
      );
      const data = await read(depot);
      assert.equal(data.stock[0].quantity, 2820);
      assert.deepEqual(data.series, [{ day: today, unit: 'case', first: 3200, second: 2200 }]);
      assert.equal(data.orders[0].promised - data.orders[0].dispatched, 1000);
    },
  );

  await report(
    'IND-04',
    'Separate tenants and no direct client access to industry ledgers',
    async () => {
      await assert.rejects(read(stalls, ownerBId, orgAId), /read access/i);
      await assert.rejects(
        as(ownerBId, () =>
          client.query('select public.apply_industry_operation($1,$2,$3,$4)', [
            orgAId,
            stalls,
            randomUUID(),
            { kind: 'close', site: 'STALL ONE' },
          ]),
        ),
        /write access/i,
      );
      await assert.rejects(
        as(ownerAId, () => client.query('select * from atlas_private.ice_events')),
        { code: '42501' },
      );
      assert.deepEqual((await read(stalls, ownerBId, orgBId)).stock, []);
    },
  );
}
