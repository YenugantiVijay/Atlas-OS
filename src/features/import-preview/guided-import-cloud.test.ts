import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guidedImportService, ProductImportRow } from './guided-import.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

const mockSupabase = supabase as unknown as {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

describe('Guided Import — Cloud Atomic Batch & Rollback Engine', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes create_products_batch RPC with atomic payload in cloud mode', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      }),
    });

    const mockProductIds = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ];

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        batch_id: '33333333-3333-3333-3333-333333333333',
        imported_count: 2,
        record_ids: mockProductIds,
      },
      error: null,
    });

    const rows: ProductImportRow[] = [
      { sku: 'SKU-01', name: 'Item 1', uom: 'Nos', purchaseCost: 100, sellingPrice: 150, openingStock: 5 },
      { sku: 'SKU-02', name: 'Item 2', uom: 'Meters', purchaseCost: 200, sellingPrice: 280, openingStock: 10 },
    ];

    const result = await guidedImportService.importProductBatch(orgId, rows, false);

    expect(result.importedCount).toBe(2);
    expect(result.recordIds).toEqual(mockProductIds);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_products_batch',
      expect.objectContaining({
        p_org_id: orgId,
        p_products: expect.arrayContaining([
          expect.objectContaining({ sku: 'SKU-01', opening_stock: 5 }),
          expect.objectContaining({ sku: 'SKU-02', opening_stock: 10 }),
        ]),
      })
    );
  });

  it('invokes undo_product_import_batch RPC in cloud mode and processes rollback result', async () => {
    const batchId = '33333333-3333-3333-3333-333333333333';

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        batch_id: batchId,
        success: true,
        undone_count: 2,
        failed_count: 0,
        message: `Successfully rolled back batch ${batchId}. 2 record(s) safely removed.`,
        details: [],
      },
      error: null,
    });

    const undoRes = await guidedImportService.undoImportBatch(orgId, batchId, false);

    expect(undoRes.success).toBe(true);
    expect(undoRes.undoneCount).toBe(2);
    expect(undoRes.failedCount).toBe(0);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('undo_product_import_batch', {
      p_org_id: orgId,
      p_batch_id: batchId,
    });
  });

  it('safely handles cloud batch rollback failure when products are referenced', async () => {
    const batchId = '44444444-4444-4444-4444-444444444444';

    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        batch_id: batchId,
        success: false,
        undone_count: 0,
        failed_count: 1,
        message: 'Partial undo: 0 record(s) removed, but 1 could not be removed due to transaction references.',
        details: ['Product SKU-01 is referenced in existing sales orders.'],
      },
      error: null,
    });

    const undoRes = await guidedImportService.undoImportBatch(orgId, batchId, false);

    expect(undoRes.success).toBe(false);
    expect(undoRes.failedCount).toBe(1);
    expect(undoRes.details?.[0]).toContain('referenced in existing sales orders');
  });
});
