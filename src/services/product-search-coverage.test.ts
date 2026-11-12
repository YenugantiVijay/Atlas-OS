import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productsService } from './products.service';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

const table = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn(),
};
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock('@/lib/storage', () => ({
  storage: { getProducts: vi.fn() },
}));

const org = '9b1122c3-3333-4444-8555-666677778888';
const row = {
  id: 'p1', organization_id: org, name: 'Copper Cable', sku: 'CABLE-1',
  category: 'Electrical', brand: 'Atlas', uom: 'Coils', hsn_code: '8544',
  tax_rate: 18, selling_price: 120, purchase_cost: 60, is_active: true,
  created_at: '', updated_at: '',
};

describe('PR54 product search coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.select.mockReturnThis();
    table.eq.mockReturnThis();
    table.or.mockReturnThis();
    table.order.mockReturnThis();
    table.range.mockResolvedValue({ data: [row], count: 1, error: null });
    vi.mocked(supabase!.from).mockReturnValue(table as any);
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: [{ product_id: 'p1', current_stock: 7 }], error: null,
    } as any);
  });

  it('matches product HSN in bounded tenant-scoped cloud pagination', async () => {
    const page = await productsService.getProductsPaginated(
      org, { search: '8544', page: 1, pageSize: 4, isActive: true }, false,
    );
    expect(supabase!.from).toHaveBeenCalledWith('products');
    expect(table.eq).toHaveBeenCalledWith('organization_id', org);
    expect(table.eq).toHaveBeenCalledWith('is_active', true);
    expect(table.or).toHaveBeenCalledWith(expect.stringContaining('hsn_code.ilike.%8544%'));
    expect(table.range).toHaveBeenCalledWith(0, 3);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      organizationId: org, hsnCode: '8544', currentStock: 7,
    });
  });

  it('matches HSN in local demo without calling Supabase', async () => {
    vi.mocked(storage.getProducts).mockResolvedValue([{
      id: 'p1', organizationId: org, name: 'Copper Cable', sku: 'CABLE-1',
      category: 'Electrical', hsnCode: '8544', isActive: true,
    }] as any);
    const page = await productsService.getProductsPaginated(
      org, { search: '8544', page: 1, pageSize: 4 }, true,
    );
    expect(page.data).toHaveLength(1);
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('searches aliases and keeps other product search working before the aliases migration', async () => {
    table.range.mockResolvedValueOnce({ data: null, count: null, error: {
      code: '42703', message: 'column products.search_aliases does not exist',
    } });
    const page = await productsService.getProductsPaginated(org, { search: 'legacy code' });
    expect(table.or).toHaveBeenNthCalledWith(1, expect.stringContaining('search_aliases.ilike.%legacy code%'));
    expect(table.or.mock.calls[1][0]).not.toContain('search_aliases');
    expect(page.data[0].currentStock).toBe(7);
  });
});
