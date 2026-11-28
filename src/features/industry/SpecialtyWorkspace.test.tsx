vi.mock('./InvoiceReviews',()=>({InvoiceReviews:()=>null}));
vi.mock('./HandoverReport',()=>({HandoverReport:()=>null}));
vi.mock('./LocationAccess',()=>({LocationAccess:()=>null}));
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import SpecialtyWorkspace from './SpecialtyWorkspace';
import {readOperations,saveOperation,resolveOperation,OperationUnconfirmedError} from './operations';
const state=vi.hoisted(()=>({org:'org-a',role:'owner'}));
vi.mock('@/features/organizations/OrgContext',()=>({useOrg:()=>({currentOrg:{id:state.org},currentUser:{id:'user-a'},currentRole:state.role,isMockAuth:false,canWriteOperations:true})}));
vi.mock('@/hooks/useIndustryTool',()=>({useIndustryTool:()=>({id:'ice-cream-stalls',name:'Stalls',headline:'Stall operations',description:'Test'})}));
vi.mock('./operations',async original=>({...await original<typeof import('./operations')>(),readOperations:vi.fn(),saveOperation:vi.fn(),resolveOperation:vi.fn()}));
vi.mock('./IceDesk',()=>({IceDesk:({canWrite,save}:{canWrite:boolean;save:(c:unknown)=>Promise<boolean>})=><button disabled={!canWrite} onClick={()=>void save({kind:'sale',site:'STALL 1',sku:'VANILLA',quantity:1,amount_paise:100,method:'cash'})}>Record test sale</button>}));
const snapshot={today:'2026-11-28',stock:[],series:[],tills:[],events:[]};
describe('Client operation recovery and workspace isolation',()=>{
 beforeEach(()=>{vi.mocked(resolveOperation).mockReset().mockResolvedValue(false);localStorage.clear();state.org='org-a';state.role='owner';vi.mocked(readOperations).mockReset().mockResolvedValue(snapshot);vi.mocked(saveOperation).mockReset().mockResolvedValue();});
 it('freezes edits after a lost response and retries the exact original request',async()=>{
  vi.mocked(saveOperation).mockRejectedValueOnce(new OperationUnconfirmedError('Connection lost'));const user=userEvent.setup();render(<SpecialtyWorkspace/>);
  await user.click(await screen.findByRole('button',{name:'Record test sale'}));expect(await screen.findByRole('button',{name:'Retry unchanged operation'})).toBeVisible();expect(screen.getByRole('button',{name:'Record test sale'})).toBeDisabled();
  const first=vi.mocked(saveOperation).mock.calls[0];await user.click(screen.getByRole('button',{name:'Retry unchanged operation'}));await waitFor(()=>expect(saveOperation).toHaveBeenCalledTimes(2));expect(vi.mocked(saveOperation).mock.calls[1]).toEqual(first);await waitFor(()=>expect(screen.queryByRole('button',{name:'Retry unchanged operation'})).toBeNull());
 });
 it('preserves an uncertain request across a reload without replaying automatically',async()=>{
  vi.mocked(saveOperation).mockRejectedValueOnce(new OperationUnconfirmedError('Connection lost'));const user=userEvent.setup();render(<SpecialtyWorkspace/>);await user.click(await screen.findByRole('button',{name:'Record test sale'}));await screen.findByRole('button',{name:'Retry unchanged operation'});const first=vi.mocked(saveOperation).mock.calls[0];cleanup();render(<SpecialtyWorkspace/>);
  await screen.findByRole('button',{name:'Retry unchanged operation'});expect(saveOperation).toHaveBeenCalledTimes(1);await user.click(screen.getByRole('button',{name:'Retry unchanged operation'}));await waitFor(()=>expect(saveOperation).toHaveBeenCalledTimes(2));expect(vi.mocked(saveOperation).mock.calls[1]).toEqual(first);
 });
 it('resolves an unsaved request before allowing a different operation',async()=>{
  vi.mocked(saveOperation).mockRejectedValueOnce(new OperationUnconfirmedError('Connection lost'));const user=userEvent.setup();render(<SpecialtyWorkspace/>);await user.click(await screen.findByRole('button',{name:'Record test sale'}));await user.click(await screen.findByRole('button',{name:'Check status / cancel if unsaved'}));await waitFor(()=>expect(resolveOperation).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole('button',{name:'Record test sale'})).toBeEnabled());expect(saveOperation).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(0);
 });
 it('clears privileged cached views when the same account loses its administrator role',async()=>{
  const view=render(<SpecialtyWorkspace/>);await screen.findByRole('button',{name:'Record test sale'});vi.mocked(readOperations).mockImplementation(()=>new Promise(()=>{}));state.role='sales';view.rerender(<SpecialtyWorkspace/>);expect(screen.queryByRole('button',{name:'Record test sale'})).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Loading');
 });
 it('does not show a previous workspace snapshot or request after switching organizations',async()=>{
  const view=render(<SpecialtyWorkspace/>);await screen.findByRole('button',{name:'Record test sale'});vi.mocked(readOperations).mockImplementation(()=>new Promise(()=>{}));state.org='org-b';view.rerender(<SpecialtyWorkspace/>);expect(screen.queryByRole('button',{name:'Record test sale'})).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Loading');
 });
});
