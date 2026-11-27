import {describe,it,expect} from 'vitest';
import {splitGstPaise,UTGST_STATE_CODES} from './gst-components';
import {calculateGst} from './gst-calculator';
import {calculateLineItem,calculateDocumentTotals,toPaise} from './money';
describe('GST component reconciliation',()=>{
 it.each([0,1,2,3,525,18000,40000,99999999999])('preserves every paise for total %s',tax=>{
  for(const type of ['state','territory','interstate'] as const){ const c=splitGstPaise(tax,type);expect(c.cgst+c.sgst+c.utgst+c.igst).toBe(tax);expect(Math.abs(c.cgst-(c.sgst+c.utgst))).toBeLessThanOrEqual(type==='interstate'?tax:1); }
 });
 it('uses CGST and SGST at half the combined 18 percent rate',()=>{expect(calculateGst('1000','18','add','state')).toMatchObject({base:100000,central:9000,regional:9000,integrated:0,total:118000});});
 it('extracts tax-inclusive GST without adding tax again',()=>{expect(calculateGst('1180','18','remove','state')).toMatchObject({base:100000,tax:18000,total:118000});});
 it('uses only IGST for an inter-state supply such as AP to Telangana',()=>{expect(calculateGst('1000','18','add','interstate')).toMatchObject({central:0,regional:0,integrated:18000});});
 it('distinguishes UTGST from SGST without doubling the total',()=>{expect(splitGstPaise(18000,'territory')).toEqual({cgst:9000,utgst:9000,sgst:0,igst:0});expect(UTGST_STATE_CODES.has('04')).toBe(true);expect(UTGST_STATE_CODES.has('36')).toBe(false);expect(UTGST_STATE_CODES.has('37')).toBe(false);expect(UTGST_STATE_CODES.has('07')).toBe(false);});
 it('keeps the documented odd-paise remainder in the regional share',()=>{expect(splitGstPaise(525,'state')).toEqual({cgst:262,sgst:263,utgst:0,igst:0});});
 it('handles discounts and mixed rates before component allocation',()=>{const d=calculateDocumentTotals([{quantity:1,unitPrice:1000,discountPercent:10,taxRate:18},{quantity:1,unitPrice:100,taxRate:5}]);expect(d.taxAmount).toBe(167);expect(splitGstPaise(toPaise(d.taxAmount),'state')).toEqual({cgst:8350,sgst:8350,utgst:0,igst:0});expect(calculateLineItem(1,100,0,40).taxAmount).toBe(40);});
 it('checks large calculator values against an independent BigInt calculation',()=>{const p=99999999999n;for(const r of [25n,150n,300n,500n,1800n,4000n,10000n]){const x=calculateGst('999999999.99',String(Number(r)/100),'add','state')!;expect(x.tax).toBe(Number((p*r+5000n)/10000n));expect(x.central+x.regional).toBe(x.tax);}});
 it('rejects invalid or unsafe component totals',()=>{for(const n of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>splitGstPaise(n,'state')).toThrow();expect(calculateGst('-1','18','add','state')).toBeNull();});
});
