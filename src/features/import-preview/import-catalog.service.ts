import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { CustomerIdentity, ProductIdentity } from './import-preview';

const PAGE_SIZE = 500;
const MAX_CATALOG_ROWS = 25_000;

async function readCatalog<T extends { id: string }>(
  readPage: (after: string | undefined) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;
  for (;;) {
    const { data, error } = await readPage(after);
    if (error || !data) throw new Error('Atlas catalog comparison is unavailable.');
    if (rows.length + data.length > MAX_CATALOG_ROWS) {
      throw new Error('This Atlas catalog is too large to compare in this preview.');
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
    after = data[data.length - 1].id;
  }
}

export async function loadImportProducts(orgId: string, demo: boolean, signal: AbortSignal): Promise<ProductIdentity[]> {
  if (demo) return storage.getProducts(orgId);
  const client = supabase;
  if (!client) throw new Error('Atlas product comparison is unavailable.');
  return readCatalog<ProductIdentity & { id: string }>((after) => {
    let query = client.from('products').select('id,sku,name,uom').eq('organization_id', orgId);
    if (after) query = query.gt('id', after);
    return query.order('id').limit(PAGE_SIZE).abortSignal(signal);
  });
}

export async function loadImportCustomers(orgId: string, demo: boolean, signal: AbortSignal): Promise<CustomerIdentity[]> {
  if (demo) return storage.getCustomers(orgId);
  const client = supabase;
  if (!client) throw new Error('Atlas customer comparison is unavailable.');
  const rows = await readCatalog<{ id: string; name: string; gstin: string | null; phone: string | null }>((after) => {
    let query = client.from('customers').select('id,name,gstin,phone').eq('organization_id', orgId);
    if (after) query = query.gt('id', after);
    return query.order('id').limit(PAGE_SIZE).abortSignal(signal);
  });
  return rows.map((row) => ({ name: row.name, gstin: row.gstin ?? undefined, phone: row.phone ?? undefined }));
}
