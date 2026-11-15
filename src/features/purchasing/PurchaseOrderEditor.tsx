import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { getBusinessDate, formatDisplayDate } from '@/lib/dates';
import { formatCurrency, toPaise } from '@/lib/money';
import { productsService } from '@/services/products.service';
import { purchaseOrdersService, type PurchaseOrder, type PurchaseOrderLineInput, type PurchaseOrderSupplier } from '@/services/purchase-orders.service';
import { supplierPriceHistoryService } from '@/services/supplier-price-history.service';
import type { Product } from '@/types';
import { parseSupplierRate } from '@/features/pricing/supplier-rate-utils';

const MAX_LINES = 50;
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 disabled:bg-slate-50';

interface WorksheetLine {
  productId: string;
  productName: string;
  sku: string;
  uom: string;
  quantity: string;
  unitCost: string;
}

function useDebouncedTerm(value: string) {
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(value.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [value]);
  return term === value.trim() ? term : '';
}

function toWorksheet(order?: PurchaseOrder): WorksheetLine[] {
  return (order?.lines ?? []).map((line) => ({ ...line, quantity: String(line.quantity), unitCost: Number(line.unitCost).toFixed(2) }));
}

function readLines(rows: WorksheetLine[]): PurchaseOrderLineInput[] | null {
  try {
    return rows.map((row) => {
      const quantity = Number(row.quantity);
      if (!/^[1-9]\d{0,6}$/.test(row.quantity) || quantity > 1_000_000) throw new Error('Invalid quantity');
      return { productId: row.productId, uom: row.uom, quantity, unitCost: parseSupplierRate(row.unitCost) };
    });
  } catch {
    return null;
  }
}

function subtotal(lines: PurchaseOrderLineInput[]) {
  const paise = lines.reduce((sum, line) => sum + BigInt(line.quantity) * BigInt(toPaise(line.unitCost)), 0n);
  return '₹' + (paise / 100n).toLocaleString('en-IN') + '.' + String(paise % 100n).padStart(2, '0');
}

function LastSupplierRate({ organizationId, scope, supplierId, line, onUse }: {
  organizationId: string; scope: string; supplierId: string; line: WorksheetLine; onUse: (rate: string) => void;
}) {
  const asOf = getBusinessDate();
  const history = useQuery({
    queryKey: ['purchase-order-rate', scope, supplierId, line.productId, asOf],
    queryFn: () => supplierPriceHistoryService.list(organizationId, { supplierId, productId: line.productId, asOf, limit: 1 }),
    staleTime: 0,
  });
  const rate = history.data?.[0];
  if (history.isError) return <span className="mt-1 block text-xs text-slate-500">Last supplier rate unavailable.</span>;
  if (!rate || rate.productUom !== line.uom) return null;
  return (
    <button type="button" onClick={() => onUse(rate.unitCost.toFixed(2))}
      aria-label={'Use last supplier rate for ' + line.productName}
      className="mt-1 text-left text-xs font-medium text-teal-800 hover:underline">
      Use {formatCurrency(rate.unitCost)} · {formatDisplayDate(rate.effectiveOn)}
    </button>
  );
}

