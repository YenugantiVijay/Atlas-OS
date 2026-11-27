import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {SchoolStaffPanel} from './SchoolStaff';
import {schoolStaffService} from '@/services/school-staff.service';
const person={staff_id:'staff-a',school_id:'T-001',position:'teacher',revision:2,display_name:'Teacher X',joining_on:'2026-01-01',user_id:'user-a',is_active:true};
function open(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter><SchoolStaffPanel orgId="school-a" userId="user-a" editable/></MemoryRouter></QueryClientProvider>);}
describe('School staff identity and leave',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(schoolStaffService,'read').mockImplementation(async(_org,area)=>({rows:['directory','self'].includes(area)?[person]:[],can_register:true,can_review:false}) as never);vi.spyOn(schoolStaffService,'command').mockResolvedValue();});
 it('keeps the school ID fixed while an authority changes position',async()=>{
  const user=userEvent.setup();open();await user.click(await screen.findByRole('button',{name:'Change position for T-001'}));
  expect(screen.getByLabelText(/School-issued staff ID/)).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Staff position'),'office_staff');await user.click(screen.getByRole('button',{name:'Save position'}));
  await waitFor(()=>expect(schoolStaffService.command).toHaveBeenCalledWith('school-a','register',expect.objectContaining({staff_id:'staff-a',school_id:'T-001',position:'office_staff',revision:2})));
 });
 it('shows self-service without management forms for an ordinary linked teacher',async()=>{
  vi.mocked(schoolStaffService.read).mockImplementation(async(_org,area)=>({rows:['directory','self'].includes(area)?[person]:[],can_register:false,can_review:false}) as never);open();
  expect(await screen.findByRole('button',{name:'Request leave'})).toBeVisible();expect(screen.queryByLabelText('School-issued staff ID')).toBeNull();expect(screen.queryByLabelText('Review reason (required for a decision)')).toBeNull();
 });
 it('keeps failed leave requests visible and reports an unconfirmed save',async()=>{
  vi.mocked(schoolStaffService.command).mockRejectedValue(Error('Connection lost; refresh before retrying.'));const user=userEvent.setup();open();
  await user.type(await screen.findByLabelText(/Leave reason/),'Medical appointment');await user.click(screen.getByRole('button',{name:'Request leave'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');expect(screen.getByLabelText(/Leave reason/)).toHaveValue('Medical appointment');
 });
});
