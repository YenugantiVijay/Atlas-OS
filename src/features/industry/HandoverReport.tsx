import {useState} from 'react';import {useQuery} from '@tanstack/react-query';
import {getSupabaseClient} from '@/lib/supabase';import {getBusinessDate} from '@/lib/dates';
import {Card} from '@/components/ui/Card';import {Button} from '@/components/ui/Button';import {Input} from '@/components/ui/Input';import {money} from './fields';
export interface StockReconciliation {site:string;sku:string;batch:string;unit:string;opening:number;received:number;sold_or_dispatched:number;restocked:number;transferred_in:number;transferred_out:number;written_off:number;count_adjustment:number;closing:number}
export interface CashReconciliation {site:string;opening_paise:number|null;cash_sales_paise:number;upi_sales_paise:number;counted_paise:number|null;expected_paise:number|null;variance_paise:number|null}
export interface Reconciliation {day:string;stock:StockReconciliation[];cash:CashReconciliation[]}
export function checkReconciliation(data:Reconciliation){
 if(!data||!Array.isArray(data.stock)||!Array.isArray(data.cash))throw Error('Invalid reconciliation response.');
 for(const row of data.cash)if(!Number.isSafeInteger(row.cash_sales_paise)||!Number.isSafeInteger(row.upi_sales_paise))throw Error('Invalid cash amounts.');
 for(const row of data.stock){for(const value of Object.values(row))if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Stock report exceeds exact numeric limits.');if(row.opening+row.received-row.sold_or_dispatched+row.restocked+row.transferred_in-row.transferred_out-row.written_off+row.count_adjustment!==row.closing)throw Error('Stock movements do not reconcile. Contact support.');}
 for(const row of data.cash){for(const value of Object.values(row))if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Cash report exceeds exact numeric limits.');if(row.opening_paise!==null&&row.opening_paise+row.cash_sales_paise!==row.expected_paise)throw Error('Expected cash does not reconcile.');if(row.counted_paise!==null&&row.expected_paise!==null&&row.counted_paise-row.expected_paise!==row.variance_paise)throw Error('Cash variance does not reconcile.');}
 return data;
}
export const reconciliationService={async read(org:string,tool:string,day:string,site:string):Promise<Reconciliation>{const {data,error}=await getSupabaseClient().rpc('ice_reconciliation',{p_org:org,p_tool:tool,p_day:day,p_site:site.trim()||null});if(error)throw Error(error.code==='22023'?error.message:'Reconciliation could not be loaded. Check your access and connection.');return checkReconciliation(data);}};
export function reconciliationCsv(headers:string[],rows:Array<Array<string|number|null>>){const cell=(value:string|number|null)=>{let s=value===null?'':String(value);if(typeof value==='string'&&/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');}
function download(name:string,headers:string[],rows:Array<Array<string|number|null>>){const url=URL.createObjectURL(new Blob([reconciliationCsv(headers,rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function HandoverReport({orgId,tool}:{orgId:string;tool:string}){
 const [expanded,setExpanded]=useState(false);const [day,setDay]=useState(getBusinessDate());const [site,setSite]=useState('');
 const query=useQuery({queryKey:['ice-reconciliation',orgId,tool,day,site],queryFn:()=>reconciliationService.read(orgId,tool,day,site),enabled:expanded&&!!day,retry:false});
 const report=query.data;
 return <Card className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Handover & daily reconciliation</h2><Button variant="outline" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide reconciliation':'Open reconciliation'}</Button></div>
  <a href="/templates/Atlas-Client-Handover-Templates.xlsx" download className="inline-block text-sm font-semibold text-atlas-700 underline">Download blank client setup workbook</a>
  {expanded&&<><p className="text-sm">Compare the book balances with your physical stock and cash. Downloads leave physical verification fields blank. Reports do not post corrections, certify physical stock or verify bank payments.</p>
   <div className="grid gap-3 sm:grid-cols-2"><Input label="Reconciliation business date" type="date" max={getBusinessDate()} value={day} onChange={e=>setDay(e.target.value)}/><Input label="Reconciliation location (optional)" value={site} maxLength={60} onChange={e=>setSite(e.target.value)}/></div>
   <Button variant="outline" disabled={!day||query.isFetching} onClick={()=>void query.refetch()}>Refresh reconciliation</Button>
   {query.isPending&&day&&<p role="status">Loading book balances…</p>}{query.isError&&<p role="alert">{query.error.message}</p>}
   {report&&!query.isError&&<><p className="text-sm font-semibold">{report.day} · {report.stock.length} stock balances · {report.cash.length} cash drawers</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>download('Atlas-Stock-Reconciliation-'+day+'.csv',['date','location','sku','batch','unit','opening','received','sold_or_dispatched','restocked','transferred_in','transferred_out','written_off','count_adjustment','book_closing','physical_quantity','verification_note'],report.stock.map(r=>[day,r.site,r.sku,r.batch,r.unit,r.opening,r.received,r.sold_or_dispatched,r.restocked,r.transferred_in,r.transferred_out,r.written_off,r.count_adjustment,r.closing,null,null]))}>Download stock verification sheet</Button>
    {tool==='ice-cream-stalls'&&<Button variant="outline" onClick={()=>download('Atlas-Cash-Reconciliation-'+day+'.csv',['date','location','opening_paise','cash_sales_paise','upi_sales_paise','expected_paise','recorded_counted_paise','recorded_variance_paise','physical_cash_paise','verification_note'],report.cash.map(r=>[day,r.site,r.opening_paise,r.cash_sales_paise,r.upi_sales_paise,r.expected_paise,r.counted_paise,r.variance_paise,null,null]))}>Download cash verification sheet</Button>}</div>
    {!report.stock.length&&!report.cash.length&&<p>No records match this date and location. Enter verified opening balances through the stock and cash forms when available.</p>}
    {report.cash.map(r=><div key={r.site} className="rounded-lg border border-border p-3 text-sm break-words"><strong>{r.site}</strong><p>Expected cash: {r.expected_paise===null?'Opening float missing':money(r.expected_paise)} · UPI recorded separately: {money(r.upi_sales_paise)}</p><p>{r.counted_paise===null?'Closing cash not recorded':r.variance_paise===null?'Opening float missing; variance cannot be established':'Recorded cash variance: '+money(r.variance_paise)}</p></div>)}
   </>}
  </>}
 </Card>;
}
