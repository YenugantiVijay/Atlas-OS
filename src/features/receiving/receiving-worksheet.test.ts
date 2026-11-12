import { describe, expect, it } from 'vitest';
import {
  parsePackageCounts, computeReceiptLine, buildGoodsReceiptPayload, parseReceivingNotebook,
  readUniformCartons, writeUniformCartons,
} from './receiving-worksheet';
import type { Product } from '@/types';

const org='11111111-2222-4333-8444-555555555555';
const product={
  id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', organizationId:org,
  sku:'FERT-50', name:'Fertilizer 50 kg', category:'Fertilizer', uom:'Nos',
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
  it('supports separate cases and units/case fields without inventing package sizes',()=>{
    expect(readUniformCartons('')).toEqual({isUniform:true,cases:'',unitsPerCase:''});
    expect(readUniformCartons('10x12')).toEqual({isUniform:true,cases:'10',unitsPerCase:'12'});
    expect(readUniformCartons('12,10,11').isUniform).toBe(false);
    expect(writeUniformCartons('10','12')).toBe('10x12');
    expect(parsePackageCounts(writeUniformCartons('10','12'))).toHaveLength(10);
    expect(writeUniformCartons('10','')).toBe('10x');
    expect(()=>parsePackageCounts(writeUniformCartons('10',''))).toThrow(/positive integers/);
    expect(()=>writeUniformCartons('1.5','12')).toThrow(/whole numbers/);
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
  it('calculates usable units and missing or extra units independently',()=>{
    const delivery = {...row, packageText:'', looseUnits:'98', billedUnits:'100', damagedUnits:'3'};
    expect(computeReceiptLine(delivery)).toMatchObject({
      totalUnits:98, billedUnits:100, damagedUnits:3, usableUnits:95, missingUnits:2, excessUnits:0,
    });
    expect(computeReceiptLine({...delivery,billedUnits:'96'})).toMatchObject({usableUnits:95,missingUnits:0,excessUnits:2});
    expect(computeReceiptLine({...delivery,billedUnits:''})).toMatchObject({billedUnits:null,usableUnits:95,missingUnits:0,excessUnits:0});
    expect(buildGoodsReceiptPayload(org,[delivery])).toEqual([{
      productId:product.id,packageCounts:[],looseUnits:98,unitCost:1120.5,billedUnits:100,damagedUnits:3,
    }]);
  });
  it('accepts fully missing or damaged lines and rejects invalid discrepancies',()=>{
    const delivery = {...row,packageText:'',looseUnits:'0',billedUnits:'10'};
    expect(computeReceiptLine(delivery)).toMatchObject({usableUnits:0,missingUnits:10});
    expect(computeReceiptLine({...delivery,looseUnits:'10',damagedUnits:'10'})).toMatchObject({usableUnits:0,damagedUnits:10});
    expect(()=>computeReceiptLine({...delivery,damagedUnits:'1'})).toThrow(/cannot exceed received/);
    expect(()=>computeReceiptLine({...delivery,billedUnits:'-1'})).toThrow(/Billed units/);
    expect(()=>computeReceiptLine({...delivery,damagedUnits:'1.5'})).toThrow(/Damaged units/);
  });
  it('imports a header and five standard columns for cases, units/case, loose units and rate',()=>{
    const text='Product\tCases\tUnits per case\tLoose\tPurchase rate\n' +
      'FERT-50\t10\t12\t0\t1120.50\n' +
      'Fertilizer B\t8\t10\t5\t900';
    expect(parseReceivingNotebook(text)).toEqual([
      {sku:'FERT-50',packageText:'10x12',looseUnits:'0',unitCost:'1120.50'},
      {sku:'Fertilizer B',packageText:'8x10',looseUnits:'5',unitCost:'900'},
    ]);
    expect(parseReceivingNotebook('FERT-50\t0\t0\t6\t1120')).toEqual([
      {sku:'FERT-50',packageText:'',looseUnits:'6',unitCost:'1120'},
    ]);
    expect(()=>parseReceivingNotebook('FERT-50\t0\t12\t5\t1120')).toThrow(/0 cases/);
    expect(()=>parseReceivingNotebook('FERT-50\t201\t12\t0\t1120')).toThrow(/up to 200 cases/);
  });
  it('parses exact TAB-separated notepad rows, rejecting ambiguous or repeated SKUs',()=>{
    expect(parseReceivingNotebook('FERT-50\t12,10,11\t5\t1120.50\nCABLE-01\t5x12\t0\t25'))
      .toEqual([
        {sku:'FERT-50',packageText:'12,10,11',looseUnits:'5',unitCost:'1120.50'},
        {sku:'CABLE-01',packageText:'5x12',looseUnits:'0',unitCost:'25'},
      ]);
    expect(()=>parseReceivingNotebook('FERT-50 12 10')).toThrow(/TAB-separated/);
    expect(()=>parseReceivingNotebook('SKU\t10\t0\t25\nsku\t1\t0\t25')).toThrow(/Duplicate product/);
  });
});
