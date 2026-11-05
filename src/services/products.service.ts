import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Product, UOM, PaginationParams, PaginatedResult } from '@/types';
import { parseTaxRate } from '@/lib/money';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';

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
  async getProductsPaginated(
    orgId: string,
    params: PaginationParams = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<Product>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const allProducts = await storage.getProducts(orgId);
      return paginateArray(
        allProducts,
        params,
        (p, s) =>
          p.name.toLowerCase().includes(s) ||
          p.sku.toLowerCase().includes(s) ||
          Boolean(p.brand && p.brand.toLowerCase().includes(s)) ||
          p.category.toLowerCase().includes(s),
        (a, b) => a.name.localeCompare(b.name)
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId);

    if (params.search && params.search.trim()) {
      // Sanitize search term to prevent PostgREST grammar breakage
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').trim();
      if (s) {
        query = query.or(`name.ilike.%${s}%,sku.ilike.%${s}%,brand.ilike.%${s}%`);
      }
    }

    if (params.category && params.category !== 'ALL') {
      query = query.eq('category', params.category);
    }

    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    // Allowlisted sort fields to prevent invalid SQL column errors
    const ALLOWED_PROD_SORT_FIELDS: Record<string, string> = {
      name: 'name',
      sku: 'sku',
      category: 'category',
      brand: 'brand',
      purchasePrice: 'purchase_cost',
      purchaseCost: 'purchase_cost',
      createdAt: 'created_at',
    };
    const sortBy = ALLOWED_PROD_SORT_FIELDS[params.sortBy || 'name'] || 'name';
    const ascending = params.sortOrder === 'desc' ? false : true;

    // Deterministic sorting with secondary tie-breaker by primary key id
    query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

    const { data: dbProducts, error: prodErr, count } = await query;

    if (prodErr) {
      throw new Error(`Failed to fetch products: ${prodErr.message}`);
    }

    const totalCount = count || 0;
    if (!dbProducts || dbProducts.length === 0) {
      return buildPaginatedResult([], totalCount, page, pageSize);
    }

    // Page-scoped authoritative stock aggregations: only fetch stock for current page items
    const pageProductIds = dbProducts.map((p) => p.id);
    let stockLevels: unknown = null;

    const { data: pageStock, error: pageStockErr } = await supabase.rpc('get_page_product_stock_levels', {
      p_org_id: orgId,
      p_product_ids: pageProductIds,
    });

    if (pageStockErr) {
      // Resilient fallback to get_product_stock_levels if page RPC is unavailable
      const { data: fallbackStock, error: fallbackErr } = await supabase.rpc('get_product_stock_levels', {
        p_org_id: orgId,
      });
      if (fallbackErr) {
        throw new Error(`Failed to load stock totals from authoritative database: ${fallbackErr.message}`);
      }
      stockLevels = fallbackStock;
    } else {
      stockLevels = pageStock;
    }

    const stockMap = new Map<string, number>();
    if (Array.isArray(stockLevels)) {
      for (const item of stockLevels as Array<{ product_id: string; current_stock: number | string }>) {
        const parsedStock = Number(item.current_stock);
        stockMap.set(item.product_id, Number.isFinite(parsedStock) ? parsedStock : 0);
      }
    }

    const mappedProducts = dbProducts.map((row) => {
      const stock = stockMap.has(row.id) ? stockMap.get(row.id)! : 0;
      return mapDbProduct(row, stock);
    });

    return buildPaginatedResult(mappedProducts, totalCount, page, pageSize);
  },

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
