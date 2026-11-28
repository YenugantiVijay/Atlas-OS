import {getSupabaseClient} from '@/lib/supabase';
import {readDecimalHundredths} from '@/lib/decimal-input';
import {splitGstPaise} from '@/lib/gst-components';
export type ReviewSupply='state'|'territory'|'interstate'|'none';
export interface ReviewAmounts {base_paise:number;tax_paise:number;cgst_paise:number;sgst_paise:number;utgst_paise:number;igst_paise:number;total_paise:number}
export interface DispatchReview {id:string;day:string;site:string;reference:string;sku:string;batch:string;quantity:number;customer:string;return_quantity:number;billing_name:string|null;billing_address:string|null;unit_price_paise:number|null;tax_basis_points:number|null;supply:ReviewSupply|null;tax_note:string|null;status:'needs_details'|'draft'|'reviewed';revision:number;amounts:ReviewAmounts|null}
export interface ReviewInput {revision:number;billing_name:string;billing_address:string;unit_price_paise:number;tax_basis_points:number;supply:ReviewSupply;tax_note:string;status:'draft'|'reviewed'}
export class InvoiceReviewUnconfirmedError extends Error{}
export function reviewPriceInputs(price:string,rate:string,quantity:number,supply:string){
 const paise=readDecimalHundredths(price),basis=readDecimalHundredths(rate);
 if(paise===null||basis===null||paise>10000000000||basis>10000||!Number.isSafeInteger(quantity)||quantity<=0||!['state','territory','interstate','none'].includes(supply))throw Error('Enter the actual rate per case, configured tax and supply type.');
 if(supply==='none'&&basis!==0)throw Error('No tax requires an explicitly configured 0% rate.');
 const base=BigInt(paise)*BigInt(quantity);if(base>99999999999999n)throw Error('Draft value exceeds the supported exact amount limit.');const tax=Number((base*BigInt(basis)+5000n)/10000n);
 const parts=supply==='none'?{cgst:0,sgst:0,utgst:0,igst:0}:splitGstPaise(tax,supply as 'state'|'territory'|'interstate');
 const amounts:ReviewAmounts={base_paise:Number(base),tax_paise:tax,cgst_paise:parts.cgst,sgst_paise:parts.sgst,utgst_paise:parts.utgst,igst_paise:parts.igst,total_paise:Number(base)+tax};
 return {paise,basis,supply:supply as ReviewSupply,amounts};
}
function exact(value:unknown):void{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if((key.endsWith('_paise')||key==='quantity'||key==='tax_basis_points')&&item!==null&&(typeof item!=='number'||!Number.isSafeInteger(item)))throw Error('Invoice review amounts could not be represented exactly.');if(item&&typeof item==='object')exact(item);}}
export const invoiceReviewService={
 async read(org:string,from:string,to:string,page:number,status:string):Promise<{rows:DispatchReview[];count:number}>{const {data,error}=await getSupabaseClient().rpc('ice_invoice_review_read',{p_org:org,p_from:from,p_to:to,p_page:page,p_state:status});if(error||!data||!Array.isArray(data.rows))throw Error(error?.code==='22023'?error.message:'Invoice reviews could not be loaded. Confirm accounts and location access.');exact(data);return data;},
 async save(org:string,dispatch:string,request:string,input:ReviewInput){const {data,error}=await Promise.resolve(getSupabaseClient().rpc('save_ice_invoice_review',{p_org:org,p_dispatch:dispatch,p_request:request,p_data:input})).catch(()=>{throw new InvoiceReviewUnconfirmedError('The draft save was not confirmed. Retry unchanged or reload the saved draft.');});if(error){if(!/^[0-9A-Z]{5}$/.test(error.code??''))throw new InvoiceReviewUnconfirmedError('The draft save was not confirmed. Retry unchanged or reload the saved draft.');throw Error(error.code==='40001'?'The draft changed. Refresh it before saving again.':error.code==='42501'?'Accounts and assigned-location access are required.':error.code==='23514'?'Check the billing name, address and review note before saving a reviewed draft.':error.message);}if(!data)throw new InvoiceReviewUnconfirmedError('The draft save was not confirmed. Reload before editing.');exact(data);return data;}
};
