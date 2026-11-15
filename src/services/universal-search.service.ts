import { supabase } from '@/lib/supabase';
import { hasPermission } from '@/lib/permissions';
import type { Role } from '@/types';

export interface FinancialSearchResult {
  record_type: 'invoice' | 'payment';
  record_id: string;
  document_number: string;
  customer_name: string;
  document_date: string;
}

/**
 * Permission is enforced at TWO layers: this UI/service gate for usability,
 * and the SECURITY DEFINER RPC's real authenticated membership check.
 * No direct raw invoice or payment table reads occur here.
 */
export async function searchFinancialDocuments(
  orgId: string,
  role: Role | null | undefined,
  query: string
): Promise<FinancialSearchResult[]> {
  const term = query.trim();
  if (!hasPermission(role, 'reports:financial') || term.length < 2) return [];
  if (!supabase) throw new Error('Cloud database unavailable for financial search');
  const { data, error } = await supabase.rpc('search_financial_documents', {
    p_org_id: orgId,
    p_query: term.slice(0, 100),
    p_limit: 8,
  });
  if (error) throw new Error(`Financial search failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('Financial search returned invalid results');
  if (data.length > 8) throw new Error('Financial search exceeded the safe result limit');
  return data.map((row: FinancialSearchResult) => {
    if (!['invoice', 'payment'].includes(row.record_type) ||
        !row.record_id || !row.document_number || !row.document_date) {
      throw new Error('Financial search returned an invalid record');
    }
    return row;
  });
}
