import {useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Card} from '@/components/ui/Card';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Select} from '@/components/ui/Select';
import {getBusinessDate} from '@/lib/dates';
import type {SchoolStaff} from '@/services/school-staff.service';
import {clockText,weekdays,readTimetable,downloadTimetableTemplate,saveTimetableFile,type TimetableEntry} from './timetable-import';
import {timetableService} from './timetable.service';

export function SchoolTimetable({orgId,userId,staff,authority,editable}:{orgId:string;userId:string;staff:SchoolStaff[];authority:boolean;editable:boolean}) {
 const [selected,setSelected]=useState('');
 return <Card className="space-y-4"><h2 className="font-semibold">Staff timetable</h2>
  {authority&&<Select label="Timetable staff member" value={selected} onChange={e=>setSelected(e.target.value)} options={[{value:'',label:'My timetable'},...staff.map(s=>({value:s.staff_id,label:`${s.school_id} · ${s.display_name}`}))]}/>}
  {authority&&<p className="text-xs">Staff choices follow the directory page above. Choose a staff member to upload their timetable.</p>}
  <PersonalTimetable key={orgId+':'+userId+':'+selected} orgId={orgId} userId={userId} staffId={selected||null} editable={editable}/>
 </Card>;
}
interface Upload {entries:TimetableEntry[];errors:string[];original:string;filename:string;expected:string|null;id:string}
function PersonalTimetable({orgId,userId,staffId,editable}:{orgId:string;userId:string;staffId:string|null;editable:boolean}) {
 const [on,setOn]=useState(getBusinessDate());const [effective,setEffective]=useState(getBusinessDate());const [weekly,setWeekly]=useState(false);const [version,setVersion]=useState<string|null>(null);const [page,setPage]=useState(1);
 const [upload,setUpload]=useState<Upload|null>(null);const [parsing,setParsing]=useState(false);const [error,setError]=useState('');const sequence=useRef(0);const client=useQueryClient();
 const query=useQuery({queryKey:['school-timetable',orgId,userId,staffId,on,version,page],queryFn:()=>timetableService.read(orgId,staffId,on,version,page),retry:false});
 const publish=useMutation({mutationFn:async()=>{if(!upload||!staffId)throw Error('Select a staff member and preview a file first.');await timetableService.publish(orgId,staffId,upload.id,upload.expected,effective,upload.entries,upload.filename,upload.original);},onSuccess:async()=>{setUpload(null);setVersion(null);setPage(1);await client.invalidateQueries({queryKey:['school-timetable',orgId]});}});
 const download=useMutation({mutationFn:async()=>{if(!query.data?.current)return;const result=await timetableService.read(orgId,staffId,on,query.data.current.id,1,true);const current=result.current;if(!current?.original_base64)throw Error('Original file unavailable.');saveTimetableFile(Uint8Array.from(atob(current.original_base64),c=>c.charCodeAt(0)),current.filename);}});
 async function preview(file:File){const token=++sequence.current;setParsing(true);setUpload(null);setError('');publish.reset();try{
  const result=await readTimetable(file);const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  if(token===sequence.current)setUpload({...result,original:btoa(binary),filename:file.name.replace(/[^a-zA-Z0-9 _().-]/g,'_').slice(0,115).replace(/\.xlsx$/i,'')+'.xlsx',expected:query.data?.latest_id??null,id:crypto.randomUUID()});
 }catch(e){if(token===sequence.current)setError(e instanceof Error?e.message:'Excel file could not be read.');}finally{if(token===sequence.current)setParsing(false);}}
 const current=query.data?.current;const day=((new Date(on+'T12:00:00Z').getUTCDay()+6)%7)+1;
 return <div className="space-y-4">
  <p className="text-sm">View your published weekly schedule on mobile. Timetable entries do not grant classroom access or mark attendance.</p>
  <Input label="Timetable date" type="date" value={on} required onChange={e=>{if(e.target.value){setOn(e.target.value);setVersion(null);}}}/>
  <Button variant="outline" aria-pressed={weekly} onClick={()=>setWeekly(!weekly)}>{weekly?'Show selected day':'Show weekly timetable'}</Button>
  {query.isPending&&<p role="status">Loading timetable…</p>}
  {query.isError&&<p role="alert">{query.error.message} <Button onClick={()=>void query.refetch()}>Retry timetable</Button></p>}
  {query.isSuccess&&!current&&<p>No timetable is effective on this date. Your school administrator can publish one below; future versions appear in history.</p>}
  {current&&<><p className="text-sm font-semibold">Version {current.revision} · Effective {current.effective_on}{version?' · Viewing saved version':''}</p>
   <Periods entries={current.entries} day={weekly?null:day}/>
   <Button variant="outline" disabled={download.isPending} onClick={()=>download.mutate()}>Download original Excel</Button>
  </>}
  {download.isError&&<p role="alert">{download.error.message}</p>}
  {(query.data?.history.length??0)>0&&<section className="space-y-2"><h3 className="text-sm font-semibold">Timetable history & scheduled versions</h3>
   {query.data?.history.map(v=><Button key={v.id} variant="outline" size="sm" onClick={()=>setVersion(v.id)}>Version {v.revision} · {v.effective_on}</Button>)}
   {version&&<Button variant="ghost" onClick={()=>setVersion(null)}>Return to effective timetable</Button>}
   <div className="flex gap-2"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Previous versions</Button><Button variant="outline" disabled={query.data?.history.length!==25||query.isFetching} onClick={()=>setPage(page+1)}>Next versions</Button></div>
  </section>}
  {query.data?.can_publish&&staffId&&<section className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Upload & publish staff timetable</h3>
   <p className="text-sm">Use one .xlsx worksheet, up to 1 MB and 150 periods. Enter times as HH:mm. Activities: teaching, break, free or duty. Teaching needs a class and subject. Uploading does not publish until you confirm the preview.</p>
   <Button variant="outline" onClick={()=>{void downloadTimetableTemplate().catch(e=>setError(e instanceof Error?e.message:'Template unavailable.'));}}>Download Excel template</Button>
   <Input label="Effective from" type="date" value={effective} required disabled={!editable||parsing||publish.isPending||publish.isError} onChange={e=>setEffective(e.target.value)}/>
   <Input label="Upload staff timetable Excel" type="file" accept=".xlsx" disabled={!editable||parsing||publish.isPending||publish.isError||query.isFetching} onChange={e=>{const file=e.target.files?.[0];if(file)void preview(file);e.target.value='';}}/>
   {parsing&&<p role="status">Checking Excel periods…</p>}{error&&<p role="alert">{error}</p>}
   {upload&&<><h4 className="font-semibold">Preview · {upload.filename} · {upload.entries.length} periods</h4>
    {upload.errors.length>0?<ul role="alert" className="text-sm text-rose-800">{upload.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>:<Periods entries={upload.entries} day={null}/>}
    <Button disabled={!editable||!effective||upload.errors.length>0||publish.isPending||publish.isError||parsing} onClick={()=>publish.mutate()}>Publish timetable</Button>
   </>}
   {publish.isError&&<p role="alert">{publish.error.message} <Button onClick={async()=>{await query.refetch();setUpload(null);publish.reset();}}>Refresh and preview again</Button></p>}
   {publish.isSuccess&&<p role="status">Timetable published. Previous versions and original files are preserved.</p>}
  </section>}
 </div>;
}
export function Periods({entries,day}:{entries:TimetableEntry[];day:number|null}) {
 const days=day?[day]:[1,2,3,4,5,6,7];return <div className="grid min-w-0 gap-3 sm:grid-cols-2">{days.map(d=><section key={d} className="min-w-0 space-y-2 rounded-xl border border-border p-3"><h3 className="font-semibold">{weekdays[d-1]}</h3>
  {!entries.some(e=>e.day===d)&&<p className="text-sm text-content-secondary">No scheduled periods.</p>}
  {entries.filter(e=>e.day===d).sort((a,b)=>a.start-b.start).map((e,i)=><div key={i} className="break-words rounded-lg bg-surface-muted p-3 text-sm"><p className="font-semibold">{clockText(e.start)}–{clockText(e.end)} · {e.activity==='free'?'Free period':e.activity==='teaching'?'Teaching':e.activity==='break'?'Break':'Duty'}</p><p>{[e.subject,e.class&&`Class ${e.class}${e.section?' '+e.section:''}`,e.room].filter(Boolean).join(' · ')}</p></div>)}
 </section>)}</div>;
}
