import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inventoryService, mapDbStockMovement } from './inventory.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

const orgId = '11111111-2222-4333-8444-555555555555';
const productId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const movementId = '77777777-8888-4999-aaaa-bbbbbbbbbbbb';
const querySelect = '*, products:products!fk_stock_movements_product_org(*)';

const product = {
  id: productId, organization_id: orgId, name: 'Fertilizer 50 kg',
  sku: 'FERT-50', category: 'Fertilizer', brand: 'Example',
  uom: 'Bags', purchase_cost: 1200, selling_price: 1340,
  tax_rate: 5, is_active: true,
};

const movement = {
  id: movementId, organization_id: orgId, product_id: productId,
  movement_type: 'GOODS_RECEIVED', quantity_change: '24',
  reference_type: 'GRN', notes: 'Warehouse receipt',
  created_at: '2026-11-10T08:00:00.000Z', products: product,
};

function createMovementQuery(response: { data: unknown; error: unknown }) {
  // Supabase PostgREST query builders are thenable. Model that contract
  // rather than replacing the inventory service with a fake.
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(response),
    then: (resolve: (v: typeof response) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject),
  };
}

describe('PR #55 — inventory movement product embed disambiguation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads stock ledger with the product-and-organization FK, preserving mapped product details', async () => {
    const query = createMovementQuery({ data: [movement], error: null });
    vi.mocked(supabase!.from).mockReturnValue(query as any);

    const rows = await inventoryService.getStockMovements(orgId, undefined, false);

    expect(supabase!.from).toHaveBeenCalledWith('stock_movements');
    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith(querySelect);
    expect(query.eq).toHaveBeenCalledWith('organization_id', orgId);
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.range).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: movementId, organizationId: orgId, productId,
      quantityChange: 24, movementType: 'GOODS_RECEIVED',
      product: {
        id: productId, organizationId: orgId,
        name: 'Fertilizer 50 kg', sku: 'FERT-50',
      },
    });
  });

  it('uses the same composite FK with optional product filtering and bounded pages', async () => {
    const query = createMovementQuery({ data: [movement], error: null });
    vi.mocked(supabase!.from).mockReturnValue(query as any);
    const result = await inventoryService.getStockMovements(
      orgId, productId, false, { page: 2, pageSize: 25 },
    );

    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith(querySelect);
    expect(query.eq).toHaveBeenCalledWith('organization_id', orgId);
    expect(query.eq).toHaveBeenCalledWith('product_id', productId);
    expect(query.range).toHaveBeenCalledWith(25, 49);
    expect(query.limit).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('returns an empty ledger without manufacturing movements or data', async () => {
    const query = createMovementQuery({ data: [], error: null });
    vi.mocked(supabase!.from).mockReturnValue(query as any);
    await expect(inventoryService.getStockMovements(orgId, undefined, false))
      .resolves.toEqual([]);
    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith(querySelect);
  });

  it('recovers from relationship-cache errors using a bounded, org-scoped raw movement read', async () => {
    const embed = createMovementQuery({
      data: null, error: { code: 'PGRST201', message: 'Ambiguous relationship' },
    });
    const fallback = createMovementQuery({ data: [{...movement, products: undefined}], error: null });
    vi.mocked(supabase!.from).mockReturnValueOnce(embed as any).mockReturnValueOnce(fallback as any);
    const rows = await inventoryService.getStockMovements(orgId, undefined, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(productId);
    expect(rows[0].quantityChange).toBe(24);
    expect(rows[0].product).toBeUndefined();
    expect(embed.select).toHaveBeenCalledWith(querySelect);
    expect(fallback.select).toHaveBeenCalledWith('*');
    expect(fallback.eq).toHaveBeenCalledWith('organization_id', orgId);
    expect(fallback.limit).toHaveBeenCalledWith(100);
  });

  it('surfaces fallback failures instead of masking a database outage or permissions issue', async () => {
    const embed = createMovementQuery({
      data: null, error: { code: 'PGRST200', message: 'Relationship missing' },
    });
    const fallback = createMovementQuery({
      data: null, error: { code: '42501', message: 'permission denied' },
    });
    vi.mocked(supabase!.from).mockReturnValueOnce(embed as any).mockReturnValueOnce(fallback as any);
    await expect(inventoryService.getStockMovements(orgId, undefined, false))
      .rejects.toThrow('Failed to fetch stock movements: permission denied');
  });

  it('never retries a non-relationship error with a broader read', async () => {
    const query = createMovementQuery({
      data: null, error: { code: '42501', message: 'permission denied' },
    });
    vi.mocked(supabase!.from).mockReturnValue(query as any);
    await expect(inventoryService.getStockMovements(orgId, undefined, false))
      .rejects.toThrow('Failed to fetch stock movements: permission denied');
    expect(supabase!.from).toHaveBeenCalledTimes(1);
  });

  it('fetches the posted adjustment by the same composite FK without re-posting stock', async () => {
    const adjusted = {
      ...movement, movement_type: 'ADJUSTMENT', quantity_change: '-3',
      reference_type: 'MANUAL_ADJUSTMENT',
    };
    const query = createMovementQuery({ data: adjusted, error: null });
    vi.mocked(supabase!.from).mockReturnValue(query as any);
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { movement_id: movementId }, error: null,
    } as any);

    const row = await inventoryService.adjustStock(
      orgId, productId, -3, 'Physical count correction',
      '22222222-3333-4444-8555-666666666666', false,
    );

    expect(supabase!.rpc).toHaveBeenCalledTimes(1);
    expect(supabase!.rpc).toHaveBeenCalledWith('record_stock_adjustment', {
      p_org_id: orgId, p_product_id: productId,
      p_quantity_change: -3, p_notes: 'Physical count correction',
      p_idempotency_key: '22222222-3333-4444-8555-666666666666',
    });
    expect(query.select).toHaveBeenCalledTimes(1);
    expect(query.select).toHaveBeenCalledWith(querySelect);
    expect(query.eq).toHaveBeenCalledWith('id', movementId);
    expect(query.single).toHaveBeenCalledTimes(1);
    expect(row.id).toBe(movementId);
    expect(row.quantityChange).toBe(-3);
    expect(row.product?.organizationId).toBe(orgId);
  });

  it('retains the actual posted movement id when the follow-up lookup cannot return details', async () => {
    const query = createMovementQuery({
      data: null, error: { code: 'PGRST116', message: 'No rows returned' },
    });
    vi.mocked(supabase!.from).mockReturnValue(query as any);
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: { movement_id: movementId }, error: null,
    } as any);

    const row = await inventoryService.adjustStock(
      orgId, productId, 2, 'Physical count correction',
      '22222222-3333-4444-8555-666666666666', false,
    );
    expect(row.id).toBe(movementId);
    expect(row.quantityChange).toBe(2);
    expect(supabase!.rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps optional product details optional when RLS does not return an embedded product', () => {
    const row = mapDbStockMovement({ ...movement, products: null });
    expect(row.product).toBeUndefined();
    expect(row.organizationId).toBe(orgId);
  });
});
