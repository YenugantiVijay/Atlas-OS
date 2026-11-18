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
  } catch (error) {
    recordTest('BATCH-OPENING-01', 'Batch opening reconciles without adding stock, is isolated and expires as a live balance after stock movement',
      false, error.message, error);
  }
}
