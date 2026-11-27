import type { BusinessCategory } from '@/types';

export const DEFAULT_BUSINESS_CATEGORY: BusinessCategory = 'general_retail';

export const BUSINESS_CATEGORIES: Record<BusinessCategory, { label: string; electrical: boolean; products: string[]; unit: 'Nos' | 'Bags' }> = {
  school: { label: 'School Management', electrical: false, products: ['School education'], unit: 'Nos' },
  general_retail: { label: 'Small Shop / General Retail', electrical: false, products: ['General Merchandise', 'Packaged Goods', 'Household Supplies', 'Stationery'], unit: 'Nos' },
  general_wholesale: { label: 'General Wholesale & Distribution', electrical: false, products: ['General Merchandise', 'Packaged Goods', 'Consumables'], unit: 'Nos' },
  agricultural_inputs: { label: 'Fertilizers & Agri Inputs', electrical: false, products: ['Fertilizers', 'Seeds', 'Soil Nutrients', 'Farm Supplies'], unit: 'Bags' },
  electronics_trade: { label: 'Electronics & Components', electrical: false, products: ['Electronics', 'Components', 'Accessories'], unit: 'Nos' },
  hardware_trade: { label: 'Hardware & Tools', electrical: false, products: ['Tools & Hardware', 'Fasteners', 'Building Supplies'], unit: 'Nos' },
  electrical_wholesale_distributor: { label: 'Electrical Wholesaler / Distributor', electrical: true, products: ['Wires & Cables', 'Switches & Sockets', 'Switchgear & Protection', 'LED Lighting', 'Fans & Ventilation', 'Conduits & PVC Fittings', 'Motors & Starters', 'Solar & Inverter Equipment'], unit: 'Nos' },
  electrical_retail: { label: 'Electrical Retail Shop', electrical: true, products: ['Wires & Cables', 'Switches & Sockets', 'LED Lighting', 'Fans & Ventilation'], unit: 'Nos' },
  hardware_electrical: { label: 'Hardware & Electrical Store', electrical: true, products: ['Wires & Cables', 'Switches & Sockets', 'Tools & Hardware', 'Fasteners'], unit: 'Nos' },
  ecommerce: { label: 'E-commerce / Online Sales', electrical: false, products: ['Apparel', 'Accessories', 'Home & Living', 'Packaged Goods'], unit: 'Nos' },
  banner_print_studio: { label: 'Banner & Print Studio', electrical: false, products: ['Flex Banners', 'Vinyl Prints', 'Sign Boards'], unit: 'Nos' },
  ice_cream_stalls: { label: 'Ice Cream Stalls', electrical: false, products: ['Packaged Cups', 'Cones', 'Scoop Tubs'], unit: 'Nos' },
  ice_cream_distribution: { label: 'Ice Cream Distribution', electrical: false, products: ['Factory Cases', 'Frozen Desserts', 'Multipacks'], unit: 'Nos' },
  other_unsupported: { label: 'Specialized workflow / other', electrical: false, products: [], unit: 'Nos' },
};

export const BUSINESS_CATEGORY_OPTIONS = (Object.keys(BUSINESS_CATEGORIES) as BusinessCategory[])
  .map((id) => ({ id, ...BUSINESS_CATEGORIES[id] }));
