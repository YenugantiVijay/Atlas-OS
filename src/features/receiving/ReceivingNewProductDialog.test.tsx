import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReceivingNewProductDialog } from './ReceivingNewProductDialog';
import { productsService } from '@/services/products.service';
import type { Product } from '@/types';

vi.mock('@/services/products.service',()=>({
  productsService: { createProduct: vi.fn() },
}));

const product: Product = {
  id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  organizationId:'11111111-2222-4333-8444-555555555555',
  sku:'FERT-A',name:'Fertilizer A',brand:'Company A',category:'Fertilizer',
  uom:'Bags',purchaseCost:1120.5,sellingPrice:1400,taxRate:5,
  reorderThreshold:10,isActive:true,currentStock:0,createdAt:'',updatedAt:'',
};

describe('PR58 new product inside receiving worksheet',()=>{
  beforeEach(()=>{ vi.clearAllMocks(); });

  it('uses the guarded catalog RPC with zero opening stock and returns the new product',async()=>{
    const onCreated=vi.fn();
    vi.mocked(productsService.createProduct).mockResolvedValue(product);
    render(<ReceivingNewProductDialog organizationId={product.organizationId}
      suggestedName="Fertilizer A" onCreated={onCreated} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('New product SKU'),{target:{value:'fert-a'}});
    fireEvent.change(screen.getByLabelText('New product brand'),{target:{value:'Company A'}});
    fireEvent.change(screen.getByLabelText('New product category'),{target:{value:'Fertilizer'}});
    fireEvent.change(screen.getByLabelText('New product unit'),{target:{value:'Bags'}});
    fireEvent.change(screen.getByLabelText('New product purchase rate'),{target:{value:'1120.50'}});
    fireEvent.change(screen.getByLabelText('New product selling price'),{target:{value:'1400'}});
    fireEvent.change(screen.getByLabelText('New product GST rate'),{target:{value:'5'}});
    fireEvent.click(screen.getByRole('button',{name:'Create and add to sheet'}));
    await waitFor(()=>expect(onCreated).toHaveBeenCalledWith(product));
    expect(productsService.createProduct).toHaveBeenCalledTimes(1);
    expect(productsService.createProduct).toHaveBeenCalledWith(
      product.organizationId,expect.objectContaining({
        name:'Fertilizer A',sku:'FERT-A',uom:'Bags',purchaseCost:1120.5,sellingPrice:1400,taxRate:5,
      }),false,0,
    );
  });

  it('displays server-side failures without claiming the product was created',async()=>{
    const onCreated=vi.fn();
    vi.mocked(productsService.createProduct).mockRejectedValue(new Error('SKU already exists'));
    render(<ReceivingNewProductDialog organizationId={product.organizationId}
      suggestedName="Fertilizer A" onCreated={onCreated} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('New product SKU'),{target:{value:'FERT-A'}});
    fireEvent.change(screen.getByLabelText('New product purchase rate'),{target:{value:'1120.50'}});
    fireEvent.click(screen.getByRole('button',{name:'Create and add to sheet'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/SKU already exists/));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
