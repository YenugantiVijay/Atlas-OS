import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchoolPage } from './SchoolPage';
import { CommandForm, type SchoolScope } from './SchoolShared';
import { schoolService, SchoolUnconfirmedError } from './school.service';
import type { SchoolBootstrap } from './school.types';
import { getBusinessDate } from '@/lib/dates';
const state = vi.hoisted(() => ({ demo: false, editable: true }));
vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: () => ({ currentOrg: { id: 'org-a' }, currentUser: { id: 'user-a' }, currentRole: 'owner', isAuthenticated: true, get isDemoMode() { return state.demo; }, get canWriteOperations() { return state.editable; } }) }));
const bootstrap: SchoolBootstrap = { role: 'owner', settings: { name: 'Test School', address: '', phone: '', email: '', board: '', logo_url: '', receipt_prefix: 'SCH', grading_notes: '' },
  years: [{ id: 'year-a', name: '2026-27', starts_on: '2026-01-01', ends_on: '2026-12-31' }], classes: [{ id: 'class-a', year_id: 'year-a', name: 'Class 5', section: 'A' }], terms: [], calendar: [], fee_categories: [], roles: [], members: [], teacher_classes: [] };
function open(ui = <SchoolPage />, entry = '/') {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter></QueryClientProvider>);
}
describe('School workspace permissions and explicit attendance', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); state.demo = false; state.editable = true;
    vi.spyOn(schoolService, 'bootstrap').mockResolvedValue(bootstrap);
    vi.spyOn(schoolService, 'read').mockImplementation(async (_org, area) => (area === 'dashboard' ? {students:1,classes:1,pending_admissions:0,today_recorded:0} : {rows:[],count:0}) as never);
  });
  it('does not simulate cloud school data in demo mode', () => {
    state.demo = true; open(); expect(screen.getByRole('heading',{name:'School workspace preview'})).toBeVisible(); expect(schoolService.bootstrap).not.toHaveBeenCalled();
  });
  it('gives the owner setup, admissions, finance and school permission sections', async () => {
    open(); expect(await screen.findByRole('button',{name:'School permissions'})).toBeVisible();
    for(const name of ['School setup','Admissions','Fees & receipts','Student attendance']) expect(screen.getByRole('button',{name})).toBeVisible();
  });
  it('switches school sections through the phone selector',async()=>{
    const user=userEvent.setup();open();const selector=await screen.findByLabelText('School section');await user.selectOptions(selector,'setup');expect(await screen.findByRole('heading',{name:'School profile and receipt settings'})).toBeVisible();expect(selector).toHaveValue('setup');
  });
  it('shows teachers only school students and attendance, keeping unmarked rows unsaved until selected', async () => {
    vi.mocked(schoolService.bootstrap).mockResolvedValue({...bootstrap,role:'teacher'});
    vi.mocked(schoolService.read).mockImplementation(async (_org,area) => (area==='attendance' ? {rows:[{enrolment_id:'enrol-a',name:'Asha Student',admission_no:'S-1',status:null,revision:null,reason:null,recorded_at:null}],count:1} : {rows:[],count:0}) as never);
    const command=vi.spyOn(schoolService,'command').mockResolvedValue({saved:1}); const user=userEvent.setup(); open(<SchoolPage />,'/?section=attendance');
    await user.selectOptions(await screen.findByLabelText('Attendance class and section'),'class-a');
    expect(await screen.findByText('Saved: Unmarked')).toBeVisible(); expect(screen.queryByRole('button',{name:'School permissions'})).toBeNull(); expect(screen.queryByRole('button',{name:'Fees & receipts'})).toBeNull();
    expect(screen.getByRole('button',{name:'Save selected attendance'})).toBeDisabled(); expect(command).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Status for Asha Student'),'present'); await user.click(screen.getByRole('button',{name:'Save selected attendance'}));
    await waitFor(()=>expect(command).toHaveBeenCalledWith('org-a','attendance',{class_id:'class-a',day:getBusinessDate(),rows:[{enrolment_id:'enrol-a',status:'present',reason:'',revision:0}]},expect.any(String)));
  });
  it('blocks edits on unconfirmed payment and reuses the same request key after refresh', async () => {
    const scope: SchoolScope={orgId:'org-a',userId:'user-a',editable:true,bootstrap};
    const command=vi.spyOn(schoolService,'command').mockRejectedValueOnce(new SchoolUnconfirmedError('Connection lost; refresh first.')).mockResolvedValue({receipt_id:'receipt-a'});
    const user=userEvent.setup(); open(<CommandForm scope={scope} title="Test payment" action="payment" fields={[{name:'amount',label:'Amount'}]} initial={{amount:'100'}} />);
    await user.click(screen.getByRole('button',{name:'Save'})); await screen.findByRole('alert');
    expect(screen.getByRole('textbox',{name:'Amount'})).toBeDisabled(); expect(screen.getByRole('button',{name:'Save'})).toBeDisabled();
    await user.click(screen.getByRole('button',{name:'Refresh and review school records'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Save'})).toBeEnabled());
    await user.click(screen.getByRole('button',{name:'Save'})); await waitFor(()=>expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[0][3]).toBe(command.mock.calls[1][3]);
  });
});
