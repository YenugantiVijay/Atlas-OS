import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PosBillingGrid } from './PosBillingGrid';
import { summarizePosCart, type PosCartLine } from './pos-draft';
import type { Product } from '@/types';

const product: Product = {
  id: 'p-wire', organizationId: 'org-1', name: 'Copper Wire 1.5mm', sku: 'CW-15',
  brand: 'Atlas', category: 'Electrical', uom: 'Coils', hsnCode: '8544',
  purchaseCost: 500, sellingPrice: 1000, taxRate: 18, currentStock: 4,
  reorderThreshold: 2, isActive: true, createdAt: '', updatedAt: '',
};

function setup(quantity = 2, discountPercent = 10) {
  const lines: PosCartLine[] = [{ product, quantity, discountPercent }];
  const onQuantityChange = vi.fn();
  const onDiscountChange = vi.fn();
  const onRemove = vi.fn();
  render(<PosBillingGrid lines={lines} calculatedLines={summarizePosCart(lines).items}
    onQuantityChange={onQuantityChange} onDiscountChange={onDiscountChange}
    onRemove={onRemove}/>);
  return { onQuantityChange, onDiscountChange, onRemove };
}

describe('POS billing worksheet presentation', () => {
  it('renders structured HSN/GST billing columns using the shared money engine', () => {
    setup();
    const table = screen.getByRole('table');
    for (const label of ['Sl.', 'Product / SKU', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc %', 'GST %', 'Line total', 'Stock*']) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    expect(within(table).getByText('8544')).toBeInTheDocument();
    expect(within(table).getByText('CW-15 · Atlas')).toBeInTheDocument();
    expect(within(table).getByText('18%')).toBeInTheDocument();
    expect(within(table).getByText('₹2,124.00')).toBeInTheDocument();
    expect(screen.getByText(/Stock shown is a last-known value/)).toBeInTheDocument();
  });

  it('routes quantity, discount and delete only through supplied local cart callbacks', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Copper Wire 1.5mm' }));
    fireEvent.change(screen.getByLabelText('Quantity for Copper Wire 1.5mm'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Discount for Copper Wire 1.5mm'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Copper Wire 1.5mm' }));
    expect(handlers.onQuantityChange).toHaveBeenCalledWith('p-wire', 3);
    expect(handlers.onQuantityChange).toHaveBeenCalledWith('p-wire', 9);
    expect(handlers.onDiscountChange).toHaveBeenCalledWith('p-wire', 12.5);
    expect(handlers.onRemove).toHaveBeenCalledWith('p-wire');
  });

  it('warns about last-known stock and allows no unsafe action while saving', () => {
    const lines: PosCartLine[] = [{ product, quantity: 9, discountPercent: 0 }];
    render(<PosBillingGrid lines={lines} calculatedLines={summarizePosCart(lines).items}
      disabled onQuantityChange={vi.fn()} onDiscountChange={vi.fn()} onRemove={vi.fn()}/>);
    expect(screen.getByText('Quantity exceeds last displayed stock')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity for Copper Wire 1.5mm')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Copper Wire 1.5mm' })).toBeDisabled();
  });

  it('shows an empty-state worksheet without invented invoice totals', () => {
    render(<PosBillingGrid lines={[]} onQuantityChange={vi.fn()} onDiscountChange={vi.fn()} onRemove={vi.fn()}/>);
    expect(screen.getByText('No items in this bill yet')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
