import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Product, UOM } from '@/types';
import { productsService } from '@/services/products.service';
import { prepareReceivingProduct, type ReceivingProductFields } from './receiving-new-product';

interface Props {
  organizationId: string;
  suggestedName: string;
  onCreated: (product: Product) => void;
  onClose: () => void;
}

const UOMS: UOM[] = ['Nos','Bags','Kg','Litres','Boxes','Packs','Bundles','Coils','Meters','Sets','Rolls'];

/** Creates a catalog master with zero opening stock, then returns it to the
 * unsaved receiving worksheet. This does not bypass the product-creation RPC. */
export const ReceivingNewProductDialog: React.FC<Props> = ({
  organizationId, suggestedName, onCreated, onClose,
}) => {
  const [values, setValues] = useState<ReceivingProductFields>({
    name: suggestedName.slice(0, 255), sku: '', brand: '', category: 'General',
    uom: 'Nos', inboundRate: '', sellingPrice: '0', taxRate: '0', hsnCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const sending = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);
  const setField = (key: keyof ReceivingProductFields, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setError('');
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    let input: ReturnType<typeof prepareReceivingProduct>;
    try { input = prepareReceivingProduct(values); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid product.'); return; }
    sending.current = true; setBusy(true); setError('');
    try {
      const product = await productsService.createProduct(organizationId, input, false, 0);
      if (mounted.current) onCreated(product);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Product creation failed.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const control = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="receiving-product-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="receiving-product-title" className="text-lg font-bold text-[#142B4D]">Create new product</h2>
          <button aria-label="Close new product" type="button" disabled={busy} onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <p className="mb-4 text-xs text-slate-600">
          Save a real product master, then continue the same receiving sheet. Opening stock is always zero.
          Inventory increases only after the goods receipt is posted.
        </p>
        <form onSubmit={(e) => void create(e)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Product name *
              <input autoFocus aria-label="New product name" required maxLength={255}
                className={control + ' mt-1'} value={values.name} disabled={busy}
                onChange={e=>setField('name',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">SKU / item code *
              <input aria-label="New product SKU" required maxLength={100}
                className={control + ' mt-1'} value={values.sku} disabled={busy}
                placeholder="e.g. FERT-A-50" onChange={e=>setField('sku',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">Company / brand
              <input aria-label="New product brand" maxLength={255}
                className={control + ' mt-1'} value={values.brand} disabled={busy}
                onChange={e=>setField('brand',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">Category *
              <input aria-label="New product category" required maxLength={100}
                className={control + ' mt-1'} value={values.category} disabled={busy}
                onChange={e=>setField('category',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">Unit of measurement *
              <select aria-label="New product unit" className={control + ' mt-1'} value={values.uom} disabled={busy}
                onChange={e=>setField('uom',e.target.value)}>
                {UOMS.map(unit=><option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold">Incoming purchase rate / unit (₹) *
              <input aria-label="New product purchase rate" required inputMode="decimal"
                className={control + ' mt-1'} value={values.inboundRate} disabled={busy}
                placeholder="e.g. 1120.50" onChange={e=>setField('inboundRate',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">Selling price / unit (₹) *
              <input aria-label="New product selling price" required inputMode="decimal"
                className={control + ' mt-1'} value={values.sellingPrice} disabled={busy}
                onChange={e=>setField('sellingPrice',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold">GST rate (%) — verify for this item *
              <input aria-label="New product GST rate" required inputMode="decimal"
                className={control + ' mt-1'} value={values.taxRate} disabled={busy}
                onChange={e=>setField('taxRate',e.target.value)}/>
            </label>
            <label className="text-xs font-semibold sm:col-span-2">HSN code (optional)
              <input aria-label="New product HSN" inputMode="numeric" maxLength={8}
                className={control + ' mt-1'} value={values.hsnCode} disabled={busy}
                placeholder="4, 6 or 8 digits" onChange={e=>setField('hsnCode',e.target.value)}/>
            </label>
          </div>
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
          <p className="text-xs text-amber-800">The product master is saved immediately. Cancelling the receipt later will not delete it or create stock.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-40">Cancel</button>
            <button type="submit" disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40">
              <Plus size={15}/> {busy ? 'Creating…' : 'Create and add to sheet'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
