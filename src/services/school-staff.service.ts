import { supabase } from '@/lib/supabase';
export const schoolPositions = {principal:'Principal',school_admin:'School administrator',teacher:'Teacher',accountant:'Accountant',office_staff:'Office staff',support_staff:'Support staff'} as const;
export interface SchoolStaff {staff_id:string;school_id:string;position:keyof typeof schoolPositions;revision:number;display_name:string;joining_on:string;user_id:string|null;is_active:boolean|null}
export interface SchoolLeave {id:string;staff_id:string;requested_by:string;school_id:string;display_name:string;starts_on:string;ends_on:string;reason:string;status:string;review_note:string|null}
export interface SchoolStaffResult<T> {rows:T[];can_register?:boolean;can_review:boolean}
export const schoolStaffService = {
 async read<T>(org:string,area:'directory'|'leave'|'unregistered'|'self',page:number):Promise<SchoolStaffResult<T>> {
  if(!supabase)throw Error('Sign in to your school.');
  const {data,error}=await supabase.rpc('school_staff_read',{p_org:org,p_area:area,p_page:page});
  if(error)throw Error('School staff records could not be loaded. Refresh to retry.');return data;
 },
 async command(org:string,action:string,record:Record<string,unknown>) {
  if(!supabase)throw Error('Sign in to your school.');
  const {error}=await supabase.rpc('school_staff_command',{p_org:org,p_action:action,p_data:record});
  if(error?.code==='23505')throw Error('This school ID or request already exists. Refresh and review the records.');
  if(error)throw Error(error.message || 'The school staff change could not be confirmed. Refresh before retrying.');
 }
};
