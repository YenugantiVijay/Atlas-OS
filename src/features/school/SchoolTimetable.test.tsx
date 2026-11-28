import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {SchoolTimetable} from './SchoolTimetable';
import {timetableService} from './timetable.service';
import {readTimetable} from './timetable-import';
vi.mock('./timetable-import',async importOriginal=>({...await importOriginal<typeof import('./timetable-import')>(),readTimetable:vi.fn()}));
const entries=[{day:1,start:540,end:585,activity:'teaching' as const,class:'5',section:'A',subject:'Science',room:'3'}];
const staff=[{staff_id:'staff-a',school_id:'T-001',position:'teacher' as const,revision:1,display_name:'Teacher X',joining_on:'2026-01-01',user_id:'user-a',is_active:true}];
function open(authority=true){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><SchoolTimetable orgId="school-a" userId="user-a" staff={staff} authority={authority} editable/></QueryClientProvider>);}
describe('Personal staff timetable',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(timetableService,'read').mockResolvedValue({current:null,history:[],latest_id:null,can_publish:true});vi.spyOn(timetableService,'publish').mockResolvedValue();vi.mocked(readTimetable).mockResolvedValue({entries,errors:[]});});
 it('requires a preview and explicit publishing for the selected school ID',async()=>{
  const user=userEvent.setup();open();await user.selectOptions(screen.getByLabelText('Timetable staff member'),'staff-a');const input=await screen.findByLabelText('Upload staff timetable Excel');
  const file=new File(['test'],'Monday.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode('test').buffer});
  await user.upload(input,file);expect(await screen.findByText(/Preview · Monday.xlsx/)).toBeVisible();expect(timetableService.publish).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'Publish timetable'}));
  await waitFor(()=>expect(timetableService.publish).toHaveBeenCalledWith('school-a','staff-a',expect.any(String),null,expect.any(String),entries,'Monday.xlsx','dGVzdA=='));
 });
 it('blocks invalid Excel periods',async()=>{
  vi.mocked(readTimetable).mockResolvedValue({entries,errors:['Monday: overlapping periods.']});const user=userEvent.setup();open();await user.selectOptions(screen.getByLabelText('Timetable staff member'),'staff-a');const input=await screen.findByLabelText('Upload staff timetable Excel');const file=new File(['x'],'Bad.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>new ArrayBuffer(1)});await user.upload(input,file);expect(await screen.findByRole('alert')).toHaveTextContent('overlapping');expect(screen.getByRole('button',{name:'Publish timetable'})).toBeDisabled();
 });
 it('gives staff a mobile weekly view without upload controls',async()=>{
  vi.mocked(timetableService.read).mockResolvedValue({current:{id:'version-a',revision:1,effective_on:'2026-01-01',filename:'Staff.xlsx',published_at:'',entries},history:[],latest_id:'version-a',can_publish:false});const user=userEvent.setup();open(false);await user.click(screen.getByRole('button',{name:'Show weekly timetable'}));expect(await screen.findByText('Science · Class 5 A · 3')).toBeVisible();expect(screen.queryByLabelText('Timetable staff member')).toBeNull();expect(screen.queryByLabelText('Upload staff timetable Excel')).toBeNull();
 });
});
