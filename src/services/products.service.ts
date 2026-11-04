import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Product, UOM } from '@/types';
import { parseTaxRate } from '@/lib/money';

// Helper to map snake_case Postgres row to camelCase Product model
export function mapDbProduct(row: any, stock?: number): Product {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sku: row.sku,
    name: row.name,
    brand: row.brand || undefined,
    category: row.category,
    description: row.description || undefined,
    imageUrl: row.image_url || undefined,
    uom: (row.uom as UOM) || 'Nos',
    purchaseCost: Number(row.purchase_cost) || 0,
    sellingPrice: Number(row.selling_price) || 0,
    taxRate: parseTaxRate(row.tax_rate, 0),
    hsnCode: row.hsn_code || undefined,
    reorderThreshold: Number(row.reorder_threshold ?? 10),
    currentStock: stock,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const productsService = {
  async getProducts(orgId: string, isMockAuth: boolean = false): Promise<Product[]> {
    if (isMockAuth) {
      return storage.getProducts(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // 1. Fetch products scoped strictly to tenant
    const { data: dbProducts, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('organization_id', orgId)
      .order('name');

    if (prodErr) {
      throw new Error(`Failed to fetch products: ${prodErr.message}`);
    }

    if (!dbProducts || dbProducts.length === 0) {
      return [];
    }

    // 2. Fetch authoritative stock aggregations from database RPC
    const { data: stockLevels, error: stockErr } = await supabase.rpc('get_product_stock_levels', {
      p_org_id: orgId,
    });

    if (stockErr) {
      throw new Error(`Failed to load stock totals from authoritative database: ${stockErr.message}`);
    }

    if (!Array.isArray(stockLevels)) {
      throw new Error('Authoritative stock service returned an invalid response structure.');
    }

    const stockMap = new Map<string, number>();
    for (const item of (stockLevels as Array<{ product_id: string; current_stock: number | string }>)) {
      const parsedStock = Number(item.current_stock);
      stockMap.set(item.product_id, Number.isFinite(parsedStock) ? parsedStock : 0);
    }

    return dbProducts.map((row) => {
      // If product exists in authoritative stock aggregation, pass its exact stock (including zero).
      // If product is missing from stock aggregation, currentStock is undefined (distinguishing missing from zero).
      const stock = stockMap.has(row.id) ? stockMap.get(row.id)! : undefined;
      return mapDbProduct(row, stock);
    });
  },

  async createProduct(
    orgId: string,
    input: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'currentStock'>,
    isMockAuth: boolean = false,
    openingStock: number = 0
  ): Promise<Product> {
    if (isMockAuth) {
      return storage.createProduct(orgId, input, openingStock);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    // Atomic product creation + opening stock initialization via authoritative RPC
    const { data, error } = await supabase.rpc('create_product_atomic', {
      p_org_id: orgId,
      p_sku: input.sku.trim(),
      p_name: input.name.trim(),
      p_brand: input.brand?.trim() || null,
      p_category: input.category,
      p_description: input.description?.trim() || null,
      p_uom: input.uom || 'Nos',
      p_purchase_cost: input.purchaseCost,
      p_selling_price: input.sellingPrice,
      p_tax_rate: input.taxRate,
      p_hsn_code: input.hsnCode?.trim() || null,
      p_reorder_threshold: input.reorderThreshold,
      p_is_active: input.isActive ?? true,
      p_opening_stock: openingStock || 0,
      p_notes: 'Initial opening stock',
      p_image_url: input.imageUrl || null,
    });

    if (error) {
      throw new Error(`Failed to create product: ${error.message}`);
    }

    return mapDbProduct(data, openingStock);
  },

  async updateProduct(
    orgId: string,
    productId: string,
    updates: Partial<Product>,
    isMockAuth: boolean = false
  ): Promise<Product> {
    if (isMockAuth) {
      return storage.updateProduct(orgId, productId, updates);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.sku !== undefined) payload.sku = updates.sku.trim();
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.brand !== undefined) payload.brand = updates.brand?.trim() || null;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.description !== undefined) payload.description = updates.description?.trim() || null;
    if (updates.uom !== undefined) payload.uom = updates.uom;
    if (updates.purchaseCost !== undefined) payload.purchase_cost = updates.purchaseCost;
    if (updates.sellingPrice !== undefined) payload.selling_price = updates.sellingPrice;
    if (updates.taxRate !== undefined) payload.tax_rate = updates.taxRate;
    if (updates.hsnCode !== undefined) payload.hsn_code = updates.hsnCode?.trim() || null;
    if (updates.reorderThreshold !== undefined) payload.reorder_threshold = updates.reorderThreshold;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;
    if (updates.imageUrl !== undefined) payload.image_url = updates.imageUrl || null;

    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', productId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update product: ${error.message}`);
    }

    // Preserve stock count if provided
    const currentStock = updates.currentStock;
    return mapDbProduct(data, currentStock);
  },
};
