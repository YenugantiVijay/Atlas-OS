import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, PackagePlus, Plus, Search, Trash2, Upload, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import type { Product, Supplier } from '@/types';
import { productsService } from '@/services/products.service';
import { suppliersService } from '@/services/suppliers.service';
import { goodsReceivingService, type GoodsReceiptRecord } from '@/services/goods-receiving.service';
import {
  buildGoodsReceiptPayload, computeReceiptLine, parseReceivingNotebook,
  type ReceiptWorksheetLine,
} from './receiving-worksheet';

const today = () => new Date().toISOString().slice(0, 10);
const currency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

/**
 * Cloud-only supplier goods receipt. This is an operator worksheet, not a stock
 * adjustment loophole. The only stock-writing path is post_goods_receipt RPC.
 */
export const GoodsReceivingPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const orgId = currentOrg?.id || '';
  const canReceive = check('inventory:receive');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceiptRecord[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ReceiptWorksheetLine[]>([]);
  const [receiptId, setReceiptId] = useState(() => crypto.randomUUID());
  const [savedState, setSavedState] = useState<'NEW' | 'DRAFT' | 'POSTED'>('NEW');
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmPosting, setConfirmPosting] = useState(false);
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<Product[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchError, setSearchError] = useState('');
  const [notebook, setNotebook] = useState('');
  const [showNotebook, setShowNotebook] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const newReceipt = useCallback(() => {
    setSupplierId(''); setInvoice(''); setDate(today()); setNotes('');
    setRows([]); setReceiptId(crypto.randomUUID());
    setSavedState('NEW'); setDirty(true); setConfirmPosting(false);
    setTerm(''); setMatches([]); setError(''); setSuccess('');
  }, []);
  useEffect(() => { newReceipt(); }, [orgId, newReceipt]);

  const refresh = useCallback(async () => {
    if (!orgId || isMockAuth) return;
    setLoading(true);
    try {
      const [supplierRows, receiptRows] = await Promise.all([
        suppliersService.getSuppliers(orgId, false), goodsReceivingService.list(orgId),
      ]);
      setSuppliers(supplierRows.filter((s) => s.isActive));
      setReceipts(receiptRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load suppliers and receiving history.');
    } finally { setLoading(false); }
  }, [orgId, isMockAuth]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !canReceive.allowed || isMockAuth || term.trim().length < 2) {
      setMatches([]); setSearchError(''); return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const result = await productsService.getProductsPaginated(
          orgId, { search: term.trim(), page: 1, pageSize: 8, isActive: true }, false,
        );
        if (active) { setMatches(result.data); setSearchError(''); }
      } catch (e) {
        if (active) {
          setMatches([]);
          setSearchError(e instanceof Error ? e.message : 'Product lookup failed.');
        }
      }
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [orgId, canReceive.allowed, isMockAuth, term]);

  const editable = !busy && !isMockAuth && canReceive.allowed && savedState !== 'POSTED';
  const markDirty = () => {
    setDirty(true); setConfirmPosting(false); setError(''); setSuccess('');
  };
  const addProduct = (product: Product) => {
    if (!editable) return;
    if (rows.some((row) => row.product.id === product.id)) {
      setError('That product is already in the worksheet. Edit its carton counts instead.');
      return;
    }
    if (rows.length >= 50) { setError('At most 50 different products per receipt.'); return; }
    setRows((prev) => [...prev, {
      product, packageText: '', looseUnits: '0',
      unitCost: Number(product.purchaseCost ?? 0).toFixed(2),
    }]);
    markDirty();
    setTerm(''); setMatches([]); setActiveIndex(0);
    searchRef.current?.focus();
  };
  const updateRow = (id: string, key: 'packageText' | 'looseUnits' | 'unitCost', value: string) => {
    setRows((prev) => prev.map((row) => row.product.id === id ? { ...row, [key]: value } : row));
    markDirty();
  };
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.product.id !== id));
    markDirty();
  };

  const calculated = rows.map((row) => {
    try { return { data: computeReceiptLine(row), error: '' }; }
    catch (e) { return { data: null, error: e instanceof Error ? e.message : 'Invalid quantity' }; }
  });
  const totalUnits = calculated.reduce((sum, x) => sum + (x.data?.totalUnits ?? 0), 0);
  const totalCost = calculated.reduce((sum, x) => sum + (x.data ? x.data.totalUnits * x.data.unitCost : 0), 0);
  const ready = Boolean(supplierId && invoice.trim() && date && rows.length &&
    calculated.every((x) => x.data) && editable);

  const runOnce = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setSuccess('');
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!ready) { setError('Choose a supplier, invoice number and valid product quantities first.'); return; }
    await runOnce(async () => {
      const payload = buildGoodsReceiptPayload(orgId, rows);
      await goodsReceivingService.saveDraft({
        organizationId: orgId, receiptId, supplierId, supplierInvoiceNumber: invoice.trim(),
        receivedOn: date, notes, lines: payload,
      });
      setSavedState('DRAFT'); setDirty(false); setConfirmPosting(false);
      setSuccess('Draft saved. Inventory has not changed.');
      await refresh();
    });
  };
  const post = async () => {
    if (!confirmPosting || dirty || savedState !== 'DRAFT' || !editable) return;
    await runOnce(async () => {
      const result = await goodsReceivingService.post(orgId, receiptId);
      setSavedState('POSTED'); setConfirmPosting(false); setDirty(false);
      setSuccess(result.idempotent_replay
        ? 'This goods receipt was already posted; stock was not added twice.'
        : 'Goods receipt posted. Stock movements were created exactly once.');
      await refresh();
    });
  };
  const loadDraft = async (receipt: GoodsReceiptRecord) => {
    if (busyRef.current || receipt.status !== 'DRAFT') return;
    await runOnce(async () => {
      const prepared: ReceiptWorksheetLine[] = [];
      for (const row of receipt.lines) {
        const result = await productsService.getProductsPaginated(
          orgId, { search: row.sku, page: 1, pageSize: 8, isActive: true }, false,
        );
        const product = result.data.find((p) => p.id === row.productId && p.organizationId === orgId);
        if (!product) throw new Error('A receipt product is inactive or unavailable: ' + row.sku);
        prepared.push({
          product, packageText: row.packageCounts.join(', '),
          looseUnits: String(row.looseUnits), unitCost: Number(row.unitCost).toFixed(2),
        });
      }
      setReceiptId(receipt.id); setSupplierId(receipt.supplierId);
      setInvoice(receipt.supplierInvoiceNumber); setDate(receipt.receivedOn);
      setNotes(receipt.notes); setRows(prepared);
      setSavedState('DRAFT'); setDirty(false); setConfirmPosting(false);
      setSuccess('Draft loaded for review. No stock has been posted.');
    });
  };

  const pasteNotebook = async () => {
    if (!editable) return;
    await runOnce(async () => {
      const parsed = parseReceivingNotebook(notebook);
      const imported: ReceiptWorksheetLine[] = [];
      for (const row of parsed) {
        const result = await productsService.getProductsPaginated(
          orgId, { search: row.sku, page: 1, pageSize: 8, isActive: true }, false,
        );
        const match = result.data.find((p) => p.sku.toLowerCase() === row.sku.toLowerCase());
        if (!match) throw new Error('SKU not found or inactive in this business: ' + row.sku);
        imported.push({
          product: match, packageText: row.packageText,
          looseUnits: row.looseUnits, unitCost: row.unitCost,
        });
      }
      const merged = [...rows, ...imported];
      buildGoodsReceiptPayload(orgId, merged);
      setRows(merged); markDirty(); setShowNotebook(false); setNotebook('');
      setSuccess(imported.length + ' rows imported; review them before saving.');
    });
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#142B4D] sm:text-2xl">
            <PackagePlus size={23} className="text-teal-700"/> Bulk Goods Receiving
          </h1>
          <p className="mt-1 text-sm text-slate-500">Notebook-style supplier stock intake · Draft first, post after review</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={newReceipt} disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            New receipt
          </button>
          <Link to="/inventory" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
            Stock Movements
          </Link>
        </div>
      </div>
      {isMockAuth && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Cloud-only first release: explore the worksheet in Demo Mode, but saving and posting are disabled. No fictional stock increases will be shown.
      </p>}
      {!canReceive.allowed && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">{canReceive.message || 'You cannot receive stock.'}</p>}
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4" aria-label="Goods receipt header">
        <div>
          <label htmlFor="grn-supplier" className="mb-1 block text-xs font-semibold">Supplier</label>
          <select id="grn-supplier" value={supplierId} disabled={!editable}
            onChange={(e) => { setSupplierId(e.target.value); markDirty(); }}
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">Select an existing supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.companyName || s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="grn-invoice" className="mb-1 block text-xs font-semibold">Supplier invoice / delivery reference</label>
          <input id="grn-invoice" value={invoice} maxLength={100} disabled={!editable}
            onChange={(e) => { setInvoice(e.target.value); markDirty(); }}
            placeholder="e.g. INV-2026-0042" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
        </div>
        <div>
          <label htmlFor="grn-date" className="mb-1 block text-xs font-semibold">Received on</label>
          <input id="grn-date" type="date" value={date} disabled={!editable}
            onChange={(e) => { setDate(e.target.value); markDirty(); }}
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
        </div>
        <div>
          <label htmlFor="grn-notes" className="mb-1 block text-xs font-semibold">Receiving notes (optional)</label>
          <input id="grn-notes" value={notes} maxLength={1000} disabled={!editable}
            onChange={(e) => { setNotes(e.target.value); markDirty(); }}
            placeholder="Truck, seal, or delivery notes" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Goods receipt worksheet">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-[#142B4D]">Receiving worksheet · {rows.length} items</h2>
          <button type="button" disabled={!editable} onClick={() => setShowNotebook((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-40">
            <Upload size={14}/> Paste notebook rows
          </button>
        </div>

        {showNotebook && <div className="space-y-2 border-b border-slate-200 bg-slate-50 p-4">
          <label htmlFor="grn-paste" className="block text-sm font-semibold">Paste TAB-separated rows: SKU / carton units / loose units / purchase rate</label>
          <p className="text-xs text-slate-600">Example: FERT-50 [Tab] 12,10,11 [Tab] 5 [Tab] 1120.00. Use 5x12 for five cartons with 12 units each.</p>
          <textarea id="grn-paste" rows={4} value={notebook} onChange={(e) => setNotebook(e.target.value)}
            placeholder={'SKU-001\t12,10,11\t5\t1120.00'} className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"/>
          <button type="button" disabled={!editable} onClick={() => void pasteNotebook()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Import and validate rows</button>
        </div>}

        <div className="space-y-2 border-b border-slate-200 p-4">
          <label htmlFor="grn-search" className="block text-xs font-semibold">Add product by name, SKU, brand or HSN</label>
          <div className="relative max-w-2xl">
            <Search size={17} className="absolute left-3 top-3 text-slate-400"/>
            <input id="grn-search" ref={searchRef} value={term} disabled={!editable}
              onChange={(e) => { setTerm(e.target.value); setActiveIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((n) => Math.min(n + 1, matches.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((n) => Math.max(0, n - 1)); }
                if (e.key === 'Enter' && matches.length) { e.preventDefault(); addProduct(matches[activeIndex] || matches[0]); }
                if (e.key === 'Escape') { setTerm(''); setMatches([]); }
              }}
              placeholder="Type at least 2 characters; ↑ ↓ Enter to add"
              className="h-11 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"/>
          </div>
          {searchError && <p role="alert" className="text-xs text-rose-700">{searchError}</p>}
          {matches.length > 0 && <div className="max-h-44 max-w-2xl divide-y overflow-auto rounded-lg border border-slate-200" aria-label="Receiving product matches">
            {matches.map((p, i) => <button type="button" key={p.id} disabled={!editable}
              onClick={() => addProduct(p)}
              className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-teal-50 ' + (i === activeIndex ? 'bg-teal-50' : '')}>
              <span><strong>{p.name}</strong><span className="ml-2 text-xs text-slate-500">{p.sku} · {p.uom}</span></span>
              <span className="text-xs text-slate-500">Stock {p.currentStock ?? '—'} · <Plus size={13} className="inline"/></span>
            </button>)}
          </div>}
        </div>

        <div className="w-full max-w-full overflow-x-auto" role="region" tabIndex={0} aria-label="Receiving line-item grid">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                {['Sl.','Product / SKU','Carton unit counts (variable)','Loose units','Total units','Unit','Purchase rate','Line value','Remove'].map((h) =>
                  <th key={h} scope="col" className="px-3 py-3 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const calc = calculated[i];
                return <tr key={row.product.id} className="align-top">
                  <td className="px-3 py-4 font-semibold">{i + 1}</td>
                  <td className="min-w-[155px] px-3 py-3">
                    <strong>{row.product.name}</strong><p className="text-slate-500">{row.product.sku}</p>
                  </td>
                  <td className="min-w-[225px] px-3 py-2">
                    <input aria-label={'Carton units for ' + row.product.name} value={row.packageText}
                      onChange={(e) => updateRow(row.product.id,'packageText',e.target.value)}
                      disabled={!editable} placeholder="12, 10, 11 or 5x12"
                      className="h-10 w-full rounded-lg border border-slate-300 px-2 font-mono text-sm"/>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {calc.data ? calc.data.packageCounts.length + ' cartons' : calc.error}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input aria-label={'Loose units for ' + row.product.name} value={row.looseUnits}
                      onChange={(e) => updateRow(row.product.id,'looseUnits',e.target.value)}
                      disabled={!editable} inputMode="numeric"
                      className="h-10 w-24 rounded-lg border border-slate-300 px-2 text-right"/>
                  </td>
                  <td className="px-3 py-3 font-bold tabular-nums text-teal-800">{calc.data?.totalUnits ?? '—'}</td>
                  <td className="px-3 py-3">{row.product.uom}</td>
                  <td className="px-3 py-2">
                    <input aria-label={'Purchase rate for ' + row.product.name} value={row.unitCost}
                      onChange={(e) => updateRow(row.product.id,'unitCost',e.target.value)}
                      disabled={!editable} inputMode="decimal"
                      className="h-10 w-28 rounded-lg border border-slate-300 px-2 text-right"/>
                  </td>
                  <td className="px-3 py-3 font-semibold tabular-nums">{calc.data ? currency(calc.data.totalUnits * calc.data.unitCost) : '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" disabled={!editable} onClick={() => removeRow(row.product.id)}
                      aria-label={'Remove ' + row.product.name}
                      className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 size={16}/></button>
                  </td>
                </tr>;
              })}
              {!rows.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">Find an item above, or paste notebook rows to start receiving.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
          <span className="text-slate-500">Carton sizes are entered explicitly—no fixed units-per-case assumption.</span>
          <div className="text-right"><strong>{totalUnits.toLocaleString('en-IN')} units</strong><span className="ml-3 text-slate-600">Estimated purchase value {currency(totalCost)}</span></div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-teal-700"/> Receiving safeguards</h2>
          <p className="text-xs leading-5 text-slate-600">
            Saving a draft never increases stock. Posting is a separate, permission-checked operation and produces one
            GOODS_RECEIVED movement per product. Purchase rates are saved as receipt snapshots; they do not automatically
            replace selling prices, master purchase costs or accounting valuations.
          </p>
          <p className="text-xs text-slate-500">Duplicate supplier invoice numbers are rejected. Your receipt has a stable ID for safe retry after a network interruption.</p>
          <p className="text-xs text-slate-500">Receipt state: <strong>{savedState}{dirty ? ' · Unsaved changes' : ''}</strong></p>
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <button type="button" disabled={!ready || busy} onClick={() => void save()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40">
            <ClipboardList size={16}/> {busy ? 'Working…' : 'Save receiving draft'}
          </button>
          {savedState === 'DRAFT' && !dirty && <div>
            {!confirmPosting ? (
              <button type="button" disabled={busy || !editable} onClick={() => setConfirmPosting(true)}
                className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
                Review & post stock
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Confirm: add {totalUnits} units to stock for {rows.length} products? This is permanent.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void post()} disabled={busy}
                    className="flex-1 rounded-lg bg-[#142B4D] px-3 py-2 text-xs font-bold text-white">Confirm posting</button>
                  <button type="button" onClick={() => setConfirmPosting(false)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Cancel</button>
                </div>
              </div>
            )}
          </div>}
          {savedState === 'POSTED' && <p role="status" className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16}/> Posted and immutable</p>}
        </div>
      </section>

      <section aria-label="Recent goods receipts" className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#142B4D]">Recent goods receipts</h2>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="text-xs font-semibold text-teal-700">Refresh</button>
        </div>
        {loading && <p role="status" className="text-xs text-slate-500">Loading receipts…</p>}
        {!loading && !receipts.length && <p className="text-xs text-slate-500">No receipts have been recorded yet.</p>}
        <div className="divide-y divide-slate-100">
          {receipts.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <strong className="block truncate">{r.supplierInvoiceNumber}</strong>
              <span className="text-xs text-slate-500">{r.receivedOn} · {r.lines.length} products · {r.status}</span>
            </div>
            {r.status === 'DRAFT' ? (
              <button type="button" disabled={busy || isMockAuth || !canReceive.allowed}
                onClick={() => void loadDraft(r)}
                className="rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50">Load draft</button>
            ) : <span className="text-xs font-semibold text-emerald-700">Posted</span>}
          </div>)}
        </div>
      </section>
    </div>
  );
};
