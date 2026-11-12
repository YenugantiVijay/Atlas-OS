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

  const deliveryProduct = crypto.randomUUID();
  await client.query(
    "INSERT INTO public.products(id,organization_id,sku,name,category,uom,purchase_cost,selling_price,tax_rate) VALUES($1,$2,'GRN-DELIVERY','Delivery Fixture','Test','Nos',20,30,5)",
    [deliveryProduct,orgAId],
  );
  const checkedId = crypto.randomUUID();
  const checkedLine = { productId:deliveryProduct,packageCounts:[40,40],looseUnits:18,unitCost:21.5,
    billedUnits:100,damagedUnits:3,usableUnits:999,missingUnits:999 };
  const saveChecked = (id, invoice, line = checkedLine) => client.query(
    "SELECT public.save_goods_receipt_delivery_draft($1,$2,$3,$4,'2026-11-10'::date,'',$5::jsonb) AS result",
    [orgAId,id,supplierA,invoice,JSON.stringify([line])],
  );
  const storedLine = async (id) => (await client.query(
    'SELECT lines->0 AS line FROM public.goods_receipts WHERE id=$1',[id],
  )).rows[0]?.line;

  await asA(() => saveChecked(checkedId,'INV-DELIVERY'));
  const savedLine = await storedLine(checkedId);
  recordTest('GRN-DELIVERY-01','Draft derives the 98 received, 95 usable and 2 missing counts without moving stock',
    savedLine?.totalUnits===98 && savedLine.usableUnits===95 && savedLine.billedUnits===100 &&
    savedLine.damagedUnits===3 && savedLine.missingUnits===2 && await stock(deliveryProduct)===0,
    JSON.stringify(savedLine));

  const errorCode = async (fn) => {
    try { await fn(); return null; }
    catch (error) { return error.code; }
  };
  const damageError = await errorCode(() => asA(() => saveChecked(crypto.randomUUID(),'INV-INVALID-DAMAGE',
    {...checkedLine,damagedUnits:99})));
  const billError = await errorCode(() => asA(() => saveChecked(crypto.randomUUID(),'INV-INVALID-BILL',
    {...checkedLine,billedUnits:100.5})));
  const legacyEdit = await errorCode(() => asA(() => save(orgAId,checkedId,supplierA,
    [{productId:deliveryProduct,packageCounts:[98],looseUnits:0,unitCost:21.5}],'INV-DELIVERY')));
  recordTest('GRN-DELIVERY-02','Invalid quantities and legacy edits cannot overwrite a checked draft',
    damageError==='22023' && billError==='22023' && legacyEdit==='22023' &&
    (await storedLine(checkedId))?.usableUnits===95,
    JSON.stringify({damageError,billError,legacyEdit}));
  const foreignDelivery = await errorCode(() => asB(() => saveChecked(crypto.randomUUID(),'INV-FOREIGN-DELIVERY')));
  const deliveryPermission = (await client.query(
    "SELECT has_function_privilege('anon','public.save_goods_receipt_delivery_draft(uuid,uuid,uuid,text,date,text,jsonb)','EXECUTE') AS anon_can_save",
  )).rows[0];
  recordTest('GRN-DELIVERY-07','The delivery endpoint retains tenant and signed-in access controls',
    foreignDelivery==='42501' && !deliveryPermission.anon_can_save,
    JSON.stringify({foreignDelivery,deliveryPermission}));

  const checkedPost = (await asA(() => post(orgAId,checkedId))).rows[0]?.result;
  const checkedReplay = (await asA(() => post(orgAId,checkedId))).rows[0]?.result;
  const postedEvidence = (await client.query(
    "SELECT details FROM public.audit_events WHERE entity_id=$1 AND action='POST_GOODS_RECEIPT'",[checkedId],
  )).rows;
  const stockDelta = await stock(deliveryProduct);
  recordTest('GRN-DELIVERY-03','Posting adds 95 units exactly once and audits missing and damaged units',
    checkedPost?.total_units===95 && checkedReplay?.idempotent_replay===true && stockDelta===95 &&
    postedEvidence.length===1 && postedEvidence[0].details?.received_units===98 &&
    postedEvidence[0].details?.missing_units===2 && postedEvidence[0].details?.damaged_units===3,
    JSON.stringify({checkedPost,checkedReplay,stockDelta,postedEvidence}));

  const priceEvidence = (await client.query(
    'SELECT unit_cost FROM public.supplier_price_history WHERE source_receipt_id=$1',[checkedId],
  )).rows;
  recordTest('GRN-DELIVERY-04','Usable deliveries retain their entered purchase-rate snapshot',
    priceEvidence.length===1 && Number(priceEvidence[0].unit_cost)===21.5,JSON.stringify(priceEvidence));

  const undeliveredId = crypto.randomUUID(), damagedId = crypto.randomUUID();
  await asA(() => saveChecked(undeliveredId,'INV-NOT-DELIVERED',
    {...checkedLine,packageCounts:[],looseUnits:0,billedUnits:10,damagedUnits:0}));
  await asA(() => saveChecked(damagedId,'INV-ALL-DAMAGED',
    {...checkedLine,packageCounts:[12],looseUnits:0,billedUnits:10,damagedUnits:12}));
  await asA(() => post(orgAId,undeliveredId));
  await asA(() => post(orgAId,damagedId));
  const zeroUsableEvidence = (await client.query(
    "SELECT (SELECT count(*)::int FROM public.stock_movements WHERE reference_id IN ($1,$2)) AS movements, (SELECT count(*)::int FROM public.supplier_price_history WHERE source_receipt_id IN ($1,$2)) AS prices",
    [undeliveredId,damagedId],
  )).rows[0];
  recordTest('GRN-DELIVERY-05','Fully missing or damaged lines remain on posted receipts with zero stock movements',
    zeroUsableEvidence.movements===0 && zeroUsableEvidence.prices===0 &&
    (await storedLine(undeliveredId))?.missingUnits===10 && (await storedLine(damagedId))?.excessUnits===2 &&
    await stock(deliveryProduct)===95,
    JSON.stringify(zeroUsableEvidence));

  const legacyId = crypto.randomUUID();
  await client.query(
    "INSERT INTO public.goods_receipts(id,organization_id,supplier_id,supplier_invoice_number,received_on,created_by,lines) VALUES($1,$2,$3,'INV-LEGACY-DRAFT','2026-11-10',$4,$5::jsonb)",
    [legacyId,orgAId,supplierA,ownerAId,JSON.stringify([{productId:deliveryProduct,productName:'Delivery Fixture',
      sku:'GRN-DELIVERY',uom:'Nos',packageCounts:[5],looseUnits:0,unitCost:21.5,totalUnits:5}])],
  );
  await asA(() => post(orgAId,legacyId));
  recordTest('GRN-DELIVERY-06','A historical draft without delivery fields still posts all received units',
    await stock(deliveryProduct)===100,'stock='+await stock(deliveryProduct));

  const unpostedId = crypto.randomUUID();
  await asA(() => saveChecked(unpostedId,'INV-DELIVERY-UNPOSTED'));
  const listFollowUps = (resolved, afterPostedAt = null, afterReceiptId = null) => client.query(
    'SELECT *, posted_at::text AS cursor_at FROM public.list_goods_receipt_follow_ups($1,$2,$3,$4)',
    [orgAId,resolved,afterPostedAt,afterReceiptId],
  );
  const resolveFollowUp = (id, note, organizationId = orgAId) => client.query(
    'SELECT public.resolve_goods_receipt_follow_up($1,$2,$3) AS result',[organizationId,id,note],
  );
  const asSales = (fn) => withRoleContext(client,{role:'authenticated',userId:salesUserId},fn);
  const open = (await asA(() => listFollowUps(false))).rows;
  const checked = open.find((row) => row.receipt_id===checkedId);
  recordTest('GRN-FOLLOW-UP-01','Only posted delivery discrepancies appear in the open queue',
    open.length===3 && [checkedId,undeliveredId,damagedId].every((id) => open.some((row) => row.receipt_id===id)) &&
    checked?.supplier_name==='Supplier A' && checked.lines[0]?.totalUnits===98 && checked.lines[0]?.damagedUnits===3 &&
    !('unitCost' in checked.lines[0]),
    JSON.stringify({open:open.map((row) => row.supplier_invoice_number),checked:checked?.lines}));

  const afterFirst = open[0] ? (await asA(() => listFollowUps(false,open[0].cursor_at,open[0].receipt_id))).rows : [];
  const badCursor = await errorCode(() => asA(() => listFollowUps(false,null,checkedId)));
  recordTest('GRN-FOLLOW-UP-02','Follow-up pagination resumes after the full cursor and rejects partial cursors',
    open.length===3 && afterFirst.length===2 && afterFirst.every((row,index) => row.receipt_id===open[index+1].receipt_id) &&
    badCursor==='22023',JSON.stringify({returned:afterFirst.length,badCursor}));

  const note = 'Supplier replaced 3 damaged units and issued credit CN-42 for the 2 missing units.';
  const denied = [
    await errorCode(() => asB(() => listFollowUps(false))),
    await errorCode(() => asB(() => resolveFollowUp(checkedId,note))),
    await errorCode(() => asSales(() => listFollowUps(false))),
    await errorCode(() => asSales(() => resolveFollowUp(checkedId,note))),
  ];
  const grants = (await client.query(`SELECT
    has_function_privilege('anon','public.list_goods_receipt_follow_ups(uuid,boolean,timestamptz,uuid)','EXECUTE') AS anon_read,
    has_function_privilege('anon','public.resolve_goods_receipt_follow_up(uuid,uuid,text)','EXECUTE') AS anon_write,
    has_table_privilege('authenticated','atlas_private.goods_receipt_follow_up_resolutions','INSERT') AS direct_insert,
    has_table_privilege('authenticated','atlas_private.goods_receipt_follow_up_resolutions','UPDATE') AS direct_update,
    has_table_privilege('authenticated','atlas_private.goods_receipt_follow_up_resolutions','DELETE') AS direct_delete`
  )).rows[0];
  recordTest('GRN-FOLLOW-UP-03','Follow-up RPCs and stored notes retain role and organization boundaries',
    denied.every((code) => code==='42501') && Object.values(grants).every((value) => !value),
    JSON.stringify({denied,grants}));

  const cleanError = await errorCode(() => asA(() => resolveFollowUp(legacyId,note)));
  const draftError = await errorCode(() => asA(() => resolveFollowUp(unpostedId,note)));
  const noteError = await errorCode(() => asA(() => resolveFollowUp(checkedId,' \t\n ')));
  recordTest('GRN-FOLLOW-UP-04','Clean or draft receipts and blank resolution notes are rejected',
    [cleanError,draftError,noteError].every((code) => code==='22023'),JSON.stringify({cleanError,draftError,noteError}));

  const firstResolution = (await asA(() => resolveFollowUp(checkedId,'  '+note+'  '))).rows[0]?.result;
  const replayResolution = (await asA(() => resolveFollowUp(checkedId,note))).rows[0]?.result;
  const conflict = await errorCode(() => asA(() => resolveFollowUp(checkedId,'Different resolution')));
  const openAfter = (await asA(() => listFollowUps(false))).rows;
  const resolved = (await asA(() => listFollowUps(true))).rows;
  const foreignNotes = (await asB(() => client.query('SELECT receipt_id FROM atlas_private.goods_receipt_follow_up_resolutions'))).rows;
  const salesNotes = (await asSales(() => client.query('SELECT receipt_id FROM atlas_private.goods_receipt_follow_up_resolutions'))).rows;
  recordTest('GRN-FOLLOW-UP-05','A confirmed resolution moves the case once and keeps the original note',
    firstResolution?.receipt_id===checkedId && firstResolution.idempotent_replay===false &&
    replayResolution?.idempotent_replay===true && conflict==='23505' && openAfter.length===2 &&
    !openAfter.some((row) => row.receipt_id===checkedId) && resolved.length===1 && resolved[0].receipt_id===checkedId &&
    resolved[0].resolution_note===note && Boolean(resolved[0].resolved_at) && foreignNotes.length===0 && salesNotes.length===0,
    JSON.stringify({firstResolution,replayResolution,conflict,resolved:resolved.length,foreignNotes:foreignNotes.length,salesNotes:salesNotes.length}));

  const resolutionAudit = (await client.query(
    "SELECT actor_id,details FROM public.audit_events WHERE entity_id=$1 AND action='RESOLVE_GOODS_RECEIPT_FOLLOW_UP'",[checkedId],
  )).rows;
  const priceAfterResolution = (await client.query('SELECT unit_cost FROM public.supplier_price_history WHERE source_receipt_id=$1',[checkedId])).rows;
  recordTest('GRN-FOLLOW-UP-06','Resolution audits once and preserves the original receipt, stock and purchase rate',
    resolutionAudit.length===1 && resolutionAudit[0].actor_id===ownerAId && resolutionAudit[0].details?.supplier_invoice==='INV-DELIVERY' &&
    await stock(deliveryProduct)===100 && JSON.stringify(await storedLine(checkedId))===JSON.stringify(savedLine) &&
    priceAfterResolution.length===1 && Number(priceAfterResolution[0].unit_cost)===21.5,
    JSON.stringify({resolutionAudit,priceAfterResolution}));
}
