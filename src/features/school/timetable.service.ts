import {supabase} from '@/lib/supabase';
import type {TimetableEntry} from './timetable-import';
export interface TimetableVersion {id:string;revision:number;effective_on:string;filename:string;published_at:string;entries:TimetableEntry[];original_base64?:string|null}
export interface TimetableResult {current:TimetableVersion|null;history:Omit<TimetableVersion,'entries'>[];latest_id:string|null;can_publish:boolean}
export const timetableService={
 async read(org:string,staff:string|null,on:string,version:string|null=null,page=1,download=false):Promise<TimetableResult>{
  if(!supabase)throw Error('Sign in to your school.');
  const {data,error}=await supabase.rpc('school_timetable_read',{p_org:org,p_staff:staff,p_on:on,p_version:version,p_page:page,p_download:download});
  if(error)throw Error('Timetable could not be loaded. Refresh or ask your school administrator.');return data;
 },
 async publish(org:string,staff:string,id:string,expected:string|null,effective:string,entries:TimetableEntry[],filename:string,original:string){
  if(!supabase)throw Error('Sign in to your school.');
  const {error}=await supabase.rpc('school_timetable_publish',{p_org:org,p_staff:staff,p_id:id,p_expected:expected,p_effective:effective,p_entries:entries,p_filename:filename,p_original:original});
  if(error)throw Error(error.message||'Publishing could not be confirmed. Refresh before retrying.');
 }
};
