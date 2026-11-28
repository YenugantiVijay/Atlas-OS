import {render,screen,waitFor,fireEvent,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {SchoolImport} from './SchoolStudents';
import {CommandForm,type SchoolScope} from './SchoolShared';
import {schoolService} from './school.service';
import {schoolImportHeaders} from './school-import';
const scope:SchoolScope={orgId:'org-a',userId:'user-a',editable:true,bootstrap:{role:'owner',settings:null,years:[{id:'year-a',name:'2026',starts_on:'2026-01-01',ends_on:'2026-12-31'}],classes:[{id:'class-a',year_id:'year-a',name:'Class 5',section:'A'}],terms:[],calendar:[],fee_categories:[],roles:[],members:[],teacher_classes:[]}};
function open(ui:React.ReactNode){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);}
describe('School real-world data entry',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(schoolService,'command').mockResolvedValue({receipt_id:'receipt-a'});vi.spyOn(schoolService,'read').mockResolvedValue([]);});
 it('clears a confirmed payment amount while retaining the default date',async()=>{
  const user=userEvent.setup();open(<CommandForm scope={scope} title="Payment" action="payment" initial={{paid_on:'2026-11-28'}} fields={[{name:'amount',label:'Amount'},{name:'paid_on',label:'Payment date',type:'date'}]}/>);
  await user.type(screen.getByLabelText(/Amount/),'1250');await user.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(screen.getByLabelText(/Amount/)).toHaveValue(''));expect(screen.getByLabelText(/Payment date/)).toHaveValue('2026-11-28');expect(schoolService.command).toHaveBeenCalledTimes(1);
 });
 it('cannot replace the newest student CSV with a slower old file read',async()=>{
  const user=userEvent.setup();open(<SchoolImport scope={scope} yearId="year-a" onSaved={()=>{}}/>);await user.selectOptions(screen.getByLabelText('Import class and section'),'class-a');
  const csv=(id:string,name:string)=>schoolImportHeaders.join(',')+'\n'+[id,name,'2015-01-01','Guardian','9000000000','','','','2026-01-01'].join(',');
  let finishOld!:(s:string)=>void;const old=new Promise<string>(r=>{finishOld=r;});const input=screen.getByLabelText('Student CSV file');
  fireEvent.change(input,{target:{files:[{size:100,text:()=>old}]}});fireEvent.change(input,{target:{files:[{size:100,text:async()=>csv('NEW-ID','New Student')}]}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview and check duplicates'})).toBeEnabled());await act(async()=>finishOld(csv('OLD-ID','Old Student')));
  await user.click(screen.getByRole('button',{name:'Preview and check duplicates'}));expect(await screen.findByText(/NEW-ID · New Student/)).toBeVisible();expect(screen.queryByText(/OLD-ID · Old Student/)).toBeNull();
 });
});
