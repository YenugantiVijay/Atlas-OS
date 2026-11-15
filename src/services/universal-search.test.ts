import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchFinancialDocuments } from './universal-search.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const org = 'a0000000-0000-0000-0000-000000000001';

describe('B2 — financial search service', () => {
  beforeEach(() => vi.resetAllMocks());

  it('does not query finance for Sales and Viewer roles', async () => {
    expect(await searchFinancialDocuments(org, 'sales', 'INV-001')).toEqual([]);
    expect(await searchFinancialDocuments(org, 'viewer', 'INV-001')).toEqual([]);
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it('bounds finance queries and checks response structure', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: [{
        record_type: 'invoice', record_id: 'invoice-id',
        document_number: 'INV-001', customer_name: 'Acme',
        document_date: '2026-01-01',
      }], error: null,
    } as any);
    const results = await searchFinancialDocuments(org, 'accounts', 'INV-001');
    expect(results[0].document_number).toBe('INV-001');
    expect(supabase!.rpc).toHaveBeenCalledWith('search_financial_documents', {
      p_org_id: org, p_query: 'INV-001', p_limit: 8,
    });
  });

  it('fails safely on a server or response error', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: null, error: { message: 'denied' },
    } as any);
    await expect(searchFinancialDocuments(org, 'owner', 'INV')).rejects.toThrow('denied');
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: [{}], error: null,
    } as any);
    await expect(searchFinancialDocuments(org, 'owner', 'INV')).rejects.toThrow('invalid record');
  });
});
