import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GoodsReceivingPage } from './GoodsReceivingPage';
import { productsService } from '@/services/products.service';
import { suppliersService } from '@/services/suppliers.service';
import { supplierPriceHistoryService } from '@/services/supplier-price-history.service';

vi.mock('@/features/organizations/OrgContext',()=>({
  useOrg:()=>({currentOrg:{id:'org-a'},isMockAuth:false}),
}));
vi.mock('@/hooks/useActionPermission',()=>({
  useActionPermission:()=>({check:()=>({allowed:true})}),
}));
vi.mock('@/services/products.service',()=>({
  productsService:{getProductsPaginated:vi.fn()},
}));
vi.mock('@/services/suppliers.service',()=>({
  suppliersService:{getSuppliers:vi.fn()},
}));
vi.mock('@/services/goods-receiving.service',()=>({
  goodsReceivingService:{list:vi.fn(async()=>[]),saveDraft:vi.fn(),post:vi.fn()},
}));
vi.mock('@/services/supplier-price-history.service',()=>({
  supplierPriceHistoryService:{list:vi.fn()},
}));

const product={
  id:'p1',organizationId:'org-a',sku:'FERT-A',name:'Fertilizer A',
  brand:'Company A',category:'Fertilizer',uom:'Bags',purchaseCost:110,
  sellingPrice:150,taxRate:5,reorderThreshold:5,currentStock:10,isActive:true,
  createdAt:'',updatedAt:'',
};

describe('Goods Receiving — company rate advisory and Google-style lookup',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(suppliersService.getSuppliers).mockResolvedValue([
      {id:'s1',organizationId:'org-a',name:'Company A',isActive:true} as any,
    ]);
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({
      data:[product],totalCount:1,totalPages:1,
    } as any);
    vi.mocked(supplierPriceHistoryService.list).mockResolvedValue([
      {unitCost:100,effectiveOn:'2026-11-09',sourceType:'SUPPLIER_QUOTE'} as any,
    ]);
  });

  it('shows stock and selling price then flags significant incoming supplier-rate changes without modifying product data',async()=>{
    render(<MemoryRouter><GoodsReceivingPage/></MemoryRouter>);
    await waitFor(()=>expect(suppliersService.getSuppliers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'s1'}});
    fireEvent.change(screen.getByLabelText('Add product by name, SKU, brand or HSN'),{target:{value:'Fertilizer'}});
    const suggestion=await screen.findByRole('button',{name:/Fertilizer A/});
    expect(suggestion).toHaveTextContent('Available: 10 Bags');
    expect(suggestion).toHaveTextContent('Selling:');
    fireEvent.click(suggestion);
    await waitFor(()=>expect(supplierPriceHistoryService.list).toHaveBeenCalledWith(
      'org-a',expect.objectContaining({supplierId:'s1',productId:'p1',limit:1}),
    ));
    expect(await screen.findByText(/Last supplier:/)).toHaveTextContent('100');
    expect(screen.getByText(/Review rate change/)).toHaveTextContent('+10.0%');
    expect(product.purchaseCost).toBe(110);
    expect(product.sellingPrice).toBe(150);
  });
});
