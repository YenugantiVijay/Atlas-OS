import { supabase } from '@/lib/supabase';

export interface CustomerDirectorySearchResult {
  id: string;
  name: string;
  companyName?: string;
  phone?: string;
}

/**
 * Cloud command-palette lookup. The database enforces organization membership
 * and RLS, and exposes only directory fields (never credit or receivables).
 * Do not silently fall back to loading the complete customers table.
 */
export async function searchCustomerDirectory(
  orgId: string,
  query: string,
  limit = 3,
): Promise<CustomerDirectorySearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  if (term.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error('Invalid customer directory search arguments.');
  }
  if (!supabase) throw new Error('Cloud backend is not configured.');

  const { data, error } = await supabase.rpc('search_customer_directory', {
    p_org_id: orgId,
    p_query: term,
    p_limit: limit,
  });
  if (error) throw new Error(`Customer directory search failed: ${error.message}`);
  if (!Array.isArray(data) || data.length > limit) {
    throw new Error('Customer directory search returned an invalid bounded result.');
  }

  return data.map((row: unknown) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Customer directory search returned an invalid row.');
    }
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' ||
        (r.company_name != null && typeof r.company_name !== 'string') ||
        (r.phone != null && typeof r.phone !== 'string')) {
      throw new Error('Customer directory search returned an invalid directory record.');
    }
    return {
      id: r.id,
      name: r.name,
      companyName: r.company_name || undefined,
      phone: r.phone || undefined,
    } as CustomerDirectorySearchResult;
  });
}
