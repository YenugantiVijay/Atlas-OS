import {describe,it,expect} from 'vitest';
import {addLocalOperation,localSnapshot,type IceInput} from './operations';
const today='2026-11-28';const command=(extra:Partial<IceInput>):IceInput=>({kind:'receive',site:'STALL 1',sku:'VANILLA',batch:'',unit:'piece',quantity:20,amount_paise:0,reference:'',detail:'',method:'',expiry:'',...extra});
describe('Ice stock invariants in demo and local recovery',()=>{
 it('transfers stock without changing total stock or cash and is idempotent',()=>{
  const data={jobs:[],events:[],operations:{}};addLocalOperation('ice-cream-stalls',data,command({}),'receive',today);const move=command({kind:'transfer',quantity:5,destination:'STALL 2',detail:'Replenish second stall'});addLocalOperation('ice-cream-stalls',data,move,'transfer',today);addLocalOperation('ice-cream-stalls',data,move,'transfer',today);const result=localSnapshot('ice-cream-stalls',data,today);expect(result.stock?.map(s=>s.quantity)).toEqual([15,5]);expect(result.tills?.every(t=>t.cash===0&&t.upi===0)).toBe(true);
 });
 it('rejects stale counts and requires reasons for adjustment',()=>{
  const data={jobs:[],events:[],operations:{}};addLocalOperation('ice-cream-stalls',data,command({}),'receive',today);expect(()=>addLocalOperation('ice-cream-stalls',data,command({kind:'count',quantity:18,expected_quantity:15,detail:'Physical closing count'}),'count',today)).toThrow('Stock changed');expect(()=>addLocalOperation('ice-cream-stalls',data,command({kind:'waste',quantity:1}),'waste',today)).toThrow('reason');
 });
 it('records wastage without allowing stock to become negative',()=>{
  const data={jobs:[],events:[],operations:{}};addLocalOperation('ice-cream-stalls',data,command({}),'receive',today);addLocalOperation('ice-cream-stalls',data,command({kind:'waste',quantity:3,detail:'Melted during service'}),'waste',today);expect(localSnapshot('ice-cream-stalls',data,today).stock?.[0].quantity).toBe(17);expect(()=>addLocalOperation('ice-cream-stalls',data,command({kind:'waste',quantity:18,detail:'Melted during service'}),'waste2',today)).toThrow('exceeds');
 });
 it('rejects non-finite or fractional quantities before mutating stock',()=>{
  for(const quantity of [NaN,Infinity,-1,0.5]){const data={jobs:[],events:[],operations:{}};expect(()=>addLocalOperation('ice-cream-stalls',data,command({quantity}),'bad',today)).toThrow('whole quantities');expect(data.events).toHaveLength(0);}
 });
});
