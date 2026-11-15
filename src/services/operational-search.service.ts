import { supabase } from '@/lib/supabase';

export type OperationalSearchKind = 'supplier' | 'quotation' | 'sales_order';

export interface OperationalSearchResult {
  recordType: OperationalSearchKind;
  recordId: string;
  reference: string;
  displayName: string;
  contactPhone?: string;
}

const KINDS: OperationalSearchKind[] = ['supplier', 'quotation', 'sales_order'];

/** Minimal tenant/RLS-scoped operational search; never download entire catalogs. */
export async function searchOperationalRecords(
  orgId: string,
  query: string,
  limitPerType = 3,
): Promise<OperationalSearchResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  if (term.length > 100 || !Number.isInteger(limitPerType) ||
      limitPerType < 1 || limitPerType > 5) {
    throw new Error('Invalid operational search arguments.');
  }
  if (!supabase) throw new Error('Cloud backend is not configured.');

  const { data, error } = await supabase.rpc('search_operational_records', {
    p_org_id: orgId, p_query: term, p_limit_per_type: limitPerType,
  });
  if (error) throw new Error(`Operational search failed: ${error.message}`);
  if (!Array.isArray(data) || data.length > limitPerType * KINDS.length) {
    throw new Error('Operational search returned invalid bounded data.');
  }
  const counts: Record<OperationalSearchKind, number> = {
    supplier: 0, quotation: 0, sales_order: 0,
  };
  return data.map((row: unknown) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Operational search returned an invalid record.');
    }
    const r = row as Record<string, unknown>;
    if (!KINDS.includes(r.record_type as OperationalSearchKind) ||
        typeof r.record_id !== 'string' || typeof r.reference !== 'string' ||
        typeof r.display_name !== 'string' ||
        (r.contact_phone != null && typeof r.contact_phone !== 'string')) {
      throw new Error('Operational search returned an invalid record.');
    }
    const kind = r.record_type as OperationalSearchKind;
    counts[kind] += 1;
    if (counts[kind] > limitPerType) {
      throw new Error('Operational search exceeded a per-type result limit.');
    }
    return {
      recordType: kind,
      recordId: r.record_id,
      reference: r.reference,
      displayName: r.display_name,
      contactPhone: r.contact_phone || undefined,
    } as OperationalSearchResult;
  });
}
