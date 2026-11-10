import React from 'react';
import { Minus, Plus, Trash2, AlertTriangle, PackageOpen } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import type { LineCalculation } from '@/lib/money';
import type { PosCartLine } from './pos-draft';

interface Props {
  lines: PosCartLine[];
  calculatedLines?: LineCalculation[];
  disabled?: boolean;
  onQuantityChange: (productId: string, quantity: number) => void;
  onDiscountChange: (productId: string, discount: number) => void;
  onRemove: (productId: string) => void;
}

/** Compact invoice-like *draft* worksheet. Computed cells always come from
 * the existing deterministic financial engine; nothing here writes stock,
 * confirms an order, creates a tax invoice, or records a payment. */
export const PosBillingGrid: React.FC<Props> = ({
  lines, calculatedLines, disabled = false,
  onQuantityChange, onDiscountChange, onRemove,
}) => (
  <section aria-label="Retail billing worksheet" className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
      <div>
        <h2 className="font-semibold text-[#142B4D]">Billing worksheet</h2>
        <p className="text-xs text-slate-500">Draft order lines · Product-master rates and GST · Whole-unit quantities</p>
      </div>
      <span className="rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800" aria-live="polite">
        {lines.length} {lines.length === 1 ? 'line' : 'lines'}
      </span>
    </div>
    <div className="max-h-[460px] w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto" role="region" aria-label="Scroll billing line items" tabIndex={0}>
      <table className="w-full min-w-[1030px] border-collapse text-left text-xs text-slate-700">
        <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          <tr className="border-b border-slate-200">
            <th scope="col" className="w-10 px-3 py-3 text-center">Sl.</th>
            <th scope="col" className="min-w-[205px] px-3 py-3">Product / SKU</th>
            <th scope="col" className="w-20 px-3 py-3">HSN</th>
            <th scope="col" className="w-40 px-3 py-3 text-center">Qty</th>
            <th scope="col" className="w-16 px-2 py-3">Unit</th>
            <th scope="col" className="w-24 px-2 py-3 text-right">Rate</th>
            <th scope="col" className="w-24 px-2 py-3 text-right">Disc %</th>
            <th scope="col" className="w-16 px-2 py-3 text-right">GST %</th>
            <th scope="col" className="w-28 px-2 py-3 text-right">Line total</th>
            <th scope="col" className="w-20 px-2 py-3 text-right">Stock*</th>
            <th scope="col" className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line, index) => {
            const { product, quantity, discountPercent } = line;
            const calculation = calculatedLines?.[index];
            const lowStock = product.currentStock !== undefined && quantity > product.currentStock;
            return (
              <tr key={product.id} className="align-middle hover:bg-teal-50/40">
                <td className="px-3 py-3 text-center font-medium tabular-nums text-slate-500">{index + 1}</td>
                <td className="px-3 py-3">
                  <p className="max-w-[250px] truncate font-semibold text-[#142B4D]" title={product.name}>{product.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500" title={product.sku}>{product.sku}{product.brand ? ` · ${product.brand}` : ''}</p>
                </td>
                <td className="px-3 py-3 tabular-nums">{product.hsnCode || '—'}</td>
                <td className="px-2 py-2.5">
                  <div className="flex h-9 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <button type="button" disabled={disabled || quantity <= 1}
                      className="grid h-9 w-9 shrink-0 place-items-center text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                      aria-label={`Decrease ${product.name}`}
                      onClick={() => onQuantityChange(product.id, Math.max(1, quantity - 1))}>
                      <Minus size={13}/>
                    </button>
                    <input type="number" inputMode="numeric" min={1} max={1000000} step={1}
                      disabled={disabled} aria-label={`Quantity for ${product.name}`}
                      className="h-9 min-w-0 w-full border-x border-slate-200 bg-transparent px-1 text-center text-xs font-semibold tabular-nums focus:outline-none focus:bg-teal-50"
                      value={quantity} onChange={(e) => onQuantityChange(product.id, e.target.value === '' ? 0 : Number(e.target.value))}/>
                    <button type="button" disabled={disabled || quantity >= 1000000}
                      className="grid h-9 w-9 shrink-0 place-items-center text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                      aria-label={`Increase ${product.name}`}
                      onClick={() => onQuantityChange(product.id, quantity + 1)}>
                      <Plus size={13}/>
                    </button>
                  </div>
                </td>
                <td className="px-2 py-3">{product.uom}</td>
                <td className="px-2 py-3 text-right font-medium tabular-nums">{formatCurrency(product.sellingPrice)}</td>
                <td className="px-2 py-2.5">
                  <input type="number" inputMode="decimal" min={0} max={100} step={0.5}
                    disabled={disabled} aria-label={`Discount for ${product.name}`}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right text-xs tabular-nums focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={discountPercent}
                    onChange={(e) => onDiscountChange(product.id, e.target.value === '' ? 0 : Number(e.target.value))}/>
                </td>
                <td className="px-2 py-3 text-right tabular-nums">{product.taxRate}%</td>
                <td className="px-2 py-3 text-right font-bold tabular-nums text-[#142B4D]">
                  {calculation ? formatCurrency(calculation.totalAmount) : '—'}
                </td>
                <td className="px-2 py-3 text-right">
                  <span className={lowStock ? 'font-semibold text-amber-700' : 'text-slate-500'}>
                    {product.currentStock ?? '—'}
                  </span>
                  {lowStock && <span className="mt-1 block text-[10px] text-amber-700" title="Quantity exceeds last displayed stock; confirmation may fail.">
                    <AlertTriangle className="mr-1 inline h-3 w-3"/>
                    Quantity exceeds last displayed stock
                  </span>}
                </td>
                <td className="px-2 py-3 text-center">
                  <button type="button" disabled={disabled}
                    aria-label={`Remove ${product.name}`}
                    onClick={() => onRemove(product.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40">
                    <Trash2 size={15}/>
                  </button>
                </td>
              </tr>
            );
          })}
          {lines.length === 0 && (
            <tr>
              <td colSpan={11} className="px-6 py-14 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-500">
                  <PackageOpen size={28} className="text-teal-600" strokeWidth={1.5}/>
                  <p className="font-semibold text-[#142B4D]">No items in this bill yet</p>
                  <p>Find a product above and press Enter to add the first row.</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
      *Stock shown is a last-known value, not a reservation. Final confirmation checks stock again. HSN, rates and GST are read-only product-master values.
    </div>
  </section>
);
