import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/features/organizations/OrgContext';
import { supabase } from '@/lib/supabase';
import { portalEntry, PORTALS } from '@/lib/portal-entry';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatCurrency,fromPaise } from '@/lib/money';
interface LinkedStudent { id:string;name:string;admission_no:string;enrolments:Array<{year:string;class:string;section:string;balance_paise:number;attendance:Array<{day:string;status:string;reason:string}>;receipts:Array<{number:string;day:string;amount_paise:number;returned_paise:number}>}> }
export function FamilyPortal(){const {currentOrg,currentUser,isDemoMode,isAuthenticated}=useOrg();const portal=portalEntry();
 const records=useQuery({queryKey:['family-portal',currentOrg?.id,currentUser?.id,portal],enabled:!!currentOrg&&isAuthenticated&&!isDemoMode,
 queryFn:async()=>{const {data,error}=await supabase!.rpc('school_my_records',{p_org:currentOrg!.id,p_portal:portal});if(error||!Array.isArray(data))throw new Error('Your linked school records could not be loaded. Ask the school owner to check your account link.');return data as LinkedStudent[];},retry:false,refetchOnWindowFocus:'always'});
 const money=(v:number)=>{if(!Number.isSafeInteger(v))throw new Error('The fee amount could not be represented exactly.');return formatCurrency(fromPaise(v));};
 return <div className="space-y-4"><h1 className="text-2xl font-bold">{PORTALS[portal]} portal</h1><p className="text-sm">Only students explicitly linked to your account are shown. Attendance lists the latest recorded status for the last 30 days; unmarked days are not assumed absent.</p>
 {!isAuthenticated||isDemoMode?<Card>Sign in with the account linked by your school. No student records are simulated in this preview.</Card>:<>
 {records.isPending&&<p role="status">Loading linked school records…</p>}{records.isError&&<Card><p role="alert">{records.error.message}</p><Button onClick={()=>void records.refetch()}>Retry my records</Button></Card>}
 {records.data?.map(student=><Card key={student.id} className="space-y-4"><h2 className="text-xl font-semibold">{student.name} · {student.admission_no}</h2>{student.enrolments.map((row,i)=><section key={i} className="space-y-3 border-t border-border pt-3"><h3 className="font-semibold">{row.class} {row.section} · {row.year}</h3><p>Outstanding fees: <strong>{money(row.balance_paise)}</strong></p><h4 className="font-semibold">Recent attendance</h4>{row.attendance.length?row.attendance.map(day=><p key={day.day} className="text-sm">{day.day} · {day.status.replace(/_/g,' ')}{day.reason?' · '+day.reason:''}</p>):<p className="text-sm">No attendance recorded in the last 30 days.</p>}<h4 className="font-semibold">Recorded fee receipts</h4>{row.receipts.map(receipt=><p key={receipt.number} className="text-sm">{receipt.number} · {receipt.day} · Received {money(receipt.amount_paise)} · Approved returns {money(receipt.returned_paise)}</p>)}</section>)}</Card>)}
 {records.data?.length===0&&<Card>No students are linked to this account. Contact your school administrator.</Card>}</>}
 </div>;
}
