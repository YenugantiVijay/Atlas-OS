import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Product, UOM } from '@/types';
import { parseTaxRate } from '@/lib/money';

// Helper to map snake_case Postgres row to camelCase Product model
export function mapDbProduct(row: any, stock: number = 0): Product {
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
    taxRate: parseTaxRate(row.tax_rate, 18),
    hsnCode: row.hsn_code || undefined,
    reorderThreshold: Number(row.reorder_threshold) || 10,
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

    // 2. Fetch stock aggregations from stock_movements ledger
    const { data: movements, error: movErr } = await supabase
      .from('stock_movements')
      .select('product_id, quantity_change')
      .eq('organization_id', orgId);

    const stockMap: Record<string, number> = {};
    if (!movErr && movements) {
      for (const m of movements) {
        stockMap[m.product_id] = (stockMap[m.product_id] || 0) + Number(m.quantity_change);
      }
    } else if (movErr) {
      console.warn('Failed to load stock movements for product stock totals:', movErr.message);
    }

    return dbProducts.map((row) => mapDbProduct(row, stockMap[row.id] || 0));
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

    const payload = {
      organization_id: orgId,
      sku: input.sku.trim(),
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      category: input.category,
      description: input.description?.trim() || null,
      uom: input.uom || 'Nos',
      purchase_cost: input.purchaseCost,
      selling_price: input.sellingPrice,
      tax_rate: input.taxRate,
      hsn_code: input.hsnCode?.trim() || null,
      reorder_threshold: input.reorderThreshold,
      is_active: input.isActive ?? true,
    };

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create product: ${error.message}`);
    }

    if (openingStock > 0) {
      const { error: stockErr } = await supabase.from('stock_movements').insert({
        organization_id: orgId,
        product_id: data.id,
        quantity_change: openingStock,
        movement_type: 'OPENING_STOCK',
        reference_type: 'INITIAL_STOCK',
        notes: 'Initial opening stock',
      });

      if (stockErr) {
        throw new Error(`Product created, but failed to record initial stock movement: ${stockErr.message}`);
      }
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

    // Preserve stock count
    const currentStock = updates.currentStock ?? 0;
    return mapDbProduct(data, currentStock);
  },
};