export function PurchaseOrderEditor({ organizationId, scope, initial, canWrite, onBack, onChange }: {
  organizationId: string;
  scope: string;
  initial?: PurchaseOrder;
  canWrite: boolean;
  onBack: () => void;
  onChange: () => Promise<void>;
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [record, setRecord] = useState(initial);
  const [supplier, setSupplier] = useState<PurchaseOrderSupplier | undefined>(() => initial ? { id: initial.supplier_id, name: initial.supplier_name } : undefined);
  const [expectedOn, setExpectedOn] = useState(initial?.expected_on ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [rows, setRows] = useState(() => toWorksheet(initial));
  const [supplierSearch, setSupplierSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [dirty, setDirty] = useState(!initial);
  const [confirmOrdered, setConfirmOrdered] = useState(false);
  const [notice, setNotice] = useState('');
  const supplierTerm = useDebouncedTerm(supplierSearch);
  const productTerm = useDebouncedTerm(productSearch);
  const editable = canWrite && record?.status !== 'ORDERED';
  const parsed = readLines(rows);

  const suppliers = useQuery({
    queryKey: ['purchase-order-suppliers', scope, supplierTerm],
    queryFn: ({ signal }) => purchaseOrdersService.searchSuppliers(organizationId, supplierTerm, signal),
    enabled: editable && supplierTerm.length >= 2,
  });
  const products = useQuery({
    queryKey: ['purchase-order-products', scope, productTerm],
    queryFn: () => productsService.getProductsPaginated(organizationId, { search: productTerm, pageSize: 8, isActive: true }),
    enabled: editable && productTerm.length >= 2,
  });

  const write = useMutation({
    mutationFn: (action: 'save' | 'order') => {
      if (!editable) throw new Error('Purchase order editing is unavailable.');
      if (action === 'order') {
        if (!record || dirty) throw new Error('Save the current draft before marking it ordered.');
        return purchaseOrdersService.markOrdered(organizationId, id, record.revision);
      }
      if (!supplier || !parsed?.length) throw new Error('Choose a supplier and enter a whole quantity and purchase rate for each product.');
      return purchaseOrdersService.saveDraft(organizationId, {
        id, revision: record?.revision ?? null, supplierId: supplier.id, expectedOn: expectedOn || null, notes, lines: parsed,
      });
    },
    onSuccess: async (saved) => {
      setRecord(saved);
      setSupplier({ id: saved.supplier_id, name: saved.supplier_name });
      setRows(toWorksheet(saved));
      setExpectedOn(saved.expected_on ?? '');
      setNotes(saved.notes);
      setDirty(false);
      setConfirmOrdered(false);
      setNotice(saved.order_number ? saved.order_number + ' marked ordered.' : 'Purchase order draft saved.');
      await onChange();
    },
  });

  const changed = () => {
    setDirty(true);
    setConfirmOrdered(false);
    setNotice('');
    write.reset();
  };
  const selectSupplier = (next: PurchaseOrderSupplier) => {
    if (supplier && supplier.id !== next.id) setRows((current) => current.map((row) => ({ ...row, unitCost: '' })));
    setSupplier(next);
    setSupplierSearch('');
    changed();
  };
  const addProduct = (product: Product) => {
    if (rows.length >= MAX_LINES || rows.some((row) => row.productId === product.id)) return;
    setRows((current) => [...current, { productId: product.id, productName: product.name, sku: product.sku, uom: product.uom, quantity: '1', unitCost: '' }]);
    setProductSearch('');
    changed();
  };
  const updateLine = (productId: string, key: 'quantity' | 'unitCost', value: string) => {
    setRows((current) => current.map((row) => row.productId === productId ? { ...row, [key]: value } : row));
    changed();
  };

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Purchase order details">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[#142B4D]">{record?.order_number ?? 'Purchase order draft'}</h2>
          {record?.ordered_at && <p className="text-sm text-slate-600">Ordered {formatDisplayDate(record.ordered_at)}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={write.isPending} onClick={onBack}>Back to orders</Button>
      </div>
      <fieldset disabled={!editable || write.isPending} className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-sm font-medium text-slate-700">Supplier</span>
            {supplier && <p className="break-words text-sm text-slate-900">{supplier.name}</p>}
            {editable && <>
              <input aria-label="Find supplier" className={inputClass} value={supplierSearch} maxLength={100}
                onChange={(event) => setSupplierSearch(event.target.value)} placeholder={supplier ? 'Find a different supplier' : 'Search supplier or company name'} />
              {supplierTerm.length >= 2 && suppliers.isError && <p role="alert" className="text-sm text-rose-800">{suppliers.error.message}</p>}
              {supplierTerm.length >= 2 && suppliers.isSuccess && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200" role="group" aria-label="Supplier matches">
                  {suppliers.data.length === 0 && <p className="p-2 text-xs text-slate-600">No matching active suppliers.</p>}
                  {suppliers.data.map((match) => <button key={match.id} type="button" onClick={() => selectSupplier(match)}
                    className="block w-full break-words px-3 py-2 text-left text-sm hover:bg-teal-50">{match.name}</button>)}
                </div>
              )}
            </>}
          </div>
          <label className="space-y-1 text-sm font-medium text-slate-700">
            <span className="block">Expected delivery</span>
            <input type="date" value={expectedOn} onChange={(event) => { setExpectedOn(event.target.value); changed(); }} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            <span className="block">Order notes</span>
            <input value={notes} maxLength={500} onChange={(event) => { setNotes(event.target.value); changed(); }} className={inputClass} placeholder="Supplier reference or delivery instructions" />
          </label>
        </div>
        {editable && <div className="max-w-xl space-y-1">
          <label htmlFor="po-product-search" className="block text-sm font-medium text-slate-700">Add product</label>
          <input id="po-product-search" value={productSearch} maxLength={100} disabled={rows.length >= MAX_LINES}
            onChange={(event) => setProductSearch(event.target.value)} className={inputClass} placeholder="Search name or SKU" />
          {productTerm.length >= 2 && products.isError && <p role="alert" className="text-sm text-rose-800">{products.error.message}</p>}
          {productTerm.length >= 2 && products.isSuccess && (
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200" role="group" aria-label="Purchase product matches">
              {products.data.data.length === 0 && <p className="p-2 text-xs text-slate-600">No matching active products.</p>}
              {products.data.data.map((product) => (
                <button key={product.id} type="button" onClick={() => addProduct(product)} disabled={rows.some((row) => row.productId === product.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50 disabled:opacity-50">
                  <span>{product.name} · {product.sku}</span>
                  <span className="text-xs text-slate-600">Stock {product.currentStock ?? '—'} {product.uom}</span>
                </button>
              ))}
            </div>
          )}
        </div>}
        {rows.length > 0 && <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label="Purchase order products" tabIndex={0}>
          <table className="w-full min-w-[580px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr>
              <th scope="col" className="p-2">Product / SKU</th>
              <th scope="col" className="w-32 p-2">Quantity</th>
              <th scope="col" className="w-52 p-2">Purchase rate</th>
              {editable && <th scope="col" className="w-20 p-2"><span className="sr-only">Remove product</span></th>}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => <tr key={row.productId}>
                <th scope="row" className="p-2 font-medium">{row.productName}<span className="block text-xs text-slate-500">{row.sku} · {row.uom}</span></th>
                <td className="p-2 align-top">
                  <input aria-label={'Quantity for ' + row.productName} className={inputClass} value={row.quantity} inputMode="numeric" maxLength={7}
                    onChange={(event) => updateLine(row.productId, 'quantity', event.target.value)} />
                </td>
                <td className="p-2 align-top">
                  <input aria-label={'Purchase rate for ' + row.productName} className={inputClass} value={row.unitCost} inputMode="decimal" maxLength={13}
                    onChange={(event) => updateLine(row.productId, 'unitCost', event.target.value)} />
                  {editable && supplier && <LastSupplierRate organizationId={organizationId} scope={scope} supplierId={supplier.id} line={row}
                    onUse={(rate) => updateLine(row.productId, 'unitCost', rate)} />}
                </td>
                {editable && <td className="p-2 align-top"><Button type="button" size="sm" variant="ghost" aria-label={'Remove ' + row.productName}
                  onClick={() => { setRows((current) => current.filter((line) => line.productId !== row.productId)); changed(); }}>Remove</Button></td>}
              </tr>)}
            </tbody>
          </table>
        </div>}
        {parsed && parsed.length > 0 && <p className="text-right text-sm text-slate-700">Subtotal before tax <strong>{subtotal(parsed)}</strong></p>}
      </fieldset>
      {write.isError && <p role="alert" className="text-sm text-rose-800">{write.error.message}</p>}
      {notice && <p role="status" className="text-sm font-medium text-emerald-800">{notice}</p>}
      {editable && (confirmOrdered ? (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3">
          <p className="text-sm text-amber-900">Confirming assigns a PO number and finalizes this draft.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" isLoading={write.isPending} onClick={() => write.mutate('order')}>Confirm ordered</Button>
            <Button type="button" variant="ghost" disabled={write.isPending} onClick={() => setConfirmOrdered(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={!supplier || rows.length === 0 || !dirty} isLoading={write.isPending} onClick={() => write.mutate('save')}>Save draft</Button>
          {record?.status === 'DRAFT' && !dirty && <Button type="button" variant="outline" disabled={write.isPending}
            onClick={() => { write.reset(); setConfirmOrdered(true); }}>Mark ordered</Button>}
        </div>
      ))}
    </section>
  );
}
