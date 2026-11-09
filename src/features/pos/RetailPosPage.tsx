import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Search, ShoppingCart, Trash2, ArrowRight, AlertTriangle } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { searchCustomerDirectory, type CustomerDirectorySearchResult } from '@/services/customer-directory-search.service';
import { ordersService } from '@/services/orders.service';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import type { Product } from '@/types';
import { buildPosOrderDraft, summarizePosCart, type PosCartLine } from './pos-draft';

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

  const productKey = `${identity}:${productTerm.trim()}`;
  const customerKey = `${identity}:${customerTerm.trim()}`;
  const products = productResponse.key === productKey ? productResponse.rows : [];
  const customers = customerResponse.key === customerKey ? customerResponse.rows : [];
  const lines = cart.identity === identity ? cart.lines : [];
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
    if (!product.isActive || product.organizationId !== organizationId) return;
    const old = lines.find((item) => item.product.id === product.id);
    if (old) {
      updateLines(lines.map((item) => item.product.id === product.id
        ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      updateLines([...lines, { product, quantity: 1, discountPercent: 0 }]);
    }
  };

  const chooseCustomer = (entry: DirectoryEntry) => {
    if (busyRef.current) return;
    idempotencyRef.current = '';
    setSelectedCustomer({ identity, customer: entry });
    setCustomerTerm(entry.companyName || entry.name);
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-content-primary">
            <ShoppingCart className="h-6 w-6 text-teal-700" /> Retail Counter
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            Single-item or bulk-quantity cart. Save a draft sales order, then review and confirm it in Sales Orders.
          </p>
        </div>
        <Link to="/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:underline">
          Sales Orders <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
        <strong>Draft-only foundation:</strong> Saving does not deduct stock, issue a GST invoice, collect payment, or create a receipt.
        Inventory is checked authoritatively when an order is confirmed. Payment and credit policies follow in a later PR.
      </div>

      {completed && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <span>Draft order <strong>{completed.number}</strong> saved successfully.</span>
          <Button onClick={() => navigate(`/orders?search=${encodeURIComponent(completed.number)}`)}>
            Review order
          </Button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.8fr)]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-3 text-base font-semibold">1. Find products</h2>
            <Input label="Search product name, SKU or brand" aria-label="Search POS products"
              value={productTerm} maxLength={100} leftIcon={<Search className="h-4 w-4" />}
              onChange={(e) => setProductTerm(e.target.value)} placeholder="Type at least 2 characters" />
            {productError && <p role="alert" className="mt-2 text-sm text-rose-700">{productError}</p>}
            {productTerm.trim().length >= 2 && products.length === 0 && !productError && (
              <p className="mt-3 text-xs text-content-muted">No matching products yet.</p>
            )}
            <div className="mt-3 divide-y divide-border">
              {products.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{product.name}</p>
                    <p className="text-xs text-content-secondary">
                      {product.sku} · {product.uom} · Stock {product.currentStock ?? '—'} · {formatCurrency(product.sellingPrice)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={saving} onClick={() => addProduct(product)}
                    aria-label={`Add ${product.name}`}>Add <Plus className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold">2. Choose customer</h2>
            <Input label="Customer name, company or phone" aria-label="Search POS customers"
              value={customerTerm} maxLength={100} leftIcon={<Search className="h-4 w-4" />}
              onChange={(e) => {
                if (busyRef.current) return;
                setCustomerTerm(e.target.value);
                setSelectedCustomer(null);
                idempotencyRef.current = '';
              }} placeholder="Type at least 2 characters" />
            {customerError && <p role="alert" className="mt-2 text-sm text-rose-700">{customerError}</p>}
            {customer && <p role="status" className="mt-2 text-sm font-medium text-teal-800">
              Selected: {customer.companyName || customer.name}
            </p>}
            <div className="mt-2 max-h-52 divide-y divide-border overflow-y-auto">
              {customers.map((entry) => (
                <button key={entry.id} type="button" disabled={saving}
                  onClick={() => chooseCustomer(entry)}
                  className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-teal-50">
                  <span className="font-medium">{entry.companyName || entry.name}</span>
                  <span className="text-xs text-content-secondary">{entry.phone}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-content-secondary">Walk-in or guest-customer setup is not included in this foundation.</p>
          </Card>
        </div>

        <Card className="self-start">
          <h2 className="mb-1 text-base font-semibold">3. Counter cart</h2>
          <p className="mb-4 text-xs text-content-secondary">One quantity = one product unit (shown per line). Use larger quantities for bulk; unit conversion is not enabled yet.</p>
          {lines.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-content-muted">Add a product to start a cart.</p>}
          <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {lines.map((line) => (
              <div key={line.product.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{line.product.name}</p>
                    <p className="text-xs text-content-secondary">{line.product.sku} · {line.product.uom} · {formatCurrency(line.product.sellingPrice)} each</p>
                  </div>
                  <button type="button" disabled={saving}
                    aria-label={`Remove ${line.product.name}`} className="rounded p-1 text-rose-700 hover:bg-rose-50"
                    onClick={() => updateLines(lines.filter((item) => item.product.id !== line.product.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <Input label={`Quantity (${line.product.uom})`} inputMode="numeric" type="number"
                      min={1} max={1000000} step={1} disabled={saving}
                      aria-label={`Quantity for ${line.product.name}`}
                      value={line.quantity}
                      onChange={(e) => updateLines(lines.map((item) => item.product.id === line.product.id
                        ? { ...item, quantity: e.target.value === '' ? 0 : Number(e.target.value) } : item))} />
                  </div>
                  <div className="w-28">
                    <Input label="Discount %" inputMode="decimal" type="number" min={0} max={100} step={0.5}
                      disabled={saving} aria-label={`Discount for ${line.product.name}`}
                      value={line.discountPercent}
                      onChange={(e) => updateLines(lines.map((item) => item.product.id === line.product.id
                        ? { ...item, discountPercent: Number(e.target.value) } : item))} />
                  </div>
                  <button type="button" disabled={saving} aria-label={`Decrease ${line.product.name}`}
                    onClick={() => updateLines(lines.map((item) => item.product.id === line.product.id
                      ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item))}
                    className="mb-1 rounded-lg border border-border p-2 hover:bg-surface-muted"><Minus className="h-4 w-4" /></button>
                </div>
                {line.product.currentStock !== undefined && line.quantity > line.product.currentStock && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-amber-800">
                    <AlertTriangle className="h-3 w-3" /> Quantity exceeds last displayed stock; confirmation may fail.
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{totals.value ? formatCurrency(totals.value.grossSubtotal) : '—'}</span></div>
            <div className="flex justify-between"><span>Discount</span><span>{totals.value ? formatCurrency(totals.value.discountTotal) : '—'}</span></div>
            <div className="flex justify-between"><span>GST</span><span>{totals.value ? formatCurrency(totals.value.taxAmount) : '—'}</span></div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><span>Estimated total</span><span>{totals.value ? formatCurrency(totals.value.totalAmount) : '—'}</span></div>
          </div>

          <label htmlFor="pos-notes" className="mt-4 block text-sm font-medium">Counter notes (optional)</label>
          <textarea id="pos-notes" value={notes} disabled={saving} maxLength={500}
            onChange={(e) => { idempotencyRef.current = ''; setNotes(e.target.value); }}
            className="mt-1 min-h-16 w-full rounded-lg border border-border bg-surface-card p-3 text-sm"
            placeholder="Order instructions, no payment details" />

          {totals.error && <p role="alert" className="mt-3 text-sm text-rose-700">{totals.error}</p>}
          {saveError && <p role="alert" className="mt-3 text-sm text-rose-700">{saveError}</p>}
          {!permission.allowed && <p role="alert" className="mt-3 text-sm text-amber-800">{permission.message || 'Order creation is unavailable.'}</p>}
          <Button className="mt-4 w-full" isLoading={saving}
            disabled={!permission.allowed || !customer || lines.length === 0 || Boolean(totals.error)}
            onClick={() => void saveOrder()}>
            Save draft sales order
          </Button>
          <p className="mt-2 text-center text-xs text-content-secondary">
            Draft only — confirm and invoice separately using approved workflows.
          </p>
        </Card>
      </div>
    </div>
  );
};
