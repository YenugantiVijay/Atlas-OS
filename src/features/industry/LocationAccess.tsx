import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {getSupabaseClient} from '@/lib/supabase';
import {Button} from '@/components/ui/Button';
import {Card} from '@/components/ui/Card';
import {Input} from '@/components/ui/Input';
import {Select} from '@/components/ui/Select';
interface Access {sites:string[];members:Array<{user_id:string;email:string;role:string}>;grants:Array<{site:string;user_id:string}>}
export const locationAccessService={
 async read(org:string,tool:string):Promise<Access>{const {data,error}=await getSupabaseClient().rpc('ice_location_access',{p_org:org,p_tool:tool});if(error)throw Error('Location access could not be loaded.');return data;},
 async set(org:string,tool:string,site:string,user:string,grant:boolean){const {error}=await getSupabaseClient().rpc('set_ice_location_access',{p_org:org,p_tool:tool,p_site:site,p_user:user,p_grant:grant});if(error)throw Error(error.code==='42501'?'Only the owner or administrator can change location access.':'Location access was not confirmed. Refresh the assignments before retrying.');}
};
export function LocationAccess({orgId,tool,editable}:{orgId:string;tool:string;editable:boolean}){
 const [expanded,setExpanded]=useState(false);const [site,setSite]=useState('');const [user,setUser]=useState('');const client=useQueryClient();const key=['industry-location-access',orgId,tool];
 const access=useQuery({queryKey:key,queryFn:()=>locationAccessService.read(orgId,tool),enabled:expanded,retry:false});
 const save=useMutation({mutationFn:({location,member,grant}:{location:string;member:string;grant:boolean})=>locationAccessService.set(orgId,tool,location,member,grant),onSuccess:async()=>{setUser('');await client.invalidateQueries({queryKey:key});}});
 return <Card className="space-y-3"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Staff location access</h2><Button variant="outline" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide location access':'Manage location access'}</Button></div>
  {expanded&&<><p className="text-sm">Owners and administrators can access all locations. Other staff need an explicit assignment. Their existing team role still controls which actions they can perform. Transfers require access to both locations. This does not change permissions in other ERP modules.</p>
   {access.isPending&&<p role="status">Loading assignments…</p>}{access.isError&&<p role="alert">{access.error.message} <Button onClick={()=>void access.refetch()}>Retry assignments</Button></p>}
   {access.data&&<><form className="grid gap-3 sm:grid-cols-3" onSubmit={e=>{e.preventDefault();if(site.trim()&&user)save.mutate({location:site.trim(),member:user,grant:true});}}>
    <Input label="Assigned stall or depot" list="industry-access-sites" value={site} maxLength={60} required disabled={!editable||save.isPending} onChange={e=>setSite(e.target.value)}/><datalist id="industry-access-sites">{access.data.sites.map(s=><option key={s} value={s}/>)}</datalist>
    <Select label="Staff team member" value={user} disabled={!editable||save.isPending} onChange={e=>setUser(e.target.value)} options={[{value:'',label:'Choose active staff'},...access.data.members.map(m=>({value:m.user_id,label:`${m.email} · ${m.role}`}))]}/>
    <Button type="submit" disabled={!editable||save.isPending||!site.trim()||!user}>Grant location access</Button>
   </form><p className="text-xs">Invite staff and set their role in Team &amp; Access first. Use the same location spelling when opening cash and recording stock.</p>
   {!access.data.grants.length&&<p>No staff location assignments. Non-administrators cannot access stall or depot records until assigned.</p>}
   {access.data.grants.map(g=><div key={g.site+g.user_id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm"><span className="break-all">{g.site} · {access.data.members.find(m=>m.user_id===g.user_id)?.email??'Inactive team member'}</span><Button variant="outline" size="sm" disabled={!editable||save.isPending} onClick={()=>save.mutate({location:g.site,member:g.user_id,grant:false})}>Revoke<span className="sr-only"> {g.site} for {g.user_id}</span></Button></div>)}</>}
   {save.isError&&<p role="alert">{save.error.message}</p>}{save.isSuccess&&<p role="status">Location assignment confirmed. Staff can refresh their workspace to load it.</p>}
  </>}
 </Card>;
}
