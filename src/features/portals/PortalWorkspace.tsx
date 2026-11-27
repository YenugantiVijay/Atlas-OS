import { useState } from 'react';
import { BusinessVerificationModal } from '@/features/organizations/BusinessVerificationModal';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOrg } from '@/features/organizations/OrgContext';
import { supabase } from '@/lib/supabase';
import { INDUSTRY_TOOLS, type IndustryToolId } from '@/lib/industry-tools';
import { PORTALS, invalidPortalEntry, portalEntry, portalHref, portalPathAllowed, productEntry, productName, type PortalId } from '@/lib/portal-entry';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ReactNode } from 'react';

export interface PortalAccess { product: IndustryToolId; portals: PortalId[]; allowed: boolean }
export function usePortalAccess() {
  const { currentOrg, currentUser, isAuthenticated, isDemoMode } = useOrg();
  return useQuery({queryKey:['portal-access',currentOrg?.id,currentUser?.id,productEntry(),portalEntry()], enabled:!!currentOrg && !!currentUser && isAuthenticated && !isDemoMode,
    queryFn:async()=>{const {data,error}=await supabase!.rpc('atlas_portal_access',{p_org:currentOrg!.id,p_product:productEntry()??null,p_portal:portalEntry()});
      if(error || !data || !Array.isArray(data.portals) || !Object.prototype.hasOwnProperty.call(INDUSTRY_TOOLS,data.product)) throw new Error('Portal access could not be verified. Check your account permissions and confirm the product portal migration is installed.');
      return data as PortalAccess;},retry:false,refetchInterval:30_000,refetchOnWindowFocus:'always'});
}
export function PortalDirectory({ access }: {access?:PortalAccess}) {
  const product=productEntry();
  return <Card className="space-y-4"><h2 className="text-xl font-bold">Choose your product and portal</h2><p className="text-sm text-content-secondary">Each workspace subscription covers its bound product. Sign in with your own account; the workspace owner grants your role. Staff and family portals do not grant another product subscription.</p>
    <div className="grid gap-4 md:grid-cols-2">{Object.entries(INDUSTRY_TOOLS).filter(([id])=>access ? id===access.product : !product || id===product).map(([id,tool])=><section key={id} className="rounded-xl border border-border p-4 space-y-3"><h3 className="font-semibold">{tool.name}</h3>
      <div className="flex flex-wrap gap-2">{(id==='school'?['workspace','school_admin','admissions','teacher','school_accounts','parent','student','manager','employee']:['owner','workspace','manager','employee']).filter(portal=>!access || access.portals.includes(portal as PortalId)).map(portal=><a key={portal} href={portalHref(id as IndustryToolId,portal as PortalId)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">{PORTALS[portal as PortalId]} sign in</a>)}</div></section>)}</div>
    {product && !access && <p className="text-xs text-content-secondary">Opening a portal starts its own sign-in session. It does not copy another product’s selected workspace or saved local records.</p>}
  </Card>;
}
export function PortalGate({children}:{children:ReactNode}) {
  const {currentOrg,isAuthenticated,isDemoMode,signOut,eligibility,currentRole}=useOrg(); const access=usePortalAccess(); const [review,setReview]=useState(false); const location=useLocation(); const navigate=useNavigate();
  // Rejected workspaces retain the existing identity-review recovery screen; server reads/writes remain denied.
  if(invalidPortalEntry()) return <Card><h1 className="font-bold">Unknown product or portal</h1><p>Choose a supported entry point below.</p><PortalDirectory /></Card>;
  if(!isAuthenticated || isDemoMode || !currentOrg || eligibility?.status === 'rejected')return <>{children}</>;
  if(access.isPending)return <Card role="status">Verifying product subscription and portal permissions…</Card>;
  if(access.isError)return <Card className="space-y-3"><p role="alert">{access.error.message}</p><Button onClick={()=>void access.refetch()}>Retry portal access</Button><Button variant="outline" onClick={()=>void signOut()}>Sign out</Button>{currentRole === 'owner' && <Button variant="outline" onClick={()=>setReview(true)}>Review workspace product</Button>}{review && currentRole === 'owner' && <BusinessVerificationModal isOpen onClose={()=>{setReview(false);void access.refetch();}}/>}</Card>;
  if(!access.data?.allowed)return <div className="space-y-4"><Card><h1 className="text-xl font-bold">This portal is not assigned to your account</h1><p className="mt-2 text-sm">{productName(access.data?.product)} is bound to this workspace. Ask the owner for the appropriate role or use an assigned portal below.</p></Card><PortalDirectory access={access.data}/><Button variant="outline" onClick={()=>void signOut()}>Sign out and use another account</Button></div>;
  if(!portalPathAllowed(portalEntry(),location.pathname))return <Card className="space-y-3"><h1 className="text-xl font-bold">Use your assigned portal</h1><p>This page is outside the selected portal.</p><Button onClick={()=>navigate(portalEntry()==='employee'||portalEntry()==='manager'?'/attendance/my':'/school')}>Open my portal</Button></Card>;
  return <>{children}</>;
}
export function PortalsPage(){const access=usePortalAccess();return <PortalDirectory access={access.data}/>;}
