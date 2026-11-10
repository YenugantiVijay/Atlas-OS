import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, History, Search, ShieldCheck, TrendingUpDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { suppliersService } from '@/services/suppliers.service';
import { productsService } from '@/services/products.service';
import {
  supplierPriceHistoryService, type SupplierPriceEntry,
} from '@/services/supplier-price-history.service';
import { parseSupplierRate, supplierRateChange } from './supplier-rate-utils';
import type { Product, Supplier } from '@/types';

const currency = (rate: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(rate);
const today = () => new Date().toISOString().slice(0, 10);

/** A dated, append-only cost record. Neither quotes nor posted GRNs mutate
 * historical stock valuation or the product's configured selling price. */
export const SupplierPriceHistoryPage: React.FC = () => {
  const { currentOrg, currentRole, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const orgId = currentOrg?.id || '';
  const readAllowed = check('supplier-prices:read').allowed;
  const recordPermission = check('supplier-prices:record');
  const canRecord = recordPermission.allowed && !isMockAuth;
  const requestIdentity = `${orgId}:${currentRole || 'none'}:${isMockAuth}`;
  const activeIdentity = useRef(requestIdentity);
  activeIdentity.current = requestIdentity;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [entries, setEntries] = useState<SupplierPriceEntry[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [matches, setMatches] = useState<Product[]>([]);
  const [price, setPrice] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [reference, setReference] = useState('');
  const [entryId, setEntryId] = useState<string>(() => crypto.randomUUID());
  const [previous, setPrevious] = useState<SupplierPriceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchError, setSearchError] = useState('');

  const refresh = useCallback(async () => {
    if (!orgId || isMockAuth || !readAllowed) {
      setSuppliers([]); setEntries([]); return;
    }
    const requestedIdentity = requestIdentity;
    setLoading(true);
    try {
      const [supplierRows, history] = await Promise.all([
        suppliersService.getSuppliers(orgId, false),
        supplierPriceHistoryService.list(orgId, { limit: 60 }),
      ]);
      if (activeIdentity.current !== requestedIdentity) return;
      setSuppliers(supplierRows);
      setEntries(history);
      setError('');
    } catch (cause) {
      if (activeIdentity.current === requestedIdentity)
        setError(cause instanceof Error ? cause.message : 'Unable to load supplier prices.');
    } finally {
      if (activeIdentity.current === requestedIdentity) setLoading(false);
    }
  }, [orgId, isMockAuth, readAllowed, requestIdentity]);

  useEffect(() => {
    setSuppliers([]); setEntries([]); setSupplierId(''); setProduct(null);
    setProductQuery(''); setMatches([]); setPrevious(null);
    setPrice(''); setReference(''); setEffectiveOn(today());
    setError(''); setSuccess(''); setEntryId(crypto.randomUUID());
  }, [requestIdentity]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!canRecord || !orgId || productQuery.trim().length < 2) {
      setMatches([]); setSearchError(''); return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const page = await productsService.getProductsPaginated(orgId, {
          search: productQuery.trim(), page: 1, pageSize: 8, isActive: true,
        }, false);
        if (active) { setMatches(page.data); setSearchError(''); }
      } catch (cause) {
        if (active) {
          setMatches([]);
          setSearchError(cause instanceof Error ? cause.message : 'Product search failed.');
        }
      }
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [orgId, productQuery, canRecord]);

  useEffect(() => {
    if (!orgId || !supplierId || !product || !readAllowed || isMockAuth) {
      setPrevious(null); return;
    }
    let active = true;
    setPrevious(null);
    void supplierPriceHistoryService.list(orgId, {
      supplierId, productId: product.id, asOf: effectiveOn, limit: 1,
    }).then((rows) => {
      if (active) setPrevious(rows[0] || null);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to compare supplier rates.');
    });
    return () => { active = false; };
  }, [orgId, supplierId, product, effectiveOn, readAllowed, isMockAuth]);

  let validatedPrice: number | null = null;
  try { validatedPrice = parseSupplierRate(price); } catch { /* show hint, not invalid submit */ }
  const comparison = validatedPrice === null ? null : supplierRateChange(previous?.unitCost, validatedPrice);
  const saveEnabled = canRecord && !busy && !!supplierId && !!product &&
    validatedPrice !== null && reference.trim().length >= 3 &&
    reference.trim().length <= 500 && !!effectiveOn && effectiveOn <= today();

  const recordQuote = async () => {
    if (!saveEnabled || !product || validatedPrice === null || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setSuccess('');
    const requestOrg = orgId;
    const requestedIdentity = requestIdentity;
    try {
      const result = await supplierPriceHistoryService.recordQuote({
        organizationId: requestOrg, entryId, supplierId,
        productId: product.id, unitCost: validatedPrice,
        effectiveOn, notes: reference.trim(),
      });
      if (activeIdentity.current !== requestedIdentity) return;
      const change = supplierRateChange(result.previous_rate, validatedPrice);
      const movement = change.percent === null ? 'no comparable prior rate' :
        Math.abs(change.percent).toFixed(1) + '% ' + change.direction;
      setSuccess(result.idempotent_replay
        ? 'This quote was already recorded; a duplicate was not created.'
        : 'Supplier quote recorded (' + movement + '). Product prices and inventory were not changed.');
      setEntryId(crypto.randomUUID());
      setProduct(null); setProductQuery(''); setMatches([]);
      setPrice(''); setReference(''); setPrevious(null);
      await refresh();
    } catch (cause) {
      if (activeIdentity.current === requestedIdentity)
        setError(cause instanceof Error ? cause.message : 'Supplier quote was not saved.');
      // Keep entryId on failure, so connection retries never duplicate a quote.
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#142B4D] sm:text-2xl">
            <TrendingUpDown className="text-teal-700" size={24}/> Supplier Price History
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track supplier notices and rates paid on posted goods receipts — without rewriting past costs.
          </p>
        </div>
        <Link to="/receiving" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#142B4D] hover:bg-slate-50">
          Goods Receiving
        </Link>
      </div>
      {isMockAuth && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Supplier rate history is cloud-only. Demo Mode never simulates a saved quote or purchase history.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Supplier rate entry">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#142B4D]">Record a supplier rate notice</h2>
          <span className="text-xs text-slate-500">Append-only · no automatic price changes</span>
        </div>
        {!recordPermission.allowed && !isMockAuth && (
          <p role="status" className="mb-3 text-xs text-slate-600">
            Your role can review the history but cannot add supplier quotes.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="rate-supplier" className="mb-1 block text-xs font-semibold text-slate-700">Supplier</label>
            <select id="rate-supplier" disabled={!canRecord || busy} value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="">Choose supplier</option>
              {suppliers.filter((x) => x.isActive).map((x) =>
                <option key={x.id} value={x.id}>{x.companyName || x.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <label htmlFor="rate-product" className="mb-1 block text-xs font-semibold text-slate-700">Product</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-3 text-slate-400"/>
              <input id="rate-product" disabled={!canRecord || busy}
                value={product ? product.name + ' (' + product.sku + ')' : productQuery}
                onChange={(e) => { setProduct(null); setProductQuery(e.target.value); }}
                placeholder="Search name, SKU, brand or HSN"
                className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm"/>
            </div>
            {product && <button type="button" disabled={busy || !canRecord}
              onClick={() => { setProduct(null); setProductQuery(''); }} className="mt-1 text-xs font-semibold text-teal-700">Change product</button>}
            {matches.length > 0 && !product && (
              <div className="absolute left-0 right-0 top-full z-20 max-h-52 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {matches.map((p) => <button type="button" key={p.id}
                  onClick={() => { setProduct(p); setProductQuery(''); setMatches([]); setSearchError(''); }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-teal-50">
                  <strong>{p.name}</strong><span className="ml-2 text-xs text-slate-500">{p.sku} · {p.uom}</span>
                </button>)}
              </div>
            )}
            {searchError && <p role="alert" className="mt-1 text-xs text-rose-700">{searchError}</p>}
          </div>
          <div>
            <label htmlFor="rate-price" className="mb-1 block text-xs font-semibold text-slate-700">Supplier rate / unit (₹)</label>
            <input id="rate-price" disabled={!canRecord || busy} value={price}
              onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 1120.50"
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
          </div>
          <div>
            <label htmlFor="rate-date" className="mb-1 block text-xs font-semibold text-slate-700">Effective date</label>
            <input id="rate-date" type="date" max={today()} value={effectiveOn}
              onChange={(e) => setEffectiveOn(e.target.value)} disabled={!canRecord || busy}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,340px)]">
          <div>
            <label htmlFor="rate-reference" className="mb-1 block text-xs font-semibold text-slate-700">
              Source / reference (required)
            </label>
            <input id="rate-reference" value={reference} maxLength={500} disabled={!canRecord || busy}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Supplier WhatsApp notice, rate circular number, quotation..."
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => void recordQuote()} disabled={!saveEnabled}
              className="h-10 w-full rounded-lg bg-teal-700 px-4 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? 'Recording…' : 'Record supplier quote'}
            </button>
          </div>
        </div>
        {supplierId && product && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <div>
              <span className="block text-xs text-slate-600">Previous recorded supplier rate</span>
              <strong>{previous ? currency(previous.unitCost) : 'No prior rate found'}</strong>
              {previous && <span className="ml-2 text-xs text-slate-500">
                {previous.sourceType === 'GOODS_RECEIPT' ? 'Posted GRN' : 'Supplier quote'} · {previous.effectiveOn}
              </span>}
            </div>
            {comparison && comparison.difference !== null && (
              <div className={'inline-flex items-center gap-1 text-sm font-semibold ' +
                (comparison.direction === 'increase' ? 'text-amber-800' :
                  comparison.direction === 'decrease' ? 'text-emerald-700' : 'text-slate-600')}>
                {comparison.direction === 'increase' ? <ArrowUpRight size={17}/> :
                  comparison.direction === 'decrease' ? <ArrowDownRight size={17}/> : <History size={17}/>}
                {comparison.direction === 'unchanged' ? 'No change' :
                  currency(Math.abs(comparison.difference)) + ' ' + comparison.direction +
                  (comparison.percent === null ? '' : ' (' + Math.abs(comparison.percent).toFixed(1) + '%)')}
                {comparison.significant && <span className="ml-2 text-xs font-normal">Notable change (≥5%)</span>}
              </div>
            )}
          </div>
        )}
        <p className="mt-3 flex items-center gap-1 text-xs text-slate-600">
          <ShieldCheck size={14}/> Recording a quote does not change stock, master purchase cost, sale price or valuation.
        </p>
      </section>

      <section aria-label="Recorded supplier prices" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-[#142B4D]">Rate timeline</h2>
          <button type="button" disabled={loading || isMockAuth || !readAllowed}
            onClick={() => void refresh()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-40">
            Refresh
          </button>
        </div>
        <p className="px-4 pt-3 text-xs text-slate-500">
          Showing the latest 60 effective-dated entries. GRN rates are captured automatically when stock is posted; supplier notices are entered manually.
        </p>
        {loading && <p role="status" className="px-4 py-3 text-sm text-slate-500">Loading supplier rate history…</p>}
        {!loading && entries.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No supplier prices recorded in this workspace.</p>}
        <div role="region" aria-label="Supplier price table" tabIndex={0} className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{['Effective', 'Supplier', 'Product / SKU', 'Unit rate', 'Source', 'Reference', 'Recorded'].map((x) =>
                <th key={x} scope="col" className="px-4 py-3 font-semibold">{x}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => <tr key={entry.id}>
                <td className="whitespace-nowrap px-4 py-3">{entry.effectiveOn}</td>
                <td className="px-4 py-3 font-semibold">{entry.supplierName}</td>
                <td className="px-4 py-3">
                  <strong>{entry.productName}</strong>
                  <span className="block text-slate-500">{entry.productSku} · {entry.productUom}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-bold tabular-nums">{currency(entry.unitCost)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    {entry.sourceType === 'GOODS_RECEIPT' ? 'Posted GRN' : 'Supplier quote'}
                  </span>
                </td>
                <td className="max-w-[230px] truncate px-4 py-3" title={entry.notes || entry.sourceReference}>
                  {entry.sourceType === 'GOODS_RECEIPT' ? entry.sourceReference : entry.notes}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  <CalendarDays size={12} className="mr-1 inline"/>{entry.recordedAt.slice(0, 10)}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
