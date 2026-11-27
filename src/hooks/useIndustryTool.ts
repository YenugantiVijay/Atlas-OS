import { useOrg } from '@/features/organizations/OrgContext';
import { INDUSTRY_TOOLS, SPECIALTY_TOOL_ROUTES, isIndustryToolId, isSpecialtyToolId, type IndustryToolId } from '@/lib/industry-tools';
import type { Action } from '@/lib/permissions';
import type { BusinessCategory } from '@/types';

declare const __ATLAS_INDUSTRY_TOOL__: string | null;

const toolsByCategory: Partial<Record<BusinessCategory, IndustryToolId>> = {
  school: 'school',
  electrical_retail: 'electrical',
  electrical_wholesale_distributor: 'electrical',
  hardware_electrical: 'hardware',
  hardware_trade: 'hardware',
  electronics_trade: 'electronics',
  general_wholesale: 'retail-wholesale',
  agricultural_inputs: 'agricultural-inputs',
  ecommerce: 'ecommerce',
  banner_print_studio: 'banner-print-studio',
  ice_cream_stalls: 'ice-cream-stalls',
  ice_cream_distribution: 'ice-cream-distribution',
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
  if (Object.values(SPECIALTY_TOOL_ROUTES).some(route => path === route)) {
    return isSpecialtyToolId(tool) && SPECIALTY_TOOL_ROUTES[tool] === path;
  }
  if (!tool) return true;
  if (path === '/pos' || path === '/counter-shift') return tool === 'retail-wholesale';
  if (path === '/stock-count') return !isSpecialtyToolId(tool) || tool === 'ice-cream-distribution';
  if (path === '/ecommerce') return tool === 'ecommerce';
  return true;
}

const commonSpecialtyLinks = new Set([
  '/', '/support', '/invoices', '/payments', '/customers', '/reports/sales-receipts',
  '/team', '/attendance', '/attendance/my', '/settings', '/audit', ...Object.values(SPECIALTY_TOOL_ROUTES),
]);

export function showsIndustryNavigation(tool: IndustryToolId | undefined, path: string) {
  if (!allowsIndustryRoute(tool, path) || (tool === 'ice-cream-stalls' && path === '/customers')) return false;
  if (tool === 'school') return ['/', '/school', '/support', '/team', '/attendance', '/attendance/my', '/team/staff', '/team/advances', '/settings', '/audit'].includes(path);
  if (isSpecialtyToolId(tool)) return commonSpecialtyLinks.has(path) || path === '/stock-count';
  return tool !== 'ecommerce' || path !== '/orders';
}

export const toolTaskPermissions = {
  '/school': 'data:read',
  '/studio-jobs': 'data:read',
  '/ice-cream-counter': 'data:read',
  '/cold-chain': 'data:read',
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
  if (tool && (tool.id === 'ecommerce' || tool.id === 'retail-wholesale' || isSpecialtyToolId(tool.id))) return tool.primary;
  return { label: 'New Sales Order', path: '/orders?action=create' };
}
