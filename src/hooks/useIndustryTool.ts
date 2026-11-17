import { useOrg } from '@/features/organizations/OrgContext';
import { INDUSTRY_TOOLS, isIndustryToolId, type IndustryToolId } from '@/lib/industry-tools';
import type { Action } from '@/lib/permissions';
import type { BusinessCategory } from '@/types';

declare const __ATLAS_INDUSTRY_TOOL__: string | null;

const toolsByCategory: Partial<Record<BusinessCategory, IndustryToolId>> = {
  electrical_retail: 'electrical',
  electrical_wholesale_distributor: 'electrical',
  hardware_electrical: 'hardware',
  hardware_trade: 'hardware',
  electronics_trade: 'electronics',
  general_wholesale: 'retail-wholesale',
  agricultural_inputs: 'agricultural-inputs',
  ecommerce: 'ecommerce',
  general_retail: 'small-business',
};

export function selectedIndustryTool() {
  if (typeof __ATLAS_INDUSTRY_TOOL__ === 'string' && isIndustryToolId(__ATLAS_INDUSTRY_TOOL__)) return __ATLAS_INDUSTRY_TOOL__;
  const tool = new URLSearchParams(window.location.search).get('tool');
  return isIndustryToolId(tool) ? tool : undefined;
}

export function useIndustryTool() {
  const { eligibility, isDemoMode } = useOrg();
  const category = eligibility?.businessCategory;
  const id = selectedIndustryTool() ?? (!isDemoMode && category ? toolsByCategory[category] : undefined);
  return id ? { id, ...INDUSTRY_TOOLS[id] } : undefined;
}

export function allowsIndustryRoute(tool: IndustryToolId | undefined, path: string) {
  if (!tool) return true;
  if (path === '/pos' || path === '/counter-shift') return tool === 'retail-wholesale';
  if (path === '/ecommerce') return tool === 'ecommerce';
  return true;
}

export const toolTaskPermissions = {
  '/quotations': 'data:read',
  '/inventory': 'data:read',
  '/payments': 'reports:financial',
  '/products': 'data:read',
  '/orders': 'data:read',
  '/receiving': 'inventory:receive',
  '/pos': 'orders:create',
  '/counter-shift': 'orders:create',
  '/supplier-prices': 'supplier-prices:read',
  '/ecommerce': 'data:read',
  '/invoices': 'reports:financial',
} as const satisfies Record<import('@/lib/industry-tools').IndustryTaskPath, Action>;

export function toolQuickOrder(tool: ReturnType<typeof useIndustryTool>) {
  if (tool?.id === 'ecommerce' || tool?.id === 'retail-wholesale') return tool.primary;
  return { label: 'New Sales Order', path: '/orders?action=create' };
}
