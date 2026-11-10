import crypto from 'node:crypto';

/** Only the disposable PostgreSQL fixture; never mutate a hosted Supabase project. */
export async function runSupplierPriceHistoryAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId,
}) {
  const asA=(fn)=>withRoleContext(client,{role:'authenticated',userId:ownerAId},fn);
  const asB=(fn)=>withRoleContext(client,{role:'authenticated',userId:ownerBId},fn);
  const entry=crypto.randomUUID(), wrong=crypto.randomUUID();
  const { rows: fixture } = await client.query(
    "SELECT gr.id AS receipt_id, gr.supplier_id, (line->>'productId')::uuid AS product_id, (line->>'unitCost')::numeric AS cost FROM public.goods_receipts gr CROSS JOIN LATERAL jsonb_array_elements(gr.lines) t(line) WHERE gr.organization_id=$1::uuid AND gr.supplier_invoice_number='INV-PR56' AND gr.status='POSTED' AND line->>'sku'='GRN56-A'",
    [orgAId]
  );
  const f=fixture[0];
  if (!f) throw new Error('Missing PR56 posted receipt test fixture for PR57 acceptance');
  const save=(org,id,supplier,product,rate=1160,note='Supplier rate revision circular #57',date='2026-11-10')=>client.query(
    "SELECT public.record_supplier_price_quote($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::numeric,$6::date,$7::text) AS result",
    [org,id,supplier,product,rate,date,note]
  );
  const allRates=async()=>client.query(
    'SELECT * FROM public.supplier_price_history WHERE organization_id=$1::uuid AND supplier_id=$2::uuid AND product_id=$3::uuid ORDER BY effective_on DESC, recorded_at DESC',
    [orgAId,f.supplier_id,f.product_id]
  );
  const priceBefore=await client.query(
    'SELECT purchase_cost,selling_price FROM public.products WHERE id=$1::uuid',[f.product_id]
  );
  const stockBefore=await client.query(
    'SELECT coalesce(sum(quantity_change),0)::integer AS stock FROM public.stock_movements WHERE organization_id=$1::uuid AND product_id=$2::uuid',
    [orgAId,f.product_id]
  );
  const history=await allRates();
  recordTest('RATE57-01','Posted GRN produces an actual purchase-price timeline entry',
    history.rows.length===1 && history.rows[0].source_type==='GOODS_RECEIPT' &&
    history.rows[0].source_receipt_id===f.receipt_id &&
    Number(history.rows[0].unit_cost)===1120.5 &&
    Number(history.rows[0].unit_cost)===Number(f.cost),
    JSON.stringify(history.rows.map(x=>({source:x.source_type,rate:x.unit_cost}))));
  const grants=await client.query(
    "SELECT has_table_privilege('authenticated','public.supplier_price_history','SELECT') AS read_allowed, has_table_privilege('authenticated','public.supplier_price_history','INSERT') AS insert_allowed,has_table_privilege('authenticated','public.supplier_price_history','UPDATE') AS update_allowed,has_table_privilege('authenticated','public.supplier_price_history','DELETE') AS delete_allowed,has_function_privilege('anon','public.record_supplier_price_quote(uuid,uuid,uuid,uuid,numeric,date,text)','EXECUTE') AS anon_call"
  );
  const g=grants.rows[0];
  recordTest('RATE57-02','Price history is read-only with no anonymous quote RPC',
    g.read_allowed&&!g.insert_allowed&&!g.update_allowed&&!g.delete_allowed&&!g.anon_call,
    JSON.stringify(g));

  const result=await asA(()=>save(orgAId,entry,f.supplier_id,f.product_id));
  recordTest('RATE57-03','Owner records a supplier notice with correct previous rate',
    result.rows[0]?.result?.idempotent_replay===false &&
    Number(result.rows[0]?.result?.previous_rate)===1120.5 &&
    Number(result.rows[0]?.result?.recorded_rate)===1160,
    JSON.stringify(result.rows[0]?.result));
  const replay=await asA(()=>save(orgAId,entry,f.supplier_id,f.product_id));
  recordTest('RATE57-04','Quote retry is an idempotent no-op',
    replay.rows[0]?.result?.idempotent_replay===true,
    JSON.stringify(replay.rows[0]?.result));
  let conflict=null;
  try {await asA(()=>save(orgAId,entry,f.supplier_id,f.product_id,1190));}
  catch(e){conflict=e;}
  recordTest('RATE57-05','Same entry UUID with changed price is rejected',
    conflict?.code==='23505','sqlstate='+(conflict?.code||'none'));

  const after=await allRates();
  recordTest('RATE57-06','Quotes append; purchase receipt price remains unchanged',
    after.rows.length===2 &&
    after.rows.some(x=>x.source_type==='GOODS_RECEIPT' && Number(x.unit_cost)===1120.5) &&
    after.rows.some(x=>x.source_type==='SUPPLIER_QUOTE' && Number(x.unit_cost)===1160),
    JSON.stringify(after.rows.map(x=>({source:x.source_type,rate:x.unit_cost}))));

  let invalid=null;
  try{await asA(()=>save(orgAId,wrong,f.supplier_id,f.product_id,-1));}
  catch(e){invalid=e;}
  recordTest('RATE57-07','Negative purchase rate is rejected',
    invalid?.code==='22023','sqlstate='+(invalid?.code||'none'));
  invalid=null;
  try{await asA(()=>save(orgAId,wrong,f.supplier_id,f.product_id,1160,'Circular', '2099-01-01'));}
  catch(e){invalid=e;}
  recordTest('RATE57-08','Future effective date is rejected',
    invalid?.code==='22023','sqlstate='+(invalid?.code||'none'));
  const {rows: foreign}=await client.query(
    'SELECT id FROM public.suppliers WHERE organization_id=$1::uuid LIMIT 1',[orgBId]
  );
  invalid=null;
  try{await asA(()=>save(orgAId,wrong,foreign[0].id,f.product_id));}
  catch(e){invalid=e;}
  recordTest('RATE57-09','Supplier from another tenant cannot be referenced',
    invalid?.code==='42501','sqlstate='+(invalid?.code||'none'));
  invalid=null;
  try{await asB(()=>save(orgAId,wrong,f.supplier_id,f.product_id));}
  catch(e){invalid=e;}
  recordTest('RATE57-10','Other organization owner cannot submit quote in this org',
    invalid?.code==='42501','sqlstate='+(invalid?.code||'none'));

  const foreignRead=await asB(()=>client.query(
    'SELECT id FROM public.supplier_price_history WHERE organization_id=$1::uuid',[orgAId]
  ));
  recordTest('RATE57-11','Cross-tenant timeline is invisible',
    foreignRead.rows.length===0,'rows='+foreignRead.rows.length);

  const {rows: salesMember}=await client.query(
    "SELECT m.user_id FROM public.memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.organization_id=$1::uuid AND m.role='sales' AND u.email LIKE 'grn56-sales-%' LIMIT 1",
    [orgAId]
  );
  if (!salesMember[0]) throw new Error('Missing PR56 sales-role fixture');
  const salesRead=await withRoleContext(client,{role:'authenticated',userId:salesMember[0].user_id},
    ()=>client.query('SELECT id FROM public.supplier_price_history WHERE organization_id=$1::uuid',[orgAId]));
  recordTest('RATE57-12','Same-org sales cannot see supplier cost history',
    salesRead.rows.length===0,'rows='+salesRead.rows.length);
  invalid=null;
  try {await withRoleContext(client,{role:'authenticated',userId:salesMember[0].user_id},
    ()=>save(orgAId,wrong,f.supplier_id,f.product_id));}
  catch(e){invalid=e;}
  recordTest('RATE57-13','Same-org sales cannot record purchase-rate quotes',
    invalid?.code==='42501','sqlstate='+(invalid?.code||'none'));

  let forbidden=null;
  try{await asA(()=>client.query(
    "INSERT INTO public.supplier_price_history(id,organization_id,supplier_id,supplier_name,product_id,product_name,product_sku,product_uom,unit_cost,effective_on,source_type,actor_id) VALUES($1::uuid,$2::uuid,$3::uuid,'Tamper',$4::uuid,'Tamper','SKU','Nos',1,current_date,'SUPPLIER_QUOTE',$5::uuid)",
    [wrong,orgAId,f.supplier_id,f.product_id,ownerAId]
  ));}catch(e){forbidden=e;}
  recordTest('RATE57-14','Direct authenticated INSERT of rate history denied',
    forbidden?.code==='42501','sqlstate='+(forbidden?.code||'none'));

  forbidden=null;
  try{await client.query('UPDATE public.supplier_price_history SET unit_cost=1 WHERE id=$1::uuid',[entry]);}
  catch(e){forbidden=e;}
  recordTest('RATE57-15','Even privileged UPDATE is blocked by append-only trigger',
    forbidden?.code==='23514','sqlstate='+(forbidden?.code||'none'));

  const audit=await client.query(
    "SELECT count(*)::integer AS n FROM public.audit_events WHERE organization_id=$1::uuid AND entity_id=$2::uuid AND action='RECORD_SUPPLIER_PRICE'",
    [orgAId,entry]
  );
  recordTest('RATE57-16','Supplier quote is audited once, not on replay',
    audit.rows[0].n===1,'count='+audit.rows[0].n);
  const priceAfter=await client.query(
    'SELECT purchase_cost,selling_price FROM public.products WHERE id=$1::uuid',[f.product_id]
  );
  const stockAfter=await client.query(
    'SELECT coalesce(sum(quantity_change),0)::integer AS stock FROM public.stock_movements WHERE organization_id=$1::uuid AND product_id=$2::uuid',
    [orgAId,f.product_id]
  );
  recordTest('RATE57-17','Quote history does not change stock, purchase-cost master or selling price',
    Number(priceBefore.rows[0].purchase_cost)===Number(priceAfter.rows[0].purchase_cost) &&
    Number(priceBefore.rows[0].selling_price)===Number(priceAfter.rows[0].selling_price) &&
    stockBefore.rows[0].stock===stockAfter.rows[0].stock,
    JSON.stringify({before:priceBefore.rows[0],after:priceAfter.rows[0],stockBefore:stockBefore.rows[0].stock,stockAfter:stockAfter.rows[0].stock}));

  // Confirm the trigger really fires only at GRN posting, not draft creation.
  const anotherReceipt=crypto.randomUUID();
  const newLines=[{productId:f.product_id,packageCounts:[2],looseUnits:0,unitCost:980}];
  await asA(()=>client.query(
    "SELECT public.save_goods_receipt_draft($1::uuid,$2::uuid,$3::uuid,$4::text,$5::date,$6::text,$7::jsonb)",
    [orgAId,anotherReceipt,f.supplier_id,'GRN57-PRICE-TEST','2026-11-10','Second delivery',JSON.stringify(newLines)]
  ));
  const beforePost=await allRates();
  recordTest('RATE57-18','Saving a draft does not capture a purchase rate',
    beforePost.rows.length===2,'rate_count='+beforePost.rows.length);
  const nextPost=await asA(()=>client.query(
    'SELECT public.post_goods_receipt($1::uuid,$2::uuid) AS result',[orgAId,anotherReceipt]
  ));
  const postedRates=await allRates();
  recordTest('RATE57-19','Posting a second GRN atomically captures its actual paid rate',
    nextPost.rows[0]?.result?.idempotent_replay===false &&
    postedRates.rows.length===3 &&
    postedRates.rows.some(x=>x.source_receipt_id===anotherReceipt &&
      x.source_type==='GOODS_RECEIPT' && Number(x.unit_cost)===980),
    'rate_count='+postedRates.rows.length);
  const nextReplay=await asA(()=>client.query(
    'SELECT public.post_goods_receipt($1::uuid,$2::uuid) AS result',[orgAId,anotherReceipt]
  ));
  const replayRates=await allRates();
  recordTest('RATE57-20','GRN post replay does not duplicate any supplier price event',
    nextReplay.rows[0]?.result?.idempotent_replay===true && replayRates.rows.length===3,
    'rate_count='+replayRates.rows.length);

  // Accounts staff can read sensitive cost snapshots but cannot create quotes.
  const accountsUid=crypto.randomUUID();
  await client.query('INSERT INTO auth.users(id,email) VALUES($1::uuid,$2::text)',
    [accountsUid,'pr57-accounts-'+accountsUid+'@example.test']);
  await client.query("INSERT INTO public.memberships(organization_id,user_id,role,is_active) VALUES($1::uuid,$2::uuid,'accounts',true)",
    [orgAId,accountsUid]);
  const accountRead=await withRoleContext(client,{role:'authenticated',userId:accountsUid},
    ()=>client.query('SELECT count(*)::integer AS n FROM public.supplier_price_history WHERE organization_id=$1::uuid',[orgAId]));
  recordTest('RATE57-21','Accounts can read own-company supplier rate history',
    accountRead.rows[0].n>=3,'row_count='+accountRead.rows[0].n);
  let accountsWriteError=null;
  try{await withRoleContext(client,{role:'authenticated',userId:accountsUid},
    ()=>save(orgAId,crypto.randomUUID(),f.supplier_id,f.product_id));}catch(e){accountsWriteError=e;}
  recordTest('RATE57-22','Accounts cannot record manual supplier quotes',
    accountsWriteError?.code==='42501','sqlstate='+(accountsWriteError?.code||'none'));
}
