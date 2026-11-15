import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GoodsReceivingPage } from './GoodsReceivingPage';
import { productsService } from '@/services/products.service';
import { suppliersService } from '@/services/suppliers.service';
import { supplierPriceHistoryService } from '@/services/supplier-price-history.service';
import { goodsReceivingService } from '@/services/goods-receiving.service';
import { clearReceivingLists } from './receiving-workspace';

vi.mock('@/features/organizations/OrgContext',()=>({
  useOrg:()=>({currentOrg:{id:'org-a'},currentUser:{id:'user-a'},isMockAuth:false}),
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
    sessionStorage.clear();
    clearReceivingLists('user-a','org-a');
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

  it('restores unsaved receipt inputs and quantities after navigating away and back', async()=>{
    const first = render(<MemoryRouter><GoodsReceivingPage/></MemoryRouter>);
    await waitFor(()=>expect(screen.getByRole('option',{name:'Company A'})).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'s1'}});
    fireEvent.change(screen.getByLabelText('Supplier invoice / delivery reference'),{target:{value:'STG-INV-001'}});
    fireEvent.change(screen.getByLabelText('Receiving notes (optional)'),{target:{value:'Truck arrived'}});
    fireEvent.change(screen.getByLabelText('Add product by name, SKU, brand or HSN'),{target:{value:'Fertilizer'}});
    fireEvent.click(await screen.findByRole('button',{name:/Fertilizer A/}));
    fireEvent.change(screen.getByLabelText('Cases for Fertilizer A'),{target:{value:'10'}});
    fireEvent.change(screen.getByLabelText('Units per case for Fertilizer A'),{target:{value:'12'}});
    fireEvent.change(screen.getByLabelText('Loose units for Fertilizer A'),{target:{value:'2'}});
    expect(screen.getByText('122')).toBeInTheDocument();
    first.unmount(); // react-router leaves the page
    render(<MemoryRouter><GoodsReceivingPage/></MemoryRouter>);
    await waitFor(()=>expect(screen.getByLabelText('Supplier invoice / delivery reference')).toHaveValue('STG-INV-001'));
    expect(screen.getByLabelText('Supplier')).toHaveValue('s1');
    expect(screen.getByLabelText('Receiving notes (optional)')).toHaveValue('Truck arrived');
    expect(screen.getByLabelText('Cases for Fertilizer A')).toHaveValue('10');
    expect(screen.getByLabelText('Units per case for Fertilizer A')).toHaveValue('12');
    expect(screen.getByLabelText('Loose units for Fertilizer A')).toHaveValue('2');
    expect(screen.getByText('122')).toBeInTheDocument();
    expect(suppliersService.getSuppliers).toHaveBeenCalledTimes(1); // cached, no reload
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

  it('saves billed and damaged quantities, confirms usable units, and shows the posted discrepancy',async()=>{
    vi.mocked(goodsReceivingService.saveDraft).mockResolvedValue({receipt_id:'receipt',status:'DRAFT'});
    vi.mocked(goodsReceivingService.post).mockResolvedValue({
      receipt_id:'receipt',status:'POSTED',idempotent_replay:false,total_units:95,
    });
    render(<MemoryRouter><GoodsReceivingPage/></MemoryRouter>);
    await screen.findByRole('option',{name:'Company A'});
    fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'s1'}});
    fireEvent.change(screen.getByLabelText('Supplier invoice / delivery reference'),{target:{value:'INV-100'}});
    fireEvent.change(screen.getByLabelText('Add product by name, SKU, brand or HSN'),{target:{value:'Fertilizer'}});
    fireEvent.click(await screen.findByRole('button',{name:/Fertilizer A/}));
    fireEvent.change(screen.getByLabelText('Loose units for Fertilizer A'),{target:{value:'98'}});
    fireEvent.change(screen.getByLabelText('Billed units for Fertilizer A'),{target:{value:'100'}});
    fireEvent.change(screen.getByLabelText('Damaged units for Fertilizer A'),{target:{value:'3'}});
    expect(screen.getByText('Usable 95')).toBeInTheDocument();
    expect(screen.getByText('Missing 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Save receiving draft'}));
    await waitFor(()=>expect(goodsReceivingService.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      lines:[{productId:'p1',packageCounts:[],looseUnits:98,unitCost:110,billedUnits:100,damagedUnits:3}],
    })));
    const review = await screen.findByRole('button',{name:'Review & post stock'});
    await waitFor(()=>expect(review).toBeEnabled());
    fireEvent.click(review);
    expect(screen.getByText(/Posting will add 95 usable units/)).toBeInTheDocument();

    vi.mocked(goodsReceivingService.list).mockResolvedValueOnce([{
      id:'receipt',organizationId:'org-a',supplierId:'s1',supplierInvoiceNumber:'INV-100',
      status:'POSTED',receivedOn:'2026-11-12',createdAt:'',updatedAt:'',notes:'',
      lines:[{productId:'p1',productName:'Fertilizer A',sku:'FERT-A',uom:'Bags',packageCounts:[],
        looseUnits:98,unitCost:110,totalUnits:98,billedUnits:100,damagedUnits:3,usableUnits:95,missingUnits:2,excessUnits:0}],
    }]);
    fireEvent.click(screen.getByRole('button',{name:'Confirm posting'}));
    expect(await screen.findByText(/95 usable units added to stock/)).toBeInTheDocument();
    expect(await screen.findByText('Supplier follow-up')).toBeInTheDocument();
    fireEvent.click(screen.getByText('View delivery details'));
    const posted = screen.getByRole('table',{name:'Delivery details for INV-100'});
    expect(within(posted).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['100','98','3','95','2','0']);
  });
});
