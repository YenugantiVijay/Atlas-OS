import type { Product, UOM } from '@/types';

export interface ReceivingProductFields {
  name: string;
  sku: string;
  brand: string;
  category: string;
  uom: UOM;
  inboundRate: string;
  sellingPrice: string;
  taxRate: string;
  hsnCode: string;
}

const money = (value: string, label: string): number => {
  const clean = value.trim();
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(clean)) {
    throw new Error(label + ' must be a valid nonnegative amount with at most two decimals.');
  }
  return Number(clean);
};

/** Uses the existing guarded product-creation RPC. Opening stock is ALWAYS zero:
 * only posting the associated goods receipt can create the new stock movement. */
export function prepareReceivingProduct(
  fields: ReceivingProductFields,
): Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'currentStock'> {
  const name = fields.name.trim();
  const sku = fields.sku.trim().toUpperCase();
  const category = fields.category.trim();
  const brand = fields.brand.trim();
  const hsnCode = fields.hsnCode.trim();

  if (!name || name.length > 255) throw new Error('Product name is required (up to 255 characters).');
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,99}$/.test(sku)) {
    throw new Error('SKU is required; use up to 100 letters, digits, hyphens, dots, underscores or slashes.');
  }
  if (!category || category.length > 100) throw new Error('Category is required (up to 100 characters).');
  if (brand.length > 255) throw new Error('Brand/company must be 255 characters or fewer.');
  if (!['Nos','Coils','Meters','Boxes','Bundles','Sets','Rolls','Bags','Kg','Litres','Packs'].includes(fields.uom)) {
    throw new Error('Choose a supported unit of measurement.');
  }
  if (hsnCode && !/^\d{4}(\d{2})?(\d{2})?$/.test(hsnCode)) {
    throw new Error('HSN must contain 4, 6 or 8 digits, or be left blank.');
  }
  const purchaseCost = money(fields.inboundRate, 'Incoming purchase rate');
  const sellingPrice = money(fields.sellingPrice, 'Selling price');
  const rate = fields.taxRate.trim();
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) {
    throw new Error('GST rate must be between 0 and 100 with at most two decimals.');
  }
  return {
    name, sku, brand: brand || undefined, category, uom: fields.uom,
    purchaseCost, sellingPrice, taxRate: Number(rate),
    hsnCode: hsnCode || undefined,
    reorderThreshold: 10, isActive: true,
  };
}
