import { INDUSTRY_TOOLS, isIndustryToolId, type IndustryToolId } from './industry-tools';

export const PORTALS = {
  workspace: 'Workspace', owner: 'Owner / Admin', manager: 'Manager / HR', employee: 'Employee',
  admissions: 'Admissions', school_admin: 'School Admin', teacher: 'Teacher', school_accounts: 'School Accounts', parent: 'Parent', student: 'Student',
} as const;
export type PortalId = keyof typeof PORTALS;
declare const __ATLAS_INDUSTRY_TOOL__: string | null;
export function productEntry(search = typeof window === 'undefined' ? '' : window.location.search): IndustryToolId | undefined {
  if (typeof __ATLAS_INDUSTRY_TOOL__ === 'string' && isIndustryToolId(__ATLAS_INDUSTRY_TOOL__)) return __ATLAS_INDUSTRY_TOOL__;
  const id = new URLSearchParams(search).get('tool'); return isIndustryToolId(id) ? id : undefined;
}
export function portalEntry(search = typeof window === 'undefined' ? '' : window.location.search): PortalId {
  const id = new URLSearchParams(search).get('portal');
  return id && Object.prototype.hasOwnProperty.call(PORTALS, id) ? id as PortalId : 'workspace';
}
export function invalidPortalEntry() {
 if(typeof window === 'undefined') return false;
 const params=new URLSearchParams(window.location.search); const portal=params.get('portal');
 return (params.has('tool') && !productEntry()) || (!!portal && !Object.prototype.hasOwnProperty.call(PORTALS,portal));
}
export function sessionScope() { if(invalidPortalEntry()) return 'atlas-invalid-entry-v1'; const product = productEntry(); return product ? `atlas-${product}-${portalEntry()}-v1` : undefined; }
export function portalHref(product: IndustryToolId, portal: PortalId) {
  const url = new URL(window.location.href); url.search = ''; url.searchParams.set('tool', product); url.searchParams.set('portal', portal);
  url.hash = portal === 'employee' || portal === 'manager' ? '/attendance/my' : product === 'school' ? '/school' : '/';
  return url.href;
}
export function productName(id?: string) { return isIndustryToolId(id ?? null) ? INDUSTRY_TOOLS[id as IndustryToolId].name : 'Atlas OS'; }
export function portalPathAllowed(portal: PortalId, path: string) {
  if (['workspace','owner'].includes(portal)) return true;
  if (path === '/portals' || path === '/support') return true;
  if (portal === 'employee') return path === '/attendance/my' || path === '/';
  if (portal === 'manager') return ['/','/attendance','/attendance/my','/team/staff','/team/advances'].includes(path);
  return path === '/school' || path === '/' || (portal !== 'parent' && portal !== 'student' && path === '/attendance/my');
}

export function filterProductWorkspaces<T extends { id:string }>(orgs:T[], allowed:unknown):T[] {
 if(!Array.isArray(allowed)||!allowed.every(row=>row && typeof row==='object' && typeof row.organization_id==='string')) throw new Error('Product workspace access could not be verified.');
 const ids=new Set(allowed.map(row=>row.organization_id));return orgs.filter(org=>ids.has(org.id));
}

export function portalStorageKey(key:string) { return sessionScope() ? sessionScope() + ':local:' + key : key; }

export const PORTAL_DESCRIPTIONS: Record<PortalId,string> = {
 workspace: 'Sign in to your assigned workspace.', owner: 'Manage your organization through your assigned owner or administrator account.',
 manager: 'Review authorized team attendance, daily work reports and staff attendance history.',
 employee: 'Check in and out, record breaks, submit daily work reports and review your own attendance.',
 school_admin: 'Manage school setup, admissions, student records, attendance and authorized school accounts.',
 admissions: 'Review enquiries and applications, admit students and manage class enrolments.',
 teacher: 'View your assigned classes and student records, and record student attendance.',
 school_accounts: 'Record school fee collections and review receipts, dues and adjustment requests.',
 parent: 'View only your linked child’s school records, attendance and fee information. Ask the school owner to link your own account.',
 student: 'View your linked student record, attendance and fee information using the account assigned by your school.'
};
