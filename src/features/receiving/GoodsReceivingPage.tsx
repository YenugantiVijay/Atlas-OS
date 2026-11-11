import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, PackagePlus, Plus, Search, Trash2, Upload, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { ReceivingNewProductDialog } from './ReceivingNewProductDialog';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import type { Product, Supplier } from '@/types';
import { productsService } from '@/services/products.service';
import { suppliersService } from '@/services/suppliers.service';
import { goodsReceivingService, type GoodsReceiptRecord } from '@/services/goods-receiving.service';
import { supplierPriceHistoryService, type SupplierPriceEntry } from '@/services/supplier-price-history.service';
import { parseSupplierRate, supplierRateChange } from '@/features/pricing/supplier-rate-utils';
import {
  buildGoodsReceiptPayload, computeReceiptLine, parseReceivingNotebook,
  readUniformCartons, writeUniformCartons, parsePackageCounts,
  type ReceiptWorksheetLine,
} from './receiving-worksheet';
import {
  receivingWorkspaceKey, readReceivingWorkspace, saveReceivingWorkspace,
  clearReceivingWorkspace, readReceivingLists, cacheReceivingLists, clearReceivingLists,
} from './receiving-workspace';

const today = () => new Date().toISOString().slice(0, 10);
const currency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

/**
 * Cloud-only supplier goods receipt. This is an operator worksheet, not a stock
 * adjustment loophole. The only stock-writing path is post_goods_receipt RPC.
 */
