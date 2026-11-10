import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ShoppingCart, ArrowRight, CheckCircle2, Keyboard, FileClock, UserRound, ShieldCheck } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { searchCustomerDirectory, type CustomerDirectorySearchResult } from '@/services/customer-directory-search.service';
import { ordersService } from '@/services/orders.service';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import type { Product } from '@/types';
import { buildPosOrderDraft, summarizePosCart, type PosCartLine } from './pos-draft';
import { PosBillingGrid } from './PosBillingGrid';

type DirectoryEntry = Pick<CustomerDirectorySearchResult, 'id' | 'name' | 'companyName' | 'phone'>;

export const RetailPosPage: React.FC = () => {
  const { currentOrg, currentUser, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const navigate = useNavigate();
  const organizationId = currentOrg?.id;
  const identity = `${organizationId || ''}:${currentUser?.id || 'demo'}:${isMockAuth}`;

  const [productTerm, setProductTerm] = useState('');
  const [productResponse, setProductResponse] = useState<{ key: string; rows: Product[] }>({ key: '', rows: [] });
  const [productError, setProductError] = useState('');
  const [customerTerm, setCustomerTerm] = useState('');
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [activeCustomerIndex, setActiveCustomerIndex] = useState(0);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [customerResponse, setCustomerResponse] = useState<{ key: string; rows: DirectoryEntry[] }>({ key: '', rows: [] });
  const [customerError, setCustomerError] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<{ identity: string; customer: DirectoryEntry } | null>(null);
  const [cart, setCart] = useState<{ identity: string; lines: PosCartLine[] }>({ identity: '', lines: [] });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedOrder, setSavedOrder] = useState<{ identity: string; number: string } | null>(null);
  const busyRef = useRef(false);
  const idempotencyRef = useRef('');
  const identityRef = useRef(identity);
  identityRef.current = identity;

  // F2 is an operator shortcut even when focus is on the page body rather than
  // inside the worksheet; never intercept Ctrl/Alt/Meta combinations.
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F2' && !event.defaultPrevented &&
          !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        productInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  const productKey = `${identity}:${productTerm.trim()}`;
  const customerKey = `${identity}:${customerTerm.trim()}`;
  const products = productResponse.key === productKey ? productResponse.rows : [];
  const customers = customerResponse.key === customerKey && !selectedCustomer ? customerResponse.rows : [];
  const lines = useMemo(() => (cart.identity === identity ? cart.lines : []), [cart, identity]);
  const customer = selectedCustomer?.identity === identity ? selectedCustomer.customer : null;
  const completed = savedOrder?.identity === identity ? savedOrder : null;
  const permission = check('orders:create');

  useEffect(() => {
    idempotencyRef.current = '';
    setCart({ identity, lines: [] });
    setSelectedCustomer(null);
    setSavedOrder(null);
    setProductTerm('');
    setCustomerTerm('');
    setActiveProductIndex(0);
    setActiveCustomerIndex(0);
    setNotes('');
    setSaveError('');
  }, [identity]);

  useEffect(() => {
    let active = true;
    setProductError('');
    const term = productTerm.trim();
    if (!organizationId || term.length < 2 || term.length > 100) return;
    const timer = window.setTimeout(() => {
      productsService.getProductsPaginated(organizationId, {
        search: term, page: 1, pageSize: 8, isActive: true,
      }, isMockAuth).then((result) => {
        if (active) setProductResponse({ key: productKey, rows: result.data });
      }).catch(() => {
        if (active) setProductError('Product search unavailable. Try again.');
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [organizationId, isMockAuth, productTerm, productKey]);

  useEffect(() => {
    let active = true;
    setCustomerError('');
    const term = customerTerm.trim();
    if (!organizationId || term.length < 2 || term.length > 100) return;
    const timer = window.setTimeout(() => {
      const promise: Promise<DirectoryEntry[]> = isMockAuth
        ? customersService.getCustomersPaginated(organizationId, {
            search: term, page: 1, pageSize: 5, isActive: true,
          }, true).then((res) => res.data)
        : searchCustomerDirectory(organizationId, term, 5);
      promise.then((rows) => {
        if (active) setCustomerResponse({ key: customerKey, rows });
      }).catch(() => {
        if (active) setCustomerError('Customer search unavailable. Try again.');
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [organizationId, isMockAuth, customerTerm, customerKey]);

  const totals = useMemo(() => {
    try { return { value: summarizePosCart(lines), error: '' }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : 'Invalid cart' }; }
  }, [lines]);

  const updateLines = (next: PosCartLine[]) => {
    if (busyRef.current) return;
    idempotencyRef.current = '';
    setSavedOrder(null);
    setSaveError('');
    setCart({ identity, lines: next });
  };

  const addProduct = (product: Product) => {
    if (busyRef.current || !permission.allowed || !product.isActive || product.organizationId !== organizationId) return;
    const old = lines.find((item) => item.product.id === product.id);
    if (old) {
      if (old.quantity >= 1000000) {
        setSaveError('Maximum quantity per line is 1,000,000.');
        return;
      }
      updateLines(lines.map((item) => item.product.id === product.id
        ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      if (lines.length >= 50) {
        setSaveError('A draft order can contain at most 50 product lines.');
        return;
      }
      updateLines([...lines, { product, quantity: 1, discountPercent: 0 }]);
    }
    setProductTerm('');
    setActiveProductIndex(0);
    productInputRef.current?.focus();
  };

  const chooseCustomer = (entry: DirectoryEntry) => {
    if (busyRef.current) return;
    idempotencyRef.current = '';
    setSelectedCustomer({ identity, customer: entry });
    setCustomerTerm(entry.companyName || entry.name);
    setActiveCustomerIndex(0);
    setSavedOrder(null);
    setSaveError('');
  };

  const saveOrder = async () => {
    if (busyRef.current || !organizationId) return;
    const allowed = check('orders:create');
    if (!allowed.allowed) {
      setSaveError(allowed.message || 'You cannot create sales orders.');
      return;
    }
    if (!customer) {
      setSaveError('Choose a customer before saving.');
      return;
    }
    if (!idempotencyRef.current) {
      if (!globalThis.crypto?.randomUUID) {
        setSaveError('Secure order request ID is unavailable. Use an up-to-date browser.');
        return;
      }
      idempotencyRef.current = globalThis.crypto.randomUUID();
    }

    let input;
    try {
      input = buildPosOrderDraft({
        organizationId,
        customerId: customer.id,
        orderDate: getBusinessDate(),
        notes,
        idempotencyKey: idempotencyRef.current,
        lines,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Invalid cart.');
      return;
    }

    busyRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      // The directory search intentionally does not expose customer credit data.
      // Revalidate active/tenant status before calling the authoritative order RPC.
      const activeCustomer = await customersService.getCustomerById(organizationId, customer.id, isMockAuth);
      if (!activeCustomer || !activeCustomer.isActive || activeCustomer.organizationId !== organizationId) {
        throw new Error('The selected customer is no longer active in this business.');
      }
      const order = await ordersService.createSalesOrder(organizationId, input, isMockAuth);
      if (identityRef.current !== identity) return;
      setSavedOrder({ identity, number: order.orderNumber });
      setCart({ identity, lines: [] });
      setSelectedCustomer(null);
      setCustomerTerm('');
      setProductTerm('');
      setNotes('');
      idempotencyRef.current = '';
    } catch (error) {
      if (identityRef.current === identity) {
        setSaveError(error instanceof Error ? error.message : 'Unable to save order. Retry safely.');
      }
    } finally {
      busyRef.current = false;
      if (identityRef.current === identity) setSaving(false);
    }
  };

  const readyToSave = permission.allowed && Boolean(customer) && lines.length > 0 && !totals.error && !saving;

  return (
    <div className="space-y-4 pb-6" onKeyDown={(event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        productInputRef.current?.focus();
      } else if (event.ctrlKey && event.key === 'Enter' && readyToSave) {
        event.preventDefault();
        void saveOrder();
      }
    }}>
      {/* Compact operating header, not a second marketing-style hero. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
            <ShoppingCart size={21} strokeWidth={1.9}/>
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[#142B4D] sm:text-2xl">Retail Counter</h1>
            <p className="mt-0.5 text-xs text-slate-500">Fast billing worksheet · Draft sales orders</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900">
            <FileClock size={13}/> Draft only
          </span>
          <Link to="/orders" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#142B4D] hover:border-teal-300 hover:text-teal-700">
            Sales Orders <ArrowRight size={14}/>
          </Link>
        </div>
      </div>

      {completed && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={17}/> Draft order <strong>{completed.number}</strong> saved successfully.</span>
          <Button size="sm" onClick={() => navigate('/orders?search=' + encodeURIComponent(completed.number))}>
            Review order
          </Button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* Search remains bounded, role-safe and tied to the existing services. */}
        <section aria-label="Add products" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="pos-product-search" className="text-sm font-semibold text-[#142B4D]">
              <span className="mr-2 text-teal-700">01</span>Find an item
            </label>
            <span className="hidden items-center gap-1 text-[11px] text-slate-500 sm:inline-flex">
              <Keyboard size={13}/> F2 to focus · ↑ ↓ Enter to add
            </span>
          </div>
          <Input ref={productInputRef} id="pos-product-search" aria-label="Search POS products"
            value={productTerm} maxLength={100} leftIcon={<Search size={16}/>}
            autoComplete="off"
            disabled={saving || !permission.allowed}
            onChange={(e) => {
              setProductTerm(e.target.value);
              setActiveProductIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && products.length) {
                e.preventDefault();
                setActiveProductIndex((index) => Math.min(index + 1, products.length - 1));
              } else if (e.key === 'ArrowUp' && products.length) {
                e.preventDefault();
                setActiveProductIndex((index) => Math.max(index - 1, 0));
              } else if (e.key === 'Enter' && !e.ctrlKey && products.length) {
                e.preventDefault();
                addProduct(products[Math.min(activeProductIndex, products.length - 1)]);
              } else if (e.key === 'Escape') {
                setProductTerm('');
              }
            }}
            placeholder="Search by product name, SKU or brand"/>
          {productError && <p role="alert" className="mt-2 text-xs text-rose-700">{productError}</p>}
          {productTerm.trim().length >= 2 && !productError && productResponse.key !== productKey && (
            <p role="status" className="mt-2 text-xs text-slate-500">Searching products…</p>
          )}
          {productTerm.trim().length >= 2 && !productError && productResponse.key === productKey && products.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">No matching products.</p>
          )}
          {products.length > 0 && (
            <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" aria-label="Product search results">
              {products.map((product, index) => (
                <button key={product.id} type="button" disabled={saving || !permission.allowed}
                  onClick={() => addProduct(product)}
                  aria-label={'Add ' + product.name}
                  className={'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-teal-50 ' +
                    (index === activeProductIndex ? 'bg-teal-50/80' : '')}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[#142B4D]">{product.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{product.sku} · {product.uom} · Stock {product.currentStock ?? '—'}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-teal-700">
                    {formatCurrency(product.sellingPrice)} <Plus size={14}/>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Select customer" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="pos-customer-search" className="text-sm font-semibold text-[#142B4D]">
              <span className="mr-2 text-teal-700">02</span>Customer
            </label>
            {customer && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700"><CheckCircle2 size={13}/> Selected</span>}
          </div>
          <Input id="pos-customer-search" aria-label="Search POS customers"
            value={customerTerm} maxLength={100} leftIcon={<UserRound size={16}/>}
            autoComplete="off" disabled={saving || !permission.allowed}
            onChange={(e) => {
              if (busyRef.current) return;
              setCustomerTerm(e.target.value);
              setSelectedCustomer(null);
              setActiveCustomerIndex(0);
              setSavedOrder(null);
              setSaveError('');
              idempotencyRef.current = '';
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && customers.length) {
                e.preventDefault();
                setActiveCustomerIndex((index) => Math.min(index + 1, customers.length - 1));
              } else if (e.key === 'ArrowUp' && customers.length) {
                e.preventDefault();
                setActiveCustomerIndex((index) => Math.max(index - 1, 0));
              } else if (e.key === 'Enter' && !e.ctrlKey && customers.length) {
                e.preventDefault();
                chooseCustomer(customers[Math.min(activeCustomerIndex, customers.length - 1)]);
              } else if (e.key === 'Escape' && !customer) {
                setCustomerTerm('');
              }
            }}
            placeholder="Search name, company or phone"/>
          {customerError && <p role="alert" className="mt-2 text-xs text-rose-700">{customerError}</p>}
          {customer && (
            <p role="status" className="mt-2 truncate text-xs font-semibold text-teal-800" title={customer.companyName || customer.name}>
              {customer.companyName || customer.name}{customer.phone ? ' · ' + customer.phone : ''}
            </p>
          )}
          {!customer && customerTerm.trim().length >= 2 && !customerError && customerResponse.key !== customerKey && (
            <p role="status" className="mt-2 text-xs text-slate-500">Searching customers…</p>
          )}
          {!customer && customers.length > 0 && (
            <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {customers.map((entry, index) => (
                <button key={entry.id} type="button" disabled={saving || !permission.allowed}
                  onClick={() => chooseCustomer(entry)}
                  className={'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-teal-50 ' +
                    (index === activeCustomerIndex ? 'bg-teal-50/80' : '')}>
                  <span className="min-w-0 truncate font-semibold text-[#142B4D]">{entry.companyName || entry.name}</span>
                  <span className="shrink-0 text-slate-500">{entry.phone || '—'}</span>
                </button>
              ))}
            </div>
          )}
          {!customer && customerTerm.trim().length >= 2 && customerResponse.key === customerKey && customers.length === 0 && !customerError && (
            <p className="mt-2 text-xs text-slate-500">No matching customers.</p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">An existing active customer is required; walk-in accounts are not supported yet.</p>
        </section>
      </div>

      <PosBillingGrid
        lines={lines} calculatedLines={totals.value?.items}
        disabled={saving || !permission.allowed}
        onQuantityChange={(id, quantity) => updateLines(lines.map((line) =>
          line.product.id === id ? { ...line, quantity } : line))}
        onDiscountChange={(id, discountPercent) => updateLines(lines.map((line) =>
          line.product.id === id ? { ...line, discountPercent } : line))}
        onRemove={(id) => updateLines(lines.filter((line) => line.product.id !== id))}
      />

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(310px,370px)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ShieldCheck size={17} className="text-teal-700"/>
            <h2 className="text-sm font-semibold text-[#142B4D]">Draft details & safeguards</h2>
          </div>
          <label htmlFor="pos-notes" className="block text-xs font-medium text-slate-600">Notes for the sales order (optional)</label>
          <textarea id="pos-notes" value={notes} disabled={saving || !permission.allowed} maxLength={500}
            onChange={(e) => { idempotencyRef.current = ''; setNotes(e.target.value); }}
            className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-[#142B4D] focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="Delivery instructions or customer reference — do not enter payment credentials"/>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            <strong>Draft-only foundation:</strong> Saving does not deduct stock, issue a GST invoice, collect payment, or create a receipt.
            {' '}Inventory is checked authoritatively when an order is confirmed. Credit/payment policies follow in a later PR.
          </p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Keyboard size={13}/> F2: product lookup · Ctrl+Enter: save ready draft · Tab: next editable cell</p>
        </section>

        <section aria-label="Draft totals and save" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-[#142B4D]">Order summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4 text-slate-600"><dt>Gross subtotal</dt><dd className="tabular-nums">{totals.value ? formatCurrency(totals.value.grossSubtotal) : '—'}</dd></div>
            <div className="flex justify-between gap-4 text-slate-600"><dt>Line discounts</dt><dd className="tabular-nums">{totals.value ? '− ' + formatCurrency(totals.value.discountTotal) : '—'}</dd></div>
            <div className="flex justify-between gap-4 text-slate-600"><dt>Taxable amount</dt><dd className="tabular-nums">{totals.value ? formatCurrency(totals.value.taxableAmount) : '—'}</dd></div>
            <div className="flex justify-between gap-4 text-slate-600"><dt>GST (estimated)</dt><dd className="tabular-nums">{totals.value ? formatCurrency(totals.value.taxAmount) : '—'}</dd></div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3 text-[#142B4D]">
              <dt className="text-sm font-bold">Estimated total</dt>
              <dd className="text-xl font-extrabold tabular-nums">{totals.value ? formatCurrency(totals.value.totalAmount) : '—'}</dd>
            </div>
          </dl>
          {totals.error && <p role="alert" className="mt-3 text-xs text-rose-700">{totals.error}</p>}
          {saveError && <p role="alert" className="mt-3 text-xs text-rose-700">{saveError}</p>}
          {!permission.allowed && <p role="alert" className="mt-3 text-xs text-amber-800">{permission.message || 'Order creation is unavailable.'}</p>}
          <Button className="mt-4 w-full" isLoading={saving}
            disabled={!permission.allowed || !customer || lines.length === 0 || Boolean(totals.error)}
            onClick={() => void saveOrder()}>
            Save draft sales order
          </Button>
          <p className="mt-2 text-center text-[11px] text-slate-500">Review and confirm orders separately in Sales Orders. This is not a tax invoice.</p>
        </section>
      </div>
    </div>
  );
};
