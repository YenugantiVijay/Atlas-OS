import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { schoolStaffService,schoolPositions,type SchoolStaff,type SchoolLeave } from '@/services/school-staff.service';
import { EmployeeAccountLinks } from '@/features/team/StaffEmployeeAccounts';
import { AttendanceManagers } from '@/features/team/AttendanceManagers';
import { SchoolTimetable } from './SchoolTimetable';
import { getBusinessDate } from '@/lib/dates';

export function SchoolStaffPanel({orgId,userId,editable,owner=false}:{orgId:string;userId:string;editable:boolean;owner?:boolean}) {
 const [page,setPage]=useState(1);const [leavePage,setLeavePage]=useState(1);const [editing,setEditing]=useState<SchoolStaff|null>(null);
 const [existingPage,setExistingPage]=useState(1);
 const [requestId,setRequestId]=useState(()=>crypto.randomUUID());const [staffId,setStaffId]=useState<string>(()=>crypto.randomUUID());
 const [card,setCard]=useState('');const [name,setName]=useState('');const [position,setPosition]=useState('teacher');const [joining,setJoining]=useState(getBusinessDate());
 const [from,setFrom]=useState(getBusinessDate());const [to,setTo]=useState(getBusinessDate());const [reason,setReason]=useState('');const [review,setReview]=useState('');
 const client=useQueryClient();const key=['school-staff',orgId,userId];
 const directory=useQuery({queryKey:[...key,'directory',page],queryFn:()=>schoolStaffService.read<SchoolStaff>(orgId,'directory',page)});
 const self=useQuery({queryKey:[...key,'self'],queryFn:()=>schoolStaffService.read<SchoolStaff>(orgId,'self',1)});
 const existing=useQuery({queryKey:[...key,'unregistered',existingPage],queryFn:()=>schoolStaffService.read<SchoolStaff>(orgId,'unregistered',existingPage),enabled:directory.data?.can_register===true});
 const leave=useQuery({queryKey:[...key,'leave',leavePage],queryFn:()=>schoolStaffService.read<SchoolLeave>(orgId,'leave',leavePage)});
 const save=useMutation({mutationFn:({action,data}:{action:string;data:Record<string,unknown>})=>schoolStaffService.command(orgId,action,data),onSuccess:async()=>{
  await client.invalidateQueries({queryKey:['school-staff',orgId]});await client.invalidateQueries({queryKey:['staff-clock',orgId]});
  setRequestId(crypto.randomUUID());setStaffId(crypto.randomUUID());setEditing(null);setCard('');setName('');setReason('');
 }});
 const busy=!editable||save.isPending;const own=self.data?.rows.find(r=>r.user_id===userId&&r.is_active);
 return <div className="space-y-5">
  <Card className="space-y-3"><h2 className="font-semibold">School staff IDs & attendance</h2>
   <p className="text-sm">Your school ID identifies your staff record. Sign in securely with your linked account. Positions do not grant permissions automatically; the school owner assigns school responsibilities and attendance managers separately.</p>
   <p className="text-sm">Staff attendance applies across the school, regardless of teaching class or subject. A missing check-in is not automatically an absence.</p>
   <Link className="font-semibold text-teal-800 underline" to="/attendance/my">Open staff check-in and attendance reports</Link>
   {directory.isPending&&<p role="status">Loading staff records…</p>}
   {(directory.isError||leave.isError)&&<p role="alert">School staff records could not be loaded. <Button onClick={()=>{void directory.refetch();void leave.refetch();}}>Retry</Button></p>}
   {directory.data?.rows.map(row=><div key={row.staff_id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"><p>{row.school_id} · {row.display_name} · {schoolPositions[row.position]} · {row.is_active?'Self-service enabled':'Account link required or disabled'}</p>
    {directory.data.can_register&&<Button variant="outline" disabled={busy} onClick={()=>{setEditing(row);setCard(row.school_id);setName(row.display_name);setPosition(row.position);setJoining(row.joining_on);setStaffId(row.staff_id);}}>Change position<span className="sr-only"> for {row.school_id}</span></Button>}
   </div>)}
   {directory.isSuccess&&!directory.data.rows.length&&<p className="text-sm">No school staff IDs available. Ask the school administrator to register and link your staff profile.</p>}
   <div className="flex gap-2"><Button variant="outline" disabled={page===1||directory.isFetching} onClick={()=>setPage(page-1)}>Previous staff</Button><Button variant="outline" disabled={directory.isFetching||directory.data?.rows.length!==25} onClick={()=>setPage(page+1)}>Next staff</Button></div>
  </Card>
  {directory.isSuccess&&<SchoolTimetable orgId={orgId} userId={userId} staff={directory.data.rows} authority={directory.data.can_register===true} editable={editable}/>}
  {directory.data?.can_register&&<Card className="space-y-3"><h2 className="font-semibold">{editing?'Update staff position':'Register school staff'}</h2>
   <p className="text-sm">To preserve an existing employee's attendance, choose their existing profile before assigning a school ID.</p>
   {!editing&&<><Select label="Existing staff profile (optional)" value={existing.data?.rows.some(r=>r.staff_id===staffId)?staffId:''} disabled={busy||existing.isPending||existing.isError} onChange={e=>{const row=existing.data?.rows.find(r=>r.staff_id===e.target.value);setStaffId(row?.staff_id??crypto.randomUUID());setName(row?.display_name??'');setJoining(row?.joining_on??getBusinessDate());}} options={[{value:'',label:'Create a new staff profile'},...(existing.data?.rows??[]).map(r=>({value:r.staff_id,label:r.display_name}))]}/>
   {existing.isError&&<p role="alert">Existing profiles could not be loaded. <Button onClick={()=>void existing.refetch()}>Retry profiles</Button></p>}
   <div className="flex gap-2"><Button variant="outline" disabled={existingPage===1||existing.isFetching} onClick={()=>setExistingPage(existingPage-1)}>Previous profiles</Button><Button variant="outline" disabled={existing.data?.rows.length!==25||existing.isFetching} onClick={()=>setExistingPage(existingPage+1)}>Next profiles</Button></div></>}
   <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate({action:'register',data:{staff_id:staffId,school_id:card.trim(),name:name.trim(),position,joining_on:joining,revision:editing?.revision??0}});}}>
    <Input label="School-issued staff ID" value={card} required maxLength={40} disabled={busy||!!editing} onChange={e=>setCard(e.target.value)}/>
    <Input label="Staff name" value={name} required maxLength={100} disabled={busy||!!editing} onChange={e=>setName(e.target.value)}/>
    <Select label="Staff position" value={position} disabled={busy} onChange={e=>setPosition(e.target.value)} options={Object.entries(schoolPositions).map(([value,label])=>({value,label}))}/>
    <Input label="Joining date" type="date" value={joining} required disabled={busy||!!editing} onChange={e=>setJoining(e.target.value)}/>
    <Button type="submit" disabled={busy}>{editing?'Save position':'Register staff ID'}</Button>
    {editing&&<Button variant="outline" disabled={save.isPending} onClick={()=>{setEditing(null);setStaffId(crypto.randomUUID());setCard('');setName('');}}>Cancel position change</Button>}
   </form><p className="text-xs">IDs are unique within this school, ignoring letter case. Changing position preserves the ID and attendance history. New staff receive the School campus work location.</p>
  </Card>}
  {owner&&<><EmployeeAccountLinks orgId={orgId} userId={userId} editable={editable}/><AttendanceManagers orgId={orgId} userId={userId}/></>}
  <Card className="space-y-3"><h2 className="font-semibold">Staff leave requests</h2>
   <p className="text-sm">Leave decisions do not overwrite check-in records or automatically change payroll. Another authorized attendance manager must review your request.</p>
   {own&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate({action:'request_leave',data:{id:requestId,starts_on:from,ends_on:to,reason}});}}>
    <Input label="Leave starts" type="date" value={from} required disabled={busy} onChange={e=>setFrom(e.target.value)}/><Input label="Leave ends" type="date" min={from} value={to} required disabled={busy} onChange={e=>setTo(e.target.value)}/>
    <Input label="Leave reason" value={reason} required minLength={5} maxLength={500} disabled={busy} onChange={e=>setReason(e.target.value)}/><Button type="submit" disabled={busy}>Request leave</Button>
   </form>}
   {leave.data?.can_review&&<Input label="Review reason (required for a decision)" value={review} minLength={5} maxLength={500} disabled={busy} onChange={e=>setReview(e.target.value)}/>}
   {leave.isPending&&<p role="status">Loading leave requests…</p>}
   {leave.data?.rows.map(row=><div key={row.id} className="space-y-2 border-t border-border py-3 text-sm"><p>{row.school_id} · {row.display_name} · {row.starts_on} to {row.ends_on} · {row.status}</p><p>{row.reason}</p>{row.review_note&&<p>Review: {row.review_note}</p>}
    {row.status==='pending'&&row.requested_by===userId&&<Button disabled={busy} variant="outline" onClick={()=>save.mutate({action:'cancel_leave',data:{id:row.id}})}>Cancel request</Button>}
    {row.status==='pending'&&row.requested_by!==userId&&leave.data.can_review&&<div className="flex gap-2">{['approved','rejected'].map(status=><Button key={status} disabled={busy||review.trim().length<5} variant="outline" onClick={()=>save.mutate({action:'review_leave',data:{id:row.id,status,note:review}})}>{status==='approved'?'Approve':'Reject'} leave</Button>)}</div>}
   </div>)}
   {leave.isSuccess&&!leave.data.rows.length&&<p>No leave requests.</p>}
   <div className="flex gap-2"><Button variant="outline" disabled={leavePage===1||leave.isFetching} onClick={()=>setLeavePage(leavePage-1)}>Previous requests</Button><Button variant="outline" disabled={leave.isFetching||leave.data?.rows.length!==25} onClick={()=>setLeavePage(leavePage+1)}>Next requests</Button></div>
  </Card>
  {save.isError&&<p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}{save.isSuccess&&<p role="status">Change confirmed by the server.</p>}
 </div>;
}
