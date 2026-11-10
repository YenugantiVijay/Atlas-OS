import { describe, expect, it } from 'vitest';
import {
  parsePackageCounts, computeReceiptLine, buildGoodsReceiptPayload, parseReceivingNotebook,
} from './receiving-worksheet';
import type { Product } from '@/types';

const org='11111111-2222-4333-8444-555555555555';
const product={
  id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', organizationId:org,
  sku:'FERT-50', name:'Fertilizer 50 kg', category:'Fertilizer', uom:'Bag',
  sellingPrice:1350, purchaseCost:1200, taxRate:5,
  currentStock:0, reorderThreshold:5, isActive:true, createdAt:'',updatedAt:'',
} as Product;
const row={product,packageText:'12, 10, 11',looseUnits:'5',unitCost:'1120.50'};
describe('PR56 variable carton receiving',()=>{
  it('sums unlike package sizes and loose units with no assumed units per carton',()=>{
    expect(parsePackageCounts('12, 10, 11')).toEqual([12,10,11]);
    expect(computeReceiptLine(row)).toMatchObject({
      packageCounts:[12,10,11], looseUnits:5,totalUnits:38,unitCost:1120.5,
    });
  });
  it('supports repeat shorthand and 200 explicit cartons safely',()=>{
    expect(parsePackageCounts('5x12, 10, 2×3')).toEqual([12,12,12,12,12,10,3,3]);
    expect(parsePackageCounts('200x2')).toHaveLength(200);
    expect(()=>parsePackageCounts('201x2')).toThrow(/up to 200 cartons/);
    expect(()=>parsePackageCounts('0,2')).toThrow(/positive integers/);
    expect(()=>parsePackageCounts('12,,10')).toThrow(/empty entries/);
    expect(()=>parsePackageCounts('1.5,10')).toThrow(/positive integers/);
  });
  it('rejects zero, fractional, negative or excessive units and prices',()=>{
    expect(()=>computeReceiptLine({...row,packageText:'',looseUnits:'0'})).toThrow(/between 1/);
    expect(()=>computeReceiptLine({...row,looseUnits:'3.5'})).toThrow(/nonnegative whole/);
    expect(()=>computeReceiptLine({...row,looseUnits:'-3'})).toThrow(/nonnegative whole/);
    expect(()=>computeReceiptLine({...row,packageText:'1000000,2'})).toThrow(/between 1/);
    expect(()=>computeReceiptLine({...row,unitCost:'-12'})).toThrow(/nonnegative/);
    expect(()=>computeReceiptLine({...row,unitCost:'12.333'})).toThrow(/two decimal/);
  });
  it('rejects cross-tenant products, duplicates and inactive products before calling the backend',()=>{
    expect(buildGoodsReceiptPayload(org,[row])).toEqual([{
      productId:product.id,packageCounts:[12,10,11],looseUnits:5,unitCost:1120.5,
    }]);
    expect(()=>buildGoodsReceiptPayload(org,[row,row])).toThrow(/once per receipt/);
    expect(()=>buildGoodsReceiptPayload(org,[{...row,product:{...product,organizationId:'different'}}])).toThrow(/current business/);
    expect(()=>buildGoodsReceiptPayload(org,[{...row,product:{...product,isActive:false}}])).toThrow(/active/);
    expect(()=>buildGoodsReceiptPayload(org,[])).toThrow(/between 1 and 50/);
  });
  it('parses exact TAB-separated notepad rows, rejecting ambiguous or repeated SKUs',()=>{
    expect(parseReceivingNotebook('FERT-50\t12,10,11\t5\t1120.50\nCABLE-01\t5x12\t0\t25'))
      .toEqual([
        {sku:'FERT-50',packageText:'12,10,11',looseUnits:'5',unitCost:'1120.50'},
        {sku:'CABLE-01',packageText:'5x12',looseUnits:'0',unitCost:'25'},
      ]);
    expect(()=>parseReceivingNotebook('FERT-50 12 10')).toThrow(/TAB-separated/);
    expect(()=>parseReceivingNotebook('SKU\t10\t0\t25\nsku\t1\t0\t25')).toThrow(/Duplicate SKU/);
  });
});
