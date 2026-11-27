import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import type { SchoolScope } from '@/features/school/SchoolShared';
interface Link {user_id:string;portal:string}
export function StudentPortalLinks({scope,studentId}:{scope:SchoolScope;studentId:string}){const [user,setUser]=useState('');const [portal,setPortal]=useState('parent');const client=useQueryClient();
 const key=['student-portal-links',scope.orgId,scope.userId,studentId];const links=useQuery({queryKey:key,queryFn:async()=>{const {data,error}=await supabase!.rpc('school_portal_links',{p_org:scope.orgId,p_student:studentId});if(error||!Array.isArray(data))throw new Error('Student portal links could not be loaded.');return data as Link[];},retry:false});
 const save=useMutation({mutationFn:async(input:{user:string;portal:string;active:boolean})=>{if(input.active&&!scope.editable)throw new Error('Workspace writes are unavailable.');const {error}=await supabase!.rpc('school_link_portal',{p_org:scope.orgId,p_user:input.user,p_student:studentId,p_portal:input.portal,p_active:input.active});if(error)throw new Error('Portal link could not be confirmed. Refresh links before another attempt.');},onSuccess:()=>client.invalidateQueries({queryKey:key})});
 return <section className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">Parent / student account access</h3><p className="text-sm">Invite each person through Team &amp; Access with a viewer membership, then explicitly link this student. Never share the school administrator’s credentials.</p>
 <Select label="Linked portal account" value={user} options={[{value:'',label:'Choose active account'},...scope.bootstrap.members.map(member=>({value:member.user_id,label:member.email}))]} onChange={event=>setUser(event.target.value)}/>
 <Select label="Student record portal" value={portal} options={[{value:'parent',label:'Parent'},{value:'student',label:'Student'}]} onChange={event=>setPortal(event.target.value)}/>
 <Button disabled={!user||!scope.editable||save.isPending||save.isError} onClick={()=>save.mutate({user,portal,active:true})}>Link this student account</Button>
 {links.isPending&&<p role="status">Loading student account links…</p>}{links.isError&&<p role="alert">{links.error.message}</p>}
 {links.data?.map(link=><div key={link.user_id+link.portal} className="flex flex-wrap gap-2 items-center justify-between text-sm"><span>{scope.bootstrap.members.find(member=>member.user_id===link.user_id)?.email??'Inactive account'} · {link.portal}</span><Button size="sm" variant="outline" disabled={save.isPending||save.isError} onClick={()=>save.mutate({user:link.user_id,portal:link.portal,active:false})}>Revoke student access</Button></div>)}
 {save.isError&&<p role="alert">{save.error.message}</p>}<Button size="sm" variant="outline" onClick={async()=>{await links.refetch();save.reset();}}>Refresh student account links</Button>
 </section>;
}
