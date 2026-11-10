import { describe, expect, it } from 'vitest';
import { prepareReceivingProduct, type ReceivingProductFields } from './receiving-new-product';

const base: ReceivingProductFields = {
  name:'  Fertilizer A  ',sku:' fert-a-50 ',brand:'Company A',category:'Fertilizer',
  uom:'Bags',inboundRate:'1120.50',sellingPrice:'1340',taxRate:'5',hsnCode:'3105',
};

describe('receiving inline new product — validated catalog master',()=>{
  it('normalizes the product without creating any opening inventory',()=>{
    const result=prepareReceivingProduct(base);
    expect(result).toMatchObject({
      name:'Fertilizer A',sku:'FERT-A-50',brand:'Company A',category:'Fertilizer',
      uom:'Bags',purchaseCost:1120.5,sellingPrice:1340,taxRate:5,hsnCode:'3105',
      isActive:true,
    });
    expect(result).not.toHaveProperty('currentStock');
    expect(result).not.toHaveProperty('openingStock');
  });
  it('requires distinct, safe SKU, name and a valid category',()=>{
    expect(()=>prepareReceivingProduct({...base,sku:'   '})).toThrow(/SKU/);
    expect(()=>prepareReceivingProduct({...base,sku:'has spaces'})).toThrow(/SKU/);
    expect(()=>prepareReceivingProduct({...base,name:'  '})).toThrow(/name/);
    expect(()=>prepareReceivingProduct({...base,category:' '})).toThrow(/Category/);
  });
  it('rejects negative/rounded money and invalid tax codes or rates',()=>{
    expect(()=>prepareReceivingProduct({...base,inboundRate:'-1'})).toThrow(/purchase rate/);
    expect(()=>prepareReceivingProduct({...base,inboundRate:'1.234'})).toThrow(/two decimals/);
    expect(()=>prepareReceivingProduct({...base,sellingPrice:'1.23.4'})).toThrow(/Selling price/);
    expect(()=>prepareReceivingProduct({...base,taxRate:'101'})).toThrow(/GST/);
    expect(()=>prepareReceivingProduct({...base,hsnCode:'ABC'})).toThrow(/HSN/);
    expect(prepareReceivingProduct({...base,taxRate:'0'}).taxRate).toBe(0);
  });
});
