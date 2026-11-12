import { supabase } from '@/lib/supabase';
import { mapDbProduct } from '@/services/products.service';
import type { Product } from '@/types';

export interface CounterAlternative {
  sourceProductId: string;
  comparisonNote: string;
  product: Product;
}

export interface ConfiguredAlternative {
  alternative_product_id: string;
  comparison_note: string;
  product: { name: string; sku: string; is_active: boolean };
}

const requireCloud = () => {
  if (!supabase) throw new Error('Product alternatives require a configured cloud backend.');
  return supabase;
};

export const productAlternativesService = {
  async listConfigured(organizationId: string, sourceProductId: string) {
    const { data, error } = await requireCloud().from('product_alternatives')
      .select('alternative_product_id, comparison_note, product:products!product_alternatives_target_fk(name, sku, is_active)')
      .eq('organization_id', organizationId)
      .eq('source_product_id', sourceProductId)
      .order('created_at', { ascending: false })
      .order('alternative_product_id');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ConfiguredAlternative[];
  },

  async approve(organizationId: string, sourceProductId: string, alternativeProductId: string, note: string) {
    const { error } = await requireCloud().from('product_alternatives').insert({
      organization_id: organizationId,
      source_product_id: sourceProductId,
      alternative_product_id: alternativeProductId,
      comparison_note: note.trim(),
    });
    if (error?.code === '23505') throw new Error('This product is already an approved alternative.');
    if (error) throw new Error(error.message);
  },

  async remove(organizationId: string, sourceProductId: string, alternativeProductId: string) {
    const { error } = await requireCloud().from('product_alternatives').delete()
      .eq('organization_id', organizationId)
      .eq('source_product_id', sourceProductId)
      .eq('alternative_product_id', alternativeProductId)
      .select('alternative_product_id')
      .single();
    if (error) throw new Error(error.message);
  },

  async forCounter(organizationId: string, sourceProductIds: string[]): Promise<CounterAlternative[]> {
    if (sourceProductIds.length === 0) return [];
    const { data, error } = await requireCloud().rpc('get_counter_product_alternatives', {
      p_org_id: organizationId, p_product_ids: sourceProductIds,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length > 64) throw new Error('Invalid product alternatives response.');
    return data.map((row) => ({
      sourceProductId: row.source_product_id,
      comparisonNote: row.comparison_note,
      product: mapDbProduct(row.product, Number(row.current_stock)),
    }));
  },
};
