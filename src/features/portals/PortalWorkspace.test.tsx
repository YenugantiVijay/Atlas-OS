import { render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { PortalDirectory,PortalGate } from './PortalWorkspace';
import { FamilyPortal } from './FamilyPortal';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
vi.mock('@/features/organizations/OrgContext',()=>({useOrg:()=>({currentOrg:{id:'org-a'},currentUser:{id:'user-a'},isAuthenticated:true,isDemoMode:false,signOut:vi.fn(),eligibility:{status:'approved'}})}));
function open(ui:React.ReactNode,path='/'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);}
afterEach(()=>window.history.replaceState({},'','/'));
beforeEach(()=>rpc.mockReset());
describe('Server-authorized role portals',()=>{
 it('offers separate school entry URLs without showing another company',()=>{
  window.history.replaceState({},'','/?tool=school');open(<PortalDirectory/>);
  expect(screen.getByRole('link',{name:'Parent sign in'})).toHaveAttribute('href',expect.stringContaining('tool=school&portal=parent'));
  expect(screen.getByRole('link',{name:'Teacher sign in'})).toBeVisible();expect(screen.queryByText('Electronics Wholesale')).toBeNull();
 });
 it('keeps workspace data hidden when the server rejects the selected role',async()=>{
  window.history.replaceState({},'','/?tool=school&portal=school_admin');rpc.mockResolvedValue({data:{product:'school',portals:['parent'],allowed:false},error:null});
  open(<PortalGate><div>Private school administrator data</div></PortalGate>);
  expect(await screen.findByRole('heading',{name:'This portal is not assigned to your account'})).toBeVisible();expect(screen.queryByText('Private school administrator data')).toBeNull();
  expect(screen.getByRole('link',{name:'Parent sign in'})).toBeVisible();expect(screen.queryByRole('link',{name:'School Admin sign in'})).toBeNull();
 });
 it('fails closed when access verification fails',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'offline'}});open(<PortalGate><div>Private ERP records</div></PortalGate>);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');expect(screen.queryByText('Private ERP records')).toBeNull();
 });
 it('does not render invoices inside an authorized employee portal',async()=>{
  window.history.replaceState({},'','/?tool=electrical&portal=employee');rpc.mockResolvedValue({data:{product:'electrical',portals:['employee'],allowed:true},error:null});
  open(<PortalGate><div>Private invoices</div></PortalGate>,'/invoices');expect(await screen.findByRole('heading',{name:'Use your assigned portal'})).toBeVisible();expect(screen.queryByText('Private invoices')).toBeNull();
 });
 it('opens the authorized employee attendance area',async()=>{
  window.history.replaceState({},'','/?tool=electrical&portal=employee');rpc.mockResolvedValue({data:{product:'electrical',portals:['employee'],allowed:true},error:null});
  open(<PortalGate><div>My attendance</div></PortalGate>,'/attendance/my');expect(await screen.findByText('My attendance')).toBeVisible();
  expect(rpc).toHaveBeenCalledWith('atlas_portal_access',{p_org:'org-a',p_product:'electrical',p_portal:'employee'});
 });
 it('loads family records through the linked-record RPC rather than the school-wide student directory',async()=>{
  window.history.replaceState({},'','/?tool=school&portal=parent');rpc.mockResolvedValue({data:[{id:'student-a',name:'My Linked Child',admission_no:'A-01',enrolments:[{year:'2026-27',class:'Class 5',section:'A',balance_paise:12345,attendance:[],receipts:[]}]}],error:null});
  open(<FamilyPortal/>);expect(await screen.findByRole('heading',{name:'My Linked Child · A-01'})).toBeVisible();expect(screen.getByText('₹123.45')).toBeVisible();expect(rpc).toHaveBeenCalledWith('school_my_records',{p_org:'org-a',p_portal:'parent'});expect(screen.queryByRole('button',{name:'Add student'})).toBeNull();
 });
});
