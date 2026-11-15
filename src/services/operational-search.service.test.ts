import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { searchOperationalRecords } from './operational-search.service';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
const ORG = '2dbb3c12-a337-4fba-8d7d-aa79f88545fd';

describe('B2 operational search — typed, bounded, and fail closed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns minimal supplier, quotation and order rows from a scoped RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: [
        { record_type: 'supplier', record_id: 's1', reference: 'Ravi Supply', display_name: 'Ravi Electrical', contact_phone: '+91 99887-76655' },
        { record_type: 'quotation', record_id: 'q1', reference: 'QT-001', display_name: 'Buyer 1', contact_phone: null },
        { record_type: 'sales_order', record_id: 'o1', reference: 'SO-001', display_name: 'Buyer 1', contact_phone: null },
      ], error: null,
    } as any);
    const rows = await searchOperationalRecords(ORG, ' Ravi ', 3);
    expect(supabase!.rpc).toHaveBeenCalledWith('search_operational_records', {
      p_org_id: ORG, p_query: 'Ravi', p_limit_per_type: 3,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      recordType: 'supplier', recordId: 's1', reference: 'Ravi Supply',
      displayName: 'Ravi Electrical', contactPhone: '+91 99887-76655',
    });
    expect(rows[1]).not.toHaveProperty('totalAmount');
    expect(rows[2]).not.toHaveProperty('customerId');
  });

  it('never queries server for a one-character term and rejects invalid limits', async () => {
    await expect(searchOperationalRecords(ORG, ' x ')).resolves.toEqual([]);
    await expect(searchOperationalRecords(ORG, 'test', 6)).rejects.toThrow('Invalid');
    await expect(searchOperationalRecords(ORG, 'x'.repeat(101))).rejects.toThrow('Invalid');
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it('does not fall back to broad queries after a denied or missing RPC', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: null, error: { message: 'permission denied' } } as any);
    await expect(searchOperationalRecords(ORG, 'quote')).rejects.toThrow('Operational search failed');
    expect(supabase!.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported types and per-family overflows even with a small total', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: [{ record_type: 'invoice', record_id: 'x', reference: 'x', display_name: 'x' }], error: null,
    } as any).mockResolvedValueOnce({
      data: Array.from({ length: 4 }, (_, i) => ({
        record_type: 'supplier', record_id: String(i), reference: 'R', display_name: 'S',
      })), error: null,
    } as any);
    await expect(searchOperationalRecords(ORG, 'test')).rejects.toThrow('invalid record');
    await expect(searchOperationalRecords(ORG, 'test')).rejects.toThrow('per-type result limit');
  });

  it('rejects malformed and unbounded result shapes', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({ data: { rows: [] }, error: null } as any)
      .mockResolvedValueOnce({ data: [{ record_type: 'supplier', record_id: 1, reference: 'a', display_name: 'b' }], error: null } as any);
    await expect(searchOperationalRecords(ORG, 'test')).rejects.toThrow('invalid bounded data');
    await expect(searchOperationalRecords(ORG, 'test')).rejects.toThrow('invalid record');
  });
});
