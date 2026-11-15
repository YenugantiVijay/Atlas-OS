import type { Product } from '@/types';
import { calculateDocumentTotals } from '@/lib/money';

export interface PosCartLine {
  product: Product;
  quantity: number;
  discountPercent: number;
}

export interface PosOrderDraft {
  customerId: string;
  orderDate: string;
  notes?: string;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    productName: string;
    productSku: string;
    uom: Product['uom'];
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    taxRate: number;
  }>;
}

export function summarizePosCart(lines: PosCartLine[]) {
  return calculateDocumentTotals(lines.map(({ product, quantity, discountPercent }) => ({
    quantity,
    unitPrice: product.sellingPrice,
    discountPercent,
    taxRate: product.taxRate,
  })));
}

/**
 * POS foundation: prepare an authorized DRAFT sales-order command, not a payment,
 * invoice, inventory movement or stock reservation. The existing backend RPC
 * remains authoritative for tenant isolation, identities, totals and idempotency.
 */
export function buildPosOrderDraft(params: {
  organizationId: string;
  customerId: string;
  orderDate: string;
  notes?: string;
  idempotencyKey: string;
  lines: PosCartLine[];
}): PosOrderDraft {
  const { organizationId, customerId, orderDate, notes, idempotencyKey, lines } = params;
  if (!organizationId || !customerId || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || !idempotencyKey) {
    throw new Error('Select an organization, customer and valid business date.');
  }
  if (lines.length === 0 || lines.length > 50) {
    throw new Error('Add 1 to 50 products to the counter cart.');
  }
  const ids = new Set<string>();
  for (const { product, quantity, discountPercent } of lines) {
    if (product.organizationId !== organizationId || !product.isActive) {
      throw new Error('Only active products from the current business may be sold.');
    }
    if (ids.has(product.id)) {
      throw new Error('A product can only appear once; update its quantity instead.');
    }
    ids.add(product.id);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      throw new Error('Quantities must be whole numbers between 1 and 1,000,000.');
    }
    if (!Number.isFinite(product.sellingPrice) || product.sellingPrice < 0 ||
        !Number.isFinite(product.taxRate) || product.taxRate < 0 ||
        !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      throw new Error('Price, GST rate and discounts must be valid nonnegative numbers.');
    }
  }
  // Validate all money calculations before any RPC is attempted.
  summarizePosCart(lines);
  return {
    customerId,
    orderDate,
    notes: notes?.trim() || undefined,
    idempotencyKey,
    items: lines.map(({ product, quantity, discountPercent }) => ({
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      uom: product.uom,
      quantity,
      unitPrice: product.sellingPrice,
      discountPercent,
      taxRate: product.taxRate,
    })),
  };
}
