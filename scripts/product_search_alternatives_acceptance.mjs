export async function runProductSearchAlternativesAcceptance({
  client, withRoleContext, recordTest, orgAId, orgBId, ownerAId, ownerBId,
  sourceProductId, alternativeProductId, foreignProductId,
}) {
  const { rows: [sales] } = await client.query(
    "SELECT user_id FROM public.memberships WHERE organization_id=$1 AND role='sales' LIMIT 1",
    [orgAId],
  );
  if (!sales) throw new Error('Missing retail counter sales-role fixture');

  const as = (userId, fn) => withRoleContext(client, { role: 'authenticated', userId }, fn);
  const alias = 'Old model ALIAS-50';
  await as(ownerAId, () => client.query(
    'UPDATE public.products SET search_aliases=$1 WHERE organization_id=$2 AND id=$3',
    [alias, orgAId, sourceProductId],
  ));
  const { rows: matches } = await as(sales.user_id, () => client.query(
    'SELECT id FROM public.products WHERE organization_id=$1 AND search_aliases ILIKE $2',
    [orgAId, '%old model alias-50%'],
  ));
  recordTest('PRODUCT-ALT-01', 'Approved search names are case-insensitive and visible in the tenant catalogue',
    matches.length === 1 && matches[0].id === sourceProductId, JSON.stringify(matches));

  const approve = (userId, target) => as(userId, () => client.query(`
    INSERT INTO public.product_alternatives (organization_id, source_product_id, alternative_product_id, comparison_note)
    VALUES ($1,$2,$3,'Same fitting; shorter warranty')
  `, [orgAId, sourceProductId, target]));
  const codeOf = async (fn) => {
    try { await fn(); } catch (error) { return error.code; }
    return null;
  };
  const salesApproval = await codeOf(() => approve(sales.user_id, alternativeProductId));
  const foreignApproval = await codeOf(() => approve(ownerAId, foreignProductId));
  const sameProduct = await codeOf(() => approve(ownerAId, sourceProductId));
  await approve(ownerAId, alternativeProductId);
  recordTest('PRODUCT-ALT-02', 'Only authorized staff approve distinct same-tenant substitutes',
    salesApproval === '42501' && ['42501','23503'].includes(foreignApproval) && sameProduct === '23514',
    JSON.stringify({ salesApproval, foreignApproval, sameProduct }));

  const lookup = (userId, orgId, sourceId) => as(userId, async () => (await client.query(
    'SELECT * FROM public.get_counter_product_alternatives($1,$2::uuid[])',
    [orgId, [sourceId]],
  )).rows);
  const [alternative] = await lookup(sales.user_id, orgAId, sourceProductId);
  const { rows: [{ current_stock: expectedStock }] } = await as(sales.user_id, () => client.query(
    'SELECT current_stock FROM public.get_page_product_stock_levels($1,$2::uuid[])',
    [orgAId, [alternativeProductId]],
  ));
  const inverse = await lookup(sales.user_id, orgAId, alternativeProductId);
  const foreign = await codeOf(() => lookup(ownerBId, orgAId, sourceProductId));
  recordTest('PRODUCT-ALT-03', 'Counter lookup is directional and returns authoritative stock with no purchase cost',
    alternative?.product?.id === alternativeProductId && alternative.product.purchase_cost === undefined &&
    alternative.current_stock === expectedStock && alternative.comparison_note === 'Same fitting; shorter warranty' &&
    inverse.length === 0 && foreign === '42501',
    JSON.stringify({ alternative, expectedStock, inverse, foreign }));

  const remove = (userId) => as(userId, () => client.query(
    'DELETE FROM public.product_alternatives WHERE organization_id=$1 AND source_product_id=$2 AND alternative_product_id=$3',
    [orgAId, sourceProductId, alternativeProductId],
  ));
  const salesDelete = await remove(sales.user_id);
  const ownerDelete = await remove(ownerAId);
  const remaining = await lookup(sales.user_id, orgAId, sourceProductId);
  recordTest('PRODUCT-ALT-04', 'Removing an approval removes the suggestion without changing either product',
    salesDelete.rowCount === 0 && ownerDelete.rowCount === 1 && remaining.length === 0,
    JSON.stringify({ sales: salesDelete.rowCount, owner: ownerDelete.rowCount, remaining }));
}
