import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { searchCustomerDirectory } from './customer-directory-search.service';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
const ORG = 'b2b2b2b2-1111-4222-8333-b2b2b2b2b2b2';

describe('B2 — authorized bounded customer directory search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the exact query to the server for normalized phone lookup', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data: [{ id: 'customer-1', name: 'Ravi Electricals', company_name: 'Ravi Traders', phone: '+91 98765-43210' }],
      error: null,
    } as any);
    const rows = await searchCustomerDirectory(ORG, ' +91 98765 ', 3);
    expect(supabase!.rpc).toHaveBeenCalledWith('search_customer_directory', {
      p_org_id: ORG, p_query: '+91 98765', p_limit: 3,
    });
    expect(rows).toEqual([{
      id: 'customer-1', name: 'Ravi Electricals', companyName: 'Ravi Traders', phone: '+91 98765-43210',
    }]);
    expect(rows[0]).not.toHaveProperty('creditLimit');
    expect(rows[0]).not.toHaveProperty('currentReceivable');
  });

  it('does not execute a backend request for a one-character term', async () => {
    await expect(searchCustomerDirectory(ORG, ' 9 ')).resolves.toEqual([]);
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it('rejects oversized queries and unbounded limits', async () => {
    await expect(searchCustomerDirectory(ORG, 'x'.repeat(101))).rejects.toThrow(/Invalid/);
    await expect(searchCustomerDirectory(ORG, '98765', 21)).rejects.toThrow(/Invalid/);
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the database RPC is missing, denied or unavailable', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: null, error: { message: 'permission denied' } } as any);
    await expect(searchCustomerDirectory(ORG, '98765')).rejects.toThrow('Customer directory search failed');
    expect(supabase!.rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses malformed or unbounded result payloads rather than exposing arbitrary fields', async () => {
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data: [{ id: 'customer-1', name: 'A', phone: 123 }], error: null,
    } as any).mockResolvedValueOnce({
      data: Array.from({ length: 4 }, (_, index) => ({ id: String(index), name: 'C' })), error: null,
    } as any);
    await expect(searchCustomerDirectory(ORG, '98765')).rejects.toThrow('invalid directory record');
    await expect(searchCustomerDirectory(ORG, '98765')).rejects.toThrow('invalid bounded result');
  });
});
