import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runBatchOpeningAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId, salesAId,
}) {
  try {
    const productId = randomUUID();
    await client.query(
      `INSERT INTO public.products (id, organization_id, name, sku, category, uom, purchase_cost, selling_price)
       VALUES ($1,$2,'Batch count fixture',$3,'Switchgear','Nos',10,20)`, [productId, orgAId, productId],
    );
    await client.query(
      `INSERT INTO public.stock_movements (organization_id, product_id, quantity_change, movement_type)
       VALUES ($1,$2,100,'OPENING_STOCK')`, [orgAId, productId],
    );
    const { today } = (await client.query(
      "SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)::text AS today",
    )).rows[0];
    const as = (userId, fn) => withRoleContext(client, { userId, role: 'authenticated' }, fn);
    const read = async (user = ownerAId, org = orgAId) => (await as(user, () =>
      client.query('SELECT public.get_stock_batch_opening($1,$2) AS result', [org, productId]),
    )).rows[0].result;
    const save = (lines, user = ownerAId, org = orgAId, date = today, expected = 1) => as(user, () => client.query(
      'SELECT public.record_stock_batch_opening($1,$2,$3,$4,$5)', [org, productId, date, JSON.stringify(lines), expected],
    ));
    const main = { godown: 'Main Godown', batch_number: '0008', expiry_date: '2026-03-31', quantity: 60 };
    const annex = { ...main, godown: 'Annex', quantity: 40 };
    const valid = [main, annex];

    assert.deepEqual(await read(), { ledger_quantity: 100, ledger_movement_count: 1, opening: null });
    await assert.rejects(save(valid, salesAId), { code: '42501' });
    await assert.rejects(save(valid, ownerBId, orgAId), { code: '42501' });
    await assert.rejects(save(valid, ownerBId, orgBId), { code: '23503' });
    await assert.rejects(read(ownerBId, orgAId), { code: '42501' });
    await assert.rejects(read(ownerBId, orgBId), { code: '23503' });
    await assert.rejects(as(ownerAId, () => client.query('SELECT * FROM public.stock_batch_opening_lines')), { code: '42501' });
    await assert.rejects(save(valid, ownerAId, orgAId, '2020-01-01'), /dated today/i);
    await assert.rejects(save([main]), /add up/i);
    await assert.rejects(save([{ ...main, quantity: 59.5 }, annex]), /whole quantity/i);
    await assert.rejects(save([main, { ...annex, godown: 'main   godown' }]), /once per godown/i);
    await assert.rejects(save([main, { ...annex, expiry_date: null }]), /same expiry/i);
    assert.equal((await read()).opening, null);

    await assert.rejects(save(valid, ownerAId, orgAId, today, 0), /ledger changed/i);
    await save(valid);
    await save([...valid].reverse());
    await assert.rejects(save([{ ...main, quantity: 59 }, { ...annex, quantity: 41 }]), /already exists/i);
    assert.deepEqual(await read(), {
      ledger_quantity: 100, ledger_movement_count: 1,
      opening: { counted_on: today, current: true, quantity: 100, lines: [annex, main] },
    });

    // Even offsetting new movements invalidate the opening as a live balance.
    for (const change of [1, -1]) {
      await as(ownerAId, () => client.query('SELECT public.record_stock_adjustment($1,$2,$3,$4,$5)',
        [orgAId, productId, change, 'Batch opening acceptance', randomUUID()]));
    }
    assert.equal((await read()).ledger_quantity, 100);
    assert.equal((await read()).opening.current, false);
    assert.equal((await read()).opening.quantity, 100);
    recordTest('BATCH-OPENING-01', 'Batch opening reconciles without adding stock, is isolated and expires as a live balance after stock movement', true);
    const approvalState = async () => (await as(ownerAId, () =>
      client.query('SELECT public.get_stock_count_approval($1,$2) AS result', [orgAId, productId]),
    )).rows[0].result;
    const approve = async (rows, destination, version, previous = null, user = ownerAId) => (await as(user, () =>
      client.query('SELECT public.approve_stock_count($1,$2,$3,$4,$5,$6,$7) AS id',
        [orgAId, productId, today, JSON.stringify(rows), version, previous, destination]),
    )).rows[0].id;

    try {
      const usable = { godown: 'Main Godown', batch_number: '0012', expiry_date: null, quantity: 94 };
      const expired = { godown: 'Main Godown', batch_number: '0008', expiry_date: today, quantity: 4 };
      const current = await approvalState();
      const version = current.ledger_movement_count;
      await assert.rejects(approve([usable, expired], 'Expiry', version, null, salesAId), { code: '42501' });
      await assert.rejects(approve([usable, expired], 'Main Godown', version), /separate expiry godown/i);
      await assert.rejects(approve([usable, expired], 'Expiry', version - 1), { code: '40001' });
      const approved = await approve([usable, expired], 'Expiry', version);
      assert.equal(await approve([expired, usable], 'Expiry', version), approved);

      const state = await approvalState();
      assert.equal(state.ledger_quantity, 98);
      assert.equal(state.approval.sellable_quantity, 94);
      assert.equal(state.approval.quarantine_quantity, 4);
      assert.equal(state.approval.current, true);
      assert.deepEqual(state.approval.lines, [{ ...expired, godown: 'Expiry' }, usable]);
      await assert.rejects(approve([usable], null, state.ledger_movement_count, approved), /previously quarantined/i);

      const deduct = (quantity) => as(ownerAId, () =>
        client.query('SELECT public.record_stock_adjustment($1,$2,$3,$4,$5)',
          [orgAId, productId, quantity, 'Quarantine acceptance', randomUUID()]),
      );
      await assert.rejects(deduct(-95), /only 94 sellable units/i);
      await deduct(-94);
      await assert.rejects(deduct(-1), /only 0 sellable units/i);
      assert.equal((await approvalState()).ledger_quantity, 4);

      const after = await approvalState();
      await approve([{ ...expired, godown: 'Expiry', quantity: 0 }], null, after.ledger_movement_count, approved);
      assert.equal((await approvalState()).ledger_quantity, 0);
      assert.equal((await approvalState()).approval.quarantine_quantity, 0);
      recordTest('BATCH-APPROVAL-01', 'Approved count posts one delta, transfers expiry, protects sellable stock, and requires recount of quarantined batches', true);
    } catch (error) {
      recordTest('BATCH-APPROVAL-01', 'Approved count posts one delta, transfers expiry, protects sellable stock, and requires recount of quarantined batches',
        false, error.message, error);
    }
  } catch (error) {
    recordTest('BATCH-OPENING-01', 'Batch opening reconciles without adding stock, is isolated and expires as a live balance after stock movement',
      false, error.message, error);
  }
}