export const GoodsReceivingPage: React.FC = () => {
  const { currentOrg, currentUser, isMockAuth } = useOrg();
  const userId = currentUser?.id || '';
  const { check } = useActionPermission();
  const orgId = currentOrg?.id || '';
  const workspaceKey = receivingWorkspaceKey(userId, orgId);
  const activeOrgRef = useRef(orgId);
  activeOrgRef.current = orgId;
  const canReceive = check('inventory:receive');
  const canCreateProduct = check('products:create');
  const canReadSupplierRates = check('supplier-prices:read').allowed;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceiptRecord[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ReceiptWorksheetLine[]>([]);
  const [priorRates, setPriorRates] = useState<{
    key: string;
    entries: Record<string, Pick<SupplierPriceEntry, 'unitCost' | 'effectiveOn' | 'sourceType'>>;
    error: boolean;
  }>({ key: '', entries: {}, error: false });
  const [mixedRows, setMixedRows] = useState<Set<string>>(() => new Set());
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [receiptId, setReceiptId] = useState<string>(() => crypto.randomUUID());
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
  const [hydratedKey, setHydratedKey] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const newReceipt = useCallback(() => {
    clearReceivingWorkspace(userId, orgId);
    setSupplierId(''); setInvoice(''); setDate(today()); setNotes('');
    setRows([]); setMixedRows(new Set()); setShowCreateProduct(false);
    setReceiptId(crypto.randomUUID());
    setSavedState('NEW'); setDirty(true); setConfirmPosting(false);
    setTerm(''); setMatches([]); setError(''); setSuccess('');
  }, [userId, orgId]);

  // Hydrate by *both* Supabase user and organization; never overwrite another
  // operator's unsaved worksheet. A tab or route change does not discard input.
  useEffect(() => {
    const restored = readReceivingWorkspace(userId, orgId);
    setSupplierId(restored?.supplierId || '');
    setInvoice(restored?.invoice || '');
    setDate(restored?.date || today());
    setNotes(restored?.notes || '');
    setRows(restored?.rows || []);
    setMixedRows(new Set(restored?.mixedRows || []));
    setReceiptId(restored?.receiptId || crypto.randomUUID());
    setSavedState(restored?.savedState || 'NEW');
    setDirty(restored?.dirty ?? true);
    setNotebook(restored?.notebook || '');
    setShowNotebook(restored?.showNotebook || false);
    setShowCreateProduct(false);
    setConfirmPosting(false);
    setTerm(''); setMatches([]); setError('');
    setSuccess(restored && (restored.rows.length || restored.invoice || restored.supplierId)
      ? 'Your unfinished receiving worksheet has been restored from this tab. Nothing was posted.'
      : '');
    const cached = readReceivingLists(userId, orgId, true);
    setSuppliers(cached?.suppliers || []);
    setReceipts(cached?.receipts || []);
    setLoading(false);
    setHydratedKey(workspaceKey);
  }, [workspaceKey, orgId, userId]);

  // Persist immediately after each edit. This is local-only scratchpad data:
  // it never posts a receipt or touches the authoritative stock ledger.
  useEffect(() => {
    if (!workspaceKey || hydratedKey !== workspaceKey) return;
    if (savedState === 'POSTED') {
      clearReceivingWorkspace(userId, orgId);
      return;
    }
    saveReceivingWorkspace(userId, orgId, {
      supplierId, invoice, date, notes, rows, mixedRows: [...mixedRows],
      receiptId, savedState, dirty, notebook, showNotebook,
    });
  }, [workspaceKey, hydratedKey, userId, orgId, supplierId, invoice, date, notes,
    rows, mixedRows, receiptId, savedState, dirty, notebook, showNotebook]);

  // Restore a product whose server request completed while another route was open.
  useEffect(() => {
    const onLateProduct = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; orgId: string; receiptId: string }>).detail;
      if (detail?.userId !== userId || detail.orgId !== orgId || detail.receiptId !== receiptId) return;
      const next = readReceivingWorkspace(userId, orgId);
      if (next && next.receiptId === receiptId) {
        setRows(next.rows);
        setMixedRows(new Set(next.mixedRows));
        setDirty(true);
        setSuccess('New product confirmed and added to your restored worksheet.');
      }
    };
    window.addEventListener('atlas:receiving:restored', onLateProduct);
    return () => window.removeEventListener('atlas:receiving:restored', onLateProduct);
  }, [userId, orgId, receiptId]);

  const refresh = useCallback(async (force = false) => {
    if (!orgId || isMockAuth) return;
    const fresh = readReceivingLists(userId, orgId);
    if (fresh && !force) {
      setSuppliers(fresh.suppliers);
      setReceipts(fresh.receipts);
      return; // no duplicate call on quick page switches
    }
    const stale = readReceivingLists(userId, orgId, true);
    if (stale) {
      // Display last known lists without blocking the worksheet, then revalidate.
      setSuppliers(stale.suppliers);
      setReceipts(stale.receipts);
    } else {
      setLoading(true);
    }
    try {
      const [supplierRows, receiptRows] = await Promise.all([
        suppliersService.getSuppliers(orgId, false), goodsReceivingService.list(orgId),
      ]);
      if (activeOrgRef.current !== orgId) return;
      const activeSuppliers = supplierRows.filter((supplier) => supplier.isActive);
      cacheReceivingLists(userId, orgId, activeSuppliers, receiptRows);
      setSuppliers(activeSuppliers);
      setReceipts(receiptRows);
    } catch (e) {
      if (activeOrgRef.current === orgId) {
        setError(e instanceof Error ? e.message : 'Unable to load suppliers and receiving history.');
      }
    } finally { if (activeOrgRef.current === orgId) setLoading(false); }
  }, [orgId, userId, isMockAuth]);
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

  // Exact supplier and product comparisons as of the receipt date.
  // Missing history is unknown, never a zero-valued price.
  const rateProductIds = rows.map((r) => r.product.id).join(',');
  const rateLookupKey = JSON.stringify([orgId, supplierId, date, rateProductIds]);
  useEffect(() => {
    let active = true;
    if (!orgId || !supplierId || !date || !rateProductIds || !canReadSupplierRates || isMockAuth) {
      setPriorRates({ key: '', entries: {}, error: false });
      return;
    }
    const selectedIds = rateProductIds.split(',');
    const timer = window.setTimeout(async () => {
      try {
        const entries: Record<string, Pick<SupplierPriceEntry, 'unitCost' | 'effectiveOn' | 'sourceType'>> = {};
        for (let offset = 0; offset < selectedIds.length; offset += 5) {
          const batch = await Promise.all(selectedIds.slice(offset, offset + 5).map(async (productId) => {
            const history = await supplierPriceHistoryService.list(orgId, {
              supplierId, productId, asOf: date, limit: 1,
            });
            return { productId, latest: history[0] };
          }));
          if (!active) return;
          for (const item of batch) {
            if (item.latest) entries[item.productId] = item.latest;
          }
        }
        if (active) setPriorRates({ key: rateLookupKey, entries, error: false });
      } catch {
        if (active) setPriorRates({ key: rateLookupKey, entries: {}, error: true });
      }
    }, 240);
    return () => { active = false; window.clearTimeout(timer); };
  // The key only changes on supplier/date/product-ID changes, not editing quantities.
  }, [rateLookupKey, rateProductIds, orgId, supplierId, date, canReadSupplierRates, isMockAuth]);

  const visiblePriorRates = priorRates.key === rateLookupKey ? priorRates.entries : {};
  const priorRatesUnavailable = priorRates.key === rateLookupKey && priorRates.error;
  const editable = !busy && !isMockAuth && canReceive.allowed && savedState !== 'POSTED';
  const canQuickCreate = editable && canCreateProduct.allowed && rows.length < 50;
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
    // Keep keyboard-driven intake fast: immediately start entering cases.
    window.setTimeout(() => document.getElementById('grn-cases-' + product.id)?.focus(), 0);
  };
  const updateRow = (id: string, key: 'packageText' | 'looseUnits' | 'unitCost', value: string) => {
    setRows((prev) => prev.map((row) => row.product.id === id ? { ...row, [key]: value } : row));
    markDirty();
  };
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.product.id !== id));
    setMixedRows((prev) => { const next = new Set(prev); next.delete(id); return next; });
    markDirty();
  };
  const updateUniform = (id: string, field: 'cases' | 'unitsPerCase', value: string) => {
    const row = rows.find((item) => item.product.id === id);
    if (!row) return;
    const current = readUniformCartons(row.packageText);
    if (!current.isUniform) return;
    const nextCases = field === 'cases' ? value : current.cases;
    const nextUnits = field === 'unitsPerCase' ? value : current.unitsPerCase;
    // Keep partial edits (e.g. "10x") in the UI but never save invalid rows.
    if (!/^\d*$/.test(value)) return;
    updateRow(id, 'packageText', writeUniformCartons(nextCases, nextUnits));
  };
  const changeCartonMode = (id: string, mixed: boolean) => {
    if (mixed) {
      const current = rows.find((row) => row.product.id === id);
      let expanded = '';
      try { expanded = current ? parsePackageCounts(current.packageText).join(', ') : ''; }
      catch { expanded = ''; }
      setMixedRows((prev) => new Set(prev).add(id));
      updateRow(id, 'packageText', expanded);
    } else {
      setMixedRows((prev) => { const next = new Set(prev); next.delete(id); return next; });
      updateRow(id, 'packageText', '');
    }
  };

  const calculated = rows.map((row) => {
    try { return { data: computeReceiptLine(row), error: '' }; }
    catch (e) { return { data: null, error: e instanceof Error ? e.message : 'Invalid quantity' }; }
  });
  const totalUnits = calculated.reduce((sum, x) => sum + (x.data?.totalUnits ?? 0), 0);
  const totalCost = calculated.reduce((sum, x) => sum + (x.data ? x.data.totalUnits * x.data.unitCost : 0), 0);
  const ready = Boolean(supplierId && invoice.trim() && date && rows.length &&
    calculated.every((x) => x.data) && editable);
  const hasLocalDraft = Boolean(userId && (rows.length || invoice.trim() || supplierId || notebook));

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
      if (activeOrgRef.current !== orgId) return;
      setSavedState('DRAFT'); setDirty(false); setConfirmPosting(false);
      setSuccess('Draft saved. Inventory has not changed.');
      clearReceivingLists(userId, orgId);
      await refresh(true);
    });
  };
  const post = async () => {
    if (!confirmPosting || dirty || savedState !== 'DRAFT' || !editable) return;
    await runOnce(async () => {
      const result = await goodsReceivingService.post(orgId, receiptId);
      if (activeOrgRef.current !== orgId) return;
      setSavedState('POSTED'); setConfirmPosting(false); setDirty(false);
      setSuccess(result.idempotent_replay
        ? 'This goods receipt was already posted; stock was not added twice.'
        : 'Goods receipt posted. Stock movements were created exactly once.');
      clearReceivingWorkspace(userId, orgId);
      clearReceivingLists(userId, orgId);
      await refresh(true);
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
      if (activeOrgRef.current !== orgId) return;
      setReceiptId(receipt.id); setSupplierId(receipt.supplierId);
      setInvoice(receipt.supplierInvoiceNumber); setDate(receipt.receivedOn);
      setNotes(receipt.notes); setRows(prepared);
      setMixedRows(new Set(prepared.filter((r) => !readUniformCartons(r.packageText).isUniform).map((r) => r.product.id)));
      setSavedState('DRAFT'); setDirty(false); setConfirmPosting(false);
      setSuccess('Draft loaded for review. No stock has been posted.');
    });
  };

  const pasteNotebook = async () => {
    if (!editable) return;
    await runOnce(async () => {
      const parsed = parseReceivingNotebook(notebook);
      const imported: ReceiptWorksheetLine[] = [];
      for (let offset = 0; offset < parsed.length; offset += 5) {
        const batch = await Promise.all(parsed.slice(offset, offset + 5).map(async (row) => {
          const result = await productsService.getProductsPaginated(
            orgId, { search: row.sku, page: 1, pageSize: 100, isActive: true }, false,
          );
          const skuMatch = result.data.find((p) => p.sku.toLowerCase() === row.sku.toLowerCase());
          const nameMatches = result.data.filter((p) => p.name.toLowerCase() === row.sku.toLowerCase());
          const match = skuMatch || (nameMatches.length === 1 && result.totalCount <= 100 ? nameMatches[0] : null);
          if (!match) throw new Error('Product not found or name ambiguous: ' + row.sku +
            '. Use an exact SKU, or create the product using New product first.');
          return { product: match, packageText: row.packageText,
            looseUnits: row.looseUnits, unitCost: row.unitCost };
        }));
        imported.push(...batch);
      }
      if (activeOrgRef.current !== orgId) return;
      const merged = [...rows, ...imported];
      buildGoodsReceiptPayload(orgId, merged);
      setRows(merged);
      setMixedRows((prev) => new Set([...prev, ...imported.filter((r) => !readUniformCartons(r.packageText).isUniform).map((r) => r.product.id)]));
      markDirty(); setShowNotebook(false); setNotebook('');
      setSuccess(imported.length + ' rows imported; review them before saving.');
    });
  };

  return (
    <div className="space-y-4 pb-8">
      {showCreateProduct && canQuickCreate && (
        <ReceivingNewProductDialog
          organizationId={orgId} userId={userId} receiptId={receiptId} suggestedName={term}
          onClose={() => setShowCreateProduct(false)}
          onCreated={(product) => {
            if (activeOrgRef.current !== orgId) return;
            addProduct(product);
            setShowCreateProduct(false);
            setSuccess('Product created with zero opening stock and added to this receipt. Enter quantities, save the draft and post to add inventory.');
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#142B4D] sm:text-2xl">
            <PackagePlus size={23} className="text-teal-700"/> Bulk Goods Receiving
          </h1>
          <p className="mt-1 text-sm text-slate-500">Notebook-style supplier stock intake · Draft first, post after review</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/supplier-prices" className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50">
            Supplier Prices
          </Link>
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
          <label htmlFor="grn-paste" className="block text-sm font-semibold">Paste from Excel or Notepad — SKU or exact name, cases, loose units and purchase rate</label>
          <p className="text-xs text-slate-600">Five columns: Product / Cases / Units per case / Loose / Purchase rate. Or four columns: Product / Mixed carton counts / Loose / Purchase rate. Use TAB between columns, optional header, and up to 50 products. Unknown products must first be created with New product.</p>
          <textarea id="grn-paste" rows={4} value={notebook} onChange={(e) => setNotebook(e.target.value)}
            placeholder={'SKU-001\t12,10,11\t5\t1120.00'} className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"/>
          <button type="button" disabled={!editable} onClick={() => void pasteNotebook()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Import and validate rows</button>
        </div>}

        <div className="space-y-2 border-b border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="grn-search" className="block text-xs font-semibold">Add product by name, SKU, brand or HSN</label>
            <button type="button" disabled={!canQuickCreate}
              onClick={() => setShowCreateProduct(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-40">
              <Plus size={14}/> New product
            </button>
          </div>
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
          <p className="text-xs text-slate-500">Suggestions show live stock and current catalog selling price. If an item is new, create it here without leaving this receipt.</p>
          {searchError && <p role="alert" className="text-xs text-rose-700">{searchError}</p>}
          {matches.length > 0 && <div className="max-h-44 max-w-2xl divide-y overflow-auto rounded-lg border border-slate-200" aria-label="Receiving product matches">
            {matches.map((p, i) => <button type="button" key={p.id} disabled={!editable}
              onClick={() => addProduct(p)}
              className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-teal-50 ' + (i === activeIndex ? 'bg-teal-50' : '')}>
              <span><strong>{p.name}</strong><span className="ml-2 text-xs text-slate-500">{p.sku} · {p.uom}</span></span>
              <span className="flex flex-col items-end gap-0.5 text-xs text-slate-600">
                <span>Available: {p.currentStock === undefined ? '—' : p.currentStock.toLocaleString('en-IN')} {p.uom}</span>
                <span className="font-semibold text-teal-700">Selling: {currency(p.sellingPrice)}</span>
              </span>
            </button>)}
          </div>}
        </div>

        <div className="w-full max-w-full overflow-x-auto" role="region" tabIndex={0} aria-label="Receiving line-item grid">
          <table className="w-full min-w-[1270px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                {['Sl.','Product / SKU','Cases','Units/case','Variable cartons','Loose units','Total units','Unit','Purchase rate','Line value','Remove'].map((h) =>
                  <th key={h} scope="col" className="px-3 py-3 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const calc = calculated[i];
                const baseline = visiblePriorRates[row.product.id];
                let enteredRate: number | null = null;
                try { enteredRate = parseSupplierRate(row.unitCost); }
                catch { /* Incomplete or invalid rates never generate a comparison. */ }
                const rateDelta = baseline && enteredRate !== null
                  ? supplierRateChange(baseline.unitCost, enteredRate) : null;
                const uniform = readUniformCartons(row.packageText);
                const mixed = mixedRows.has(row.product.id) || !uniform.isUniform;
                return <tr key={row.product.id} className="align-top">
                  <td className="px-3 py-4 font-semibold">{i + 1}</td>
                  <td className="min-w-[155px] px-3 py-3">
                    <strong>{row.product.name}</strong><p className="text-slate-500">{row.product.sku}</p>
                  </td>
                  <td className="px-3 py-2">
                    <input id={'grn-cases-' + row.product.id} aria-label={'Cases for ' + row.product.name}
                      value={mixed ? '' : uniform.cases} disabled={!editable || mixed} inputMode="numeric"
                      onChange={(e) => updateUniform(row.product.id, 'cases', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('grn-units-' + row.product.id)?.focus(); } }}
                      placeholder="e.g. 10"
                      className="h-10 w-20 rounded-lg border border-slate-300 px-2 text-right disabled:bg-slate-50"/>
                  </td>
                  <td className="px-3 py-2">
                    <input id={'grn-units-' + row.product.id} aria-label={'Units per case for ' + row.product.name}
                      value={mixed ? '' : uniform.unitsPerCase} disabled={!editable || mixed} inputMode="numeric"
                      onChange={(e) => updateUniform(row.product.id, 'unitsPerCase', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('grn-loose-' + row.product.id)?.focus(); } }}
                      placeholder="e.g. 12"
                      className="h-10 w-24 rounded-lg border border-slate-300 px-2 text-right disabled:bg-slate-50"/>
                  </td>
                  <td className="min-w-[170px] px-3 py-2">
                    {mixed ? (
                      <input aria-label={'Variable cartons for ' + row.product.name}
                        value={row.packageText} disabled={!editable}
                        onChange={(e) => updateRow(row.product.id, 'packageText', e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('grn-loose-' + row.product.id)?.focus(); } }}
                        placeholder="12, 10, 11"
                        className="h-10 w-full rounded-lg border border-slate-300 px-2 font-mono text-sm"/>
                    ) : <span className="block py-2 text-[11px] text-slate-500">Same size cartons</span>}
                    <button type="button" disabled={!editable} onClick={() => changeCartonMode(row.product.id, !mixed)}
                      className="mt-1 block text-[11px] font-semibold text-teal-700 disabled:opacity-40">
                      {mixed ? 'Switch to cases × units (clears mixed counts)' : 'Different carton sizes?'}
                    </button>
                    <span className="block text-[11px] text-slate-500">
                      {calc.data ? calc.data.packageCounts.length + ' cartons' : calc.error}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input id={'grn-loose-' + row.product.id} aria-label={'Loose units for ' + row.product.name} value={row.looseUnits}
                      onChange={(e) => updateRow(row.product.id,'looseUnits',e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('grn-rate-' + row.product.id)?.focus(); } }}
                      disabled={!editable} inputMode="numeric"
                      className="h-10 w-24 rounded-lg border border-slate-300 px-2 text-right"/>
                  </td>
                  <td className="px-3 py-3 font-bold tabular-nums text-teal-800">{calc.data?.totalUnits ?? '—'}</td>
                  <td className="px-3 py-3">{row.product.uom}</td>
                  <td className="px-3 py-2">
                    <input id={'grn-rate-' + row.product.id} aria-label={'Purchase rate for ' + row.product.name} value={row.unitCost}
                      onChange={(e) => updateRow(row.product.id,'unitCost',e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); } }}
                      disabled={!editable} inputMode="decimal"
                      className="h-10 w-28 rounded-lg border border-slate-300 px-2 text-right"/>
                    {baseline && <p className="mt-1 min-w-[130px] text-[11px] text-slate-600">
                      Last supplier: {currency(baseline.unitCost)} ({baseline.effectiveOn})
                    </p>}
                    {rateDelta?.percent !== null && rateDelta?.percent !== undefined &&
                      <p className={'mt-0.5 text-[11px] font-semibold ' +
                        (rateDelta.significant ? 'text-amber-800' : 'text-slate-500')}>
                        {rateDelta.percent > 0 ? '+' : ''}{rateDelta.percent.toFixed(1)}%
                        {rateDelta.significant ? ' · Review rate change' : ' change'}
                      </p>}
                  </td>
                  <td className="px-3 py-3 font-semibold tabular-nums">{calc.data ? currency(calc.data.totalUnits * calc.data.unitCost) : '—'}</td>
                  <td className="px-3 py-2">
                    <button type="button" disabled={!editable} onClick={() => removeRow(row.product.id)}
                      aria-label={'Remove ' + row.product.name}
                      className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 size={16}/></button>
                  </td>
                </tr>;
              })}
              {!rows.length && <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">Find an item above, or paste notebook rows to start receiving.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
          <div className="text-slate-500">
            <span>Use Cases × Units/case for uniform cartons, or variable counts such as 12,10,11. No assumed pack size.</span>
            {priorRatesUnavailable && <p role="status" className="mt-1 text-amber-800">Supplier price comparison unavailable; review the rate history manually. Receipt saving remains available.</p>}
            {!priorRatesUnavailable && supplierId && rows.length > 0 && <p className="mt-1">Rate comparisons are advisory. They never change catalog prices or stock until posting.</p>}
          </div>
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
          {hasLocalDraft && savedState !== 'POSTED' &&
            <p role="status" className="text-xs font-medium text-teal-700">
              Saved in this tab · You can change pages and return without losing these entries.
            </p>}
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
          <button type="button" onClick={() => void refresh(true)} disabled={loading} className="text-xs font-semibold text-teal-700">Refresh</button>
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
