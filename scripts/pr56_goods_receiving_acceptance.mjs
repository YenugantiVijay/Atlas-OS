import crypto from 'node:crypto';

/** PR #56 acceptance: disposable PostgreSQL only, never hosted Supabase. */
export async function runGoodsReceivingAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId,
}) {
  // Dedicated test products ensure this slice cannot change the baseline stock
  // counts assumed by the other master lifecycle acceptance scenarios.
  const productAId=crypto.randomUUID(), productBId=crypto.randomUUID();
  const foreignProductId=crypto.randomUUID();
  const supplierA=crypto.randomUUID(), supplierB=crypto.randomUUID();
  await client.query(
    "INSERT INTO public.products(id,organization_id,sku,name,category,uom,purchase_cost,selling_price,tax_rate) VALUES($1::uuid,$2::uuid,'GRN56-A','Receiving Fixture A','Test','Bag',20,30,5),($3::uuid,$2::uuid,'GRN56-B','Receiving Fixture B','Test','Nos',50,70,5),($4::uuid,$5::uuid,'GRN56-FOREIGN','Receiving Foreign','Test','Nos',10,20,5)",
    [productAId,orgAId,productBId,foreignProductId,orgBId]
  );
  const receiptId=crypto.randomUUID(), secondId=crypto.randomUUID(), invalidId=crypto.randomUUID();
  await client.query(
    "INSERT INTO public.suppliers(id,organization_id,name) VALUES($1::uuid,$2::uuid,'Supplier A'),($3::uuid,$4::uuid,'Supplier B')",
    [supplierA,orgAId,supplierB,orgBId]
  );
  const items=[
    {productId:productAId,packageCounts:[12,10,11],looseUnits:5,unitCost:1120.50},
    {productId:productBId,packageCounts:[5,5],looseUnits:1,unitCost:50}
  ];
  const save=(org,id,supplier,lines=items,invoice='INV-PR56')=>client.query(
    "SELECT public.save_goods_receipt_draft($1::uuid,$2::uuid,$3::uuid,$4::text,'2026-11-10'::date,$5::text,$6::jsonb) AS result",
    [org,id,supplier,invoice,'Truck 12; sealed packaging',JSON.stringify(lines)]
  );
  const post=(org,id)=>client.query(
    'SELECT public.post_goods_receipt($1::uuid,$2::uuid) AS result',[org,id]
  );
  const asA=(fn)=>withRoleContext(client,{role:'authenticated',userId:ownerAId},fn);
  const asB=(fn)=>withRoleContext(client,{role:'authenticated',userId:ownerBId},fn);
  const stock=async(id)=>{
    const r=await client.query(
      'SELECT COALESCE(sum(quantity_change),0)::integer AS n FROM public.stock_movements WHERE organization_id=$1::uuid AND product_id=$2::uuid',
      [orgAId,id]
    );
    return r.rows[0].n;
  };
  const beforeA=await stock(productAId), beforeB=await stock(productBId);

  const perms=await client.query(
    "SELECT has_table_privilege('authenticated','public.goods_receipts','INSERT') AS can_insert, has_table_privilege('authenticated','public.goods_receipts','UPDATE') AS can_update, has_table_privilege('authenticated','public.goods_receipts','SELECT') AS can_read, has_function_privilege('anon','public.save_goods_receipt_draft(uuid,uuid,uuid,text,date,text,jsonb)','EXECUTE') AS anon_save, has_function_privilege('anon','public.post_goods_receipt(uuid,uuid)','EXECUTE') AS anon_post"
  );
  const p=perms.rows[0];
  recordTest('GRN56-01','Only authorized RPC can write receiving rows',
    !p.can_insert&&!p.can_update&&p.can_read&&!p.anon_save&&!p.anon_post,JSON.stringify(p));

  let err;
  try {await asA(()=>save(orgAId,invalidId,supplierA,[
    {productId:productAId,packageCounts:[12,0,10],looseUnits:0,unitCost:10}
  ],'INVALID-CARTON'));} catch(e){err=e;}
  recordTest('GRN56-02','Zero-size carton cannot be saved',err?.code==='22023','sqlstate='+(err?.code||'none'));

  err=null;
  try {await asA(()=>save(orgAId,invalidId,supplierB,items,'OTHER-ORG-SUPPLIER'));}
  catch(e){err=e;}
  recordTest('GRN56-03','Other-tenant supplier denied',err?.code==='42501','sqlstate='+(err?.code||'none'));

  err=null;
  try {await asA(()=>save(orgAId,invalidId,supplierA,[
    {productId:foreignProductId,packageCounts:[10],looseUnits:0,unitCost:10}
  ],'OTHER-ORG-PRODUCT'));}catch(e){err=e;}
  recordTest('GRN56-04','Other-tenant product denied',err?.code==='42501','sqlstate='+(err?.code||'none'));

  const draft=await asA(()=>save(orgAId,receiptId,supplierA));
  recordTest('GRN56-05','Owner saves authorized draft',draft.rows[0]?.result?.status==='DRAFT',
    JSON.stringify(draft.rows[0]?.result));

  const deltaDraft=[await stock(productAId)-beforeA,await stock(productBId)-beforeB];
  recordTest('GRN56-06','Draft creates no stock movements',
    deltaDraft.every(x=>x===0),JSON.stringify(deltaDraft));

  await asA(()=>save(orgAId,receiptId,supplierA));
  const count=await client.query('SELECT count(*)::integer AS n FROM public.goods_receipts WHERE id=$1::uuid',[receiptId]);
  recordTest('GRN56-07','Duplicate draft-save retry does not duplicate receipt',
    count.rows[0].n===1,'count='+count.rows[0].n);

  err=null;
  try{await asB(()=>post(orgAId,receiptId));}catch(e){err=e;}
  recordTest('GRN56-08','Foreign owner cannot post',err?.code==='42501','sqlstate='+(err?.code||'none'));

  err=null;
  try{await asA(()=>save(orgAId,secondId,supplierA,items));}catch(e){err=e;}
  recordTest('GRN56-09','Duplicate supplier invoice blocked',err?.code==='23505','sqlstate='+(err?.code||'none'));

  const posted=await asA(()=>post(orgAId,receiptId));
  const replay=await asA(()=>post(orgAId,receiptId));
  recordTest('GRN56-10','Posting is idempotent',
    posted.rows[0]?.result?.idempotent_replay===false &&
    replay.rows[0]?.result?.idempotent_replay===true,
    JSON.stringify({posted:posted.rows[0]?.result,replay:replay.rows[0]?.result}));

  // A signed-in sales member can access ordinary products but not private
  // supplier purchase rates or the GRN posting authority.
  const salesUserId=crypto.randomUUID();
  await client.query("INSERT INTO auth.users(id,email) VALUES($1::uuid,$2::text)",
    [salesUserId,'grn56-sales-'+salesUserId+'@example.test']);
  await client.query("INSERT INTO public.memberships(organization_id,user_id,role,is_active) VALUES($1::uuid,$2::uuid,'sales',true)",
    [orgAId,salesUserId]);
  const salesRead=await withRoleContext(client,{role:'authenticated',userId:salesUserId},
    ()=>client.query("SELECT id FROM public.goods_receipts WHERE organization_id=$1::uuid",[orgAId]));
  recordTest('GRN56-17','Sales role cannot view supplier purchase-rate snapshots',
    salesRead.rows.length===0,'rows='+salesRead.rows.length);
  let salesPostError=null;
  try {await withRoleContext(client,{role:'authenticated',userId:salesUserId},
    ()=>post(orgAId,receiptId));}catch(e){salesPostError=e;}
  recordTest('GRN56-18','Sales role cannot post a receipt',
    salesPostError?.code==='42501','sqlstate='+(salesPostError?.code||'none'));

  const delta=[await stock(productAId)-beforeA,await stock(productBId)-beforeB];
  recordTest('GRN56-11','Variable cartons post exact stock ONCE (38 and 11)',
    delta[0]===38&&delta[1]===11,JSON.stringify(delta));

  const movements=await client.query(
    "SELECT product_id,quantity_change,movement_type,reference_type FROM public.stock_movements WHERE organization_id=$1::uuid AND reference_id=$2::uuid",
    [orgAId,receiptId]
  );
  recordTest('GRN56-12','Two GOODS_RECEIVED movements linked to receipt',
    movements.rows.length===2 && movements.rows.every(x=>x.movement_type==='GOODS_RECEIVED'&&x.reference_type==='PURCHASE_RECEIPT'),
    JSON.stringify(movements.rows));

  const audit=await client.query(
    "SELECT count(*)::integer AS n FROM public.audit_events WHERE organization_id=$1::uuid AND entity_id=$2::uuid AND action='POST_GOODS_RECEIPT'",
    [orgAId,receiptId]
  );
  recordTest('GRN56-13','One audit event on posted receipt',audit.rows[0].n===1,'count='+audit.rows[0].n);

  err=null;try{await asA(()=>save(orgAId,receiptId,supplierA));}catch(e){err=e;}
  recordTest('GRN56-14','Posted receipt immutable through draft endpoint',err?.code==='23514','sqlstate='+(err?.code||'none'));

  err=null;try{await asA(()=>client.query("UPDATE public.goods_receipts SET notes='tampered' WHERE id=$1::uuid",[receiptId]));}
  catch(e){err=e;}
  recordTest('GRN56-15','Direct UPDATE denied',err?.code==='42501','sqlstate='+(err?.code||'none'));

  const master=await client.query('SELECT purchase_cost FROM public.products WHERE id=$1::uuid',[productAId]);
  recordTest('GRN56-16','Receipt cost snapshot does not rewrite master cost',
    Number(master.rows[0].purchase_cost)===20,'purchase_cost='+master.rows[0].purchase_cost);
}
