import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { AtlasImportCatalog } from './import-preview';

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

export async function loadImportCatalog(orgId: string, demo: boolean, signal: AbortSignal): Promise<AtlasImportCatalog> {
  if (demo) {
    const [products, customers] = await Promise.all([storage.getProducts(orgId), storage.getCustomers(orgId)]);
    return { products, customers };
  }

  const client = supabase;
  if (!client) throw new Error('Atlas catalog comparison is unavailable.');

  const [products, customers] = await Promise.all([
    readCatalog<{ id: string; sku: string; name: string; uom: string }>((after) => {
      let query = client.from('products').select('id,sku,name,uom').eq('organization_id', orgId);
      if (after) query = query.gt('id', after);
      return query.order('id').limit(PAGE_SIZE).abortSignal(signal);
    }),
    readCatalog<{ id: string; name: string; gstin: string | null; phone: string | null }>((after) => {
      let query = client.from('customers').select('id,name,gstin,phone').eq('organization_id', orgId);
      if (after) query = query.gt('id', after);
      return query.order('id').limit(PAGE_SIZE).abortSignal(signal);
    }),
  ]);
  return {
    products,
    customers: customers.map((row) => ({ name: row.name, gstin: row.gstin ?? undefined, phone: row.phone ?? undefined })),
  };
}
