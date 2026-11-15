import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ShoppingCart, ArrowRight, CheckCircle2, Keyboard, FileClock, UserRound, ShieldCheck, Banknote } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { productsService } from '@/services/products.service';
import { productAlternativesService, type CounterAlternative } from '@/services/product-alternatives.service';
import { customersService } from '@/services/customers.service';
import { searchCustomerDirectory, type CustomerDirectorySearchResult } from '@/services/customer-directory-search.service';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { paymentsService } from '@/services/payments.service';
import { counterShiftsService, CounterShift } from '@/services/counter-shifts.service';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import type { PaymentMethod, Product } from '@/types';
import { buildPosOrderDraft, summarizePosCart, type PosCartLine } from './pos-draft';
import { PosBillingGrid } from './PosBillingGrid';

type DirectoryEntry = Pick<CustomerDirectorySearchResult, 'id' | 'name' | 'companyName' | 'phone'>;

export const RetailPosPage: React.FC = () => {
  const { currentOrg, currentUser, currentRole, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const navigate = useNavigate();
  const organizationId = currentOrg?.id;
  const identity = `${organizationId || ''}:${currentUser?.id || 'demo'}:${isMockAuth}`;

  const [productTerm, setProductTerm] = useState('');
  const [productResponse, setProductResponse] = useState<{ key: string; rows: Product[] }>({ key: '', rows: [] });
  const [productError, setProductError] = useState('');
  const [alternativeResponse, setAlternativeResponse] = useState<{
    key: string; rows: CounterAlternative[]; unavailable?: boolean;
  }>({ key: '', rows: [] });
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
  const [paidSale, setPaidSale] = useState<{ identity: string; invoiceNumber: string; receiptNumber: string } | null>(null);
  const [counterShift, setCounterShift] = useState<CounterShift | null>(null);
  const [shiftError, setShiftError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const busyRef = useRef(false);
  const idempotencyRef = useRef('');
  const checkoutKeysRef = useRef<{ order: string; invoice: string; payment: string } | null>(null);
  const checkoutProgressRef = useRef<{ orderId?: string; invoiceId?: string; paymentId?: string } | null>(null);
  const checkoutLockedRef = useRef(false);
  const [checkoutLocked, setCheckoutLocked] = useState(false);
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
  const alternatives = alternativeResponse.key === productKey ? alternativeResponse.rows : [];
  const customers = customerResponse.key === customerKey && !selectedCustomer ? customerResponse.rows : [];
  const lines = useMemo(() => (cart.identity === identity ? cart.lines : []), [cart, identity]);
  const customer = selectedCustomer?.identity === identity ? selectedCustomer.customer : null;
  const completed = savedOrder?.identity === identity ? savedOrder : null;
  const completedSale = paidSale?.identity === identity ? paidSale : null;
  const permission = check('orders:create');
  const confirmPermission = check('orders:confirm');
  const invoicePermission = check('invoices:create');
  const paymentPermission = check('payments:record');
  const canCheckout = permission.allowed && confirmPermission.allowed &&
    invoicePermission.allowed && paymentPermission.allowed;

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
    setPaidSale(null);
    setCheckoutLocked(false);
    checkoutLockedRef.current = false;
    checkoutKeysRef.current = null;
    checkoutProgressRef.current = null;
  }, [identity]);

  useEffect(() => {
    let active = true;
    setCounterShift(null);
    setShiftError('');
    if (!organizationId) return () => { active = false; };
    counterShiftsService.getLatestShift(organizationId, isMockAuth)
      .then((shift) => { if (active) setCounterShift(shift); })
      .catch((error) => {
        if (active) setShiftError(error instanceof Error ? error.message : 'Unable to verify the current counter shift.');
      });
    return () => { active = false; };
  }, [identity, organizationId, isMockAuth]);

  useEffect(() => {
    let active = true;
    setProductError('');
    const term = productTerm.trim();
    if (!organizationId || term.length < 2 || term.length > 100) return;
    const timer = window.setTimeout(() => {
      productsService.getProductsPaginated(organizationId, {
        search: term, page: 1, pageSize: 8, isActive: true,
      }, isMockAuth).then((result) => {
        if (!active) return;
        setProductResponse({ key: productKey, rows: result.data });
        if (isMockAuth) return;
        const outOfStock = result.data.filter((product) =>
          product.currentStock !== undefined && product.currentStock <= 0).map((product) => product.id);
        void productAlternativesService.forCounter(organizationId, outOfStock)
          .then((rows) => { if (active) setAlternativeResponse({ key: productKey, rows }); })
          .catch(() => { if (active) setAlternativeResponse({ key: productKey, rows: [], unavailable: true }); });
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
    if (busyRef.current || checkoutLockedRef.current) return;
    idempotencyRef.current = '';
    checkoutKeysRef.current = null;
    checkoutProgressRef.current = null;
    setSavedOrder(null);
    setPaidSale(null);
    setSaveError('');
    setCart({ identity, lines: next });
  };

  const addProduct = (product: Product) => {
    if (busyRef.current || checkoutLockedRef.current || !permission.allowed || !product.isActive || product.organizationId !== organizationId) return;
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
    if (busyRef.current || checkoutLockedRef.current) return;
    idempotencyRef.current = '';
    setSelectedCustomer({ identity, customer: entry });
    setCustomerTerm(entry.companyName || entry.name);
    setActiveCustomerIndex(0);
    setSavedOrder(null);
    setSaveError('');
  };

  const saveOrder = async () => {
    if (busyRef.current || checkoutLockedRef.current || !organizationId) return;
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

  const completeCounterSale = async () => {
    if (busyRef.current || !organizationId) return;
    const checkoutAllowed = check('orders:confirm').allowed &&
      check('invoices:create').allowed && check('payments:record').allowed;
    if (!checkoutAllowed) {
      setSaveError('Your role can save draft orders but cannot complete counter checkout.');
      return;
    }
    if (counterShift?.status !== 'OPEN') {
      setSaveError('Open a counter shift before completing a paid sale.');
      return;
    }
    if (!customer) {
      setSaveError('Choose a customer before completing checkout.');
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      setSaveError('Secure checkout request IDs are unavailable. Use an up-to-date browser.');
      return;
    }
    if (!checkoutKeysRef.current) {
      checkoutKeysRef.current = {
        order: globalThis.crypto.randomUUID(),
        invoice: globalThis.crypto.randomUUID(),
        payment: globalThis.crypto.randomUUID(),
      };
    }
    const keys = checkoutKeysRef.current;
    let orderInput;
    try {
      orderInput = buildPosOrderDraft({
        organizationId,
        customerId: customer.id,
        orderDate: getBusinessDate(),
        notes: [notes.trim(), `Retail counter sale · shift ${counterShift.id}`].filter(Boolean).join(' · '),
        idempotencyKey: keys.order,
        lines,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Invalid counter cart.');
      return;
    }

    checkoutLockedRef.current = true;
    setCheckoutLocked(true);
    busyRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const activeCustomer = await customersService.getCustomerById(organizationId, customer.id, isMockAuth);
      if (!activeCustomer || !activeCustomer.isActive || activeCustomer.organizationId !== organizationId) {
        throw new Error('The selected customer is no longer active in this business.');
      }

      const progress = checkoutProgressRef.current || {};
      let orderId = progress.orderId;
      if (!orderId) {
        const order = await ordersService.createSalesOrder(organizationId, orderInput, isMockAuth);
        orderId = order.id;
        checkoutProgressRef.current = { ...progress, orderId };
      }

      await ordersService.confirmSalesOrder(organizationId, orderId, currentRole, isMockAuth);

      let invoiceId = checkoutProgressRef.current?.invoiceId;
      let invoiceNumber = '';
      let invoiceTotal = 0;
      if (!invoiceId) {
        const businessDate = getBusinessDate();
        const invoice = await invoicesService.createInvoice(organizationId, {
          customerId: customer.id,
          salesOrderId: orderId,
          invoiceDate: businessDate,
          dueDate: businessDate,
          status: 'ISSUED',
          idempotencyKey: keys.invoice,
          notes: `Retail counter sale · shift ${counterShift.id}`,
          items: lines.map(({ product, quantity, discountPercent }) => ({
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            uom: product.uom,
            quantity,
            unitPrice: product.sellingPrice,
            discountPercent,
            taxRate: product.taxRate,
          })),
        }, isMockAuth);
        invoiceId = invoice.id;
        invoiceNumber = invoice.invoiceNumber;
        invoiceTotal = invoice.totalAmount;
        checkoutProgressRef.current = { ...checkoutProgressRef.current, invoiceId };
      } else {
        const invoice = await invoicesService.getInvoiceById(organizationId, invoiceId, isMockAuth);
        if (!invoice) throw new Error('The issued invoice could not be reloaded. Retry the same checkout safely.');
        invoiceNumber = invoice.invoiceNumber;
        invoiceTotal = invoice.totalAmount;
      }

      let paymentId = checkoutProgressRef.current?.paymentId;
      let receiptNumber = '';
      if (!paymentId) {
        const payment = await paymentsService.recordPayment(organizationId, {
          customerId: customer.id,
          invoiceId,
          amount: invoiceTotal,
          paymentMethod,
          paymentDate: getBusinessDate(),
          notes: `Retail counter sale · shift ${counterShift.id}`,
          idempotencyKey: keys.payment,
        }, isMockAuth, currentRole);
        paymentId = payment.id;
        receiptNumber = payment.paymentNumber;
        checkoutProgressRef.current = { ...checkoutProgressRef.current, paymentId };
      }

      await counterShiftsService.linkPayment(organizationId, counterShift.id, paymentId, isMockAuth);
      if (!receiptNumber) {
        const payments = await paymentsService.getPayments(organizationId, isMockAuth);
        receiptNumber = payments.find((payment) => payment.id === paymentId)?.paymentNumber || 'recorded';
      }
      if (identityRef.current !== identity) return;
      setPaidSale({ identity, invoiceNumber, receiptNumber });
      setCart({ identity, lines: [] });
      setSelectedCustomer(null);
      setCustomerTerm('');
      setProductTerm('');
      setNotes('');
      setSavedOrder(null);
      idempotencyRef.current = '';
      checkoutKeysRef.current = null;
      checkoutProgressRef.current = null;
      checkoutLockedRef.current = false;
      setCheckoutLocked(false);
    } catch (error) {
      if (identityRef.current === identity) {
        setSaveError((error instanceof Error ? error.message : 'Counter sale could not be completed.') +
          ' Retry this same checkout; do not create a second sale.');
      }
    } finally {
      busyRef.current = false;
      if (identityRef.current === identity) setSaving(false);
    }
  };

  const readyToSave = permission.allowed && Boolean(customer) && lines.length > 0 && !totals.error && !saving;
  const readyToCheckout = canCheckout && counterShift?.status === 'OPEN' && Boolean(customer) &&
    lines.length > 0 && !totals.error && !saving;

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 pb-6" onKeyDown={(event) => {
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
            <p className="mt-0.5 text-xs text-slate-500">Paid counter checkout · shifts, invoices, and receipts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ' +
            (canCheckout
              ? 'border-teal-200 bg-teal-50 text-teal-800'
              : 'border-amber-200 bg-amber-50 text-amber-900')}>
            {canCheckout ? <Banknote size={13}/> : <FileClock size={13}/>}
            {canCheckout ? 'Paid checkout' : 'Draft only'}
          </span>
          <Link to="/counter-shift" className={'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ' +
            (counterShift?.status === 'OPEN'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-slate-200 bg-white text-[#142B4D] hover:border-teal-300 hover:text-teal-700')}>
            <Banknote size={14}/>{counterShift?.status === 'OPEN' ? 'Shift open' : 'Open shift'}
          </Link>
          <Link to="/orders" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#142B4D] hover:border-teal-300 hover:text-teal-700">
            Sales Orders <ArrowRight size={14}/>
          </Link>
          {!isMockAuth && check('reports:financial').allowed && (
            <Link to="/payments" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#142B4D] hover:border-teal-300 hover:text-teal-700">Payment receipts</Link>
          )}
        </div>
      </div>

      {shiftError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
        Shift status could not be verified. Paid checkout is unavailable until you retry the shift page.
      </p>}
      {!shiftError && counterShift?.status !== 'OPEN' && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Open a counter shift before completing a paid sale. You can still save a draft order.
        </p>
      )}
      {checkoutLocked && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          This checkout has started. Cart edits are locked so a safe retry uses the same order, invoice, and payment request.
        </p>
      )}

      {completedSale && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={17}/> Paid sale complete · invoice <strong>{completedSale.invoiceNumber}</strong> · receipt <strong>{completedSale.receiptNumber}</strong></span>
          <Link to="/invoices" className="font-semibold underline underline-offset-2">View invoices</Link>
        </div>
      )}

      {completed && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={17}/> Draft order <strong>{completed.number}</strong> saved successfully.</span>
          <Button size="sm" onClick={() => navigate('/orders?search=' + encodeURIComponent(completed.number))}>
            Review order
          </Button>
        </div>
      )}

      <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
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
            disabled={saving || checkoutLocked || !permission.allowed}
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
            placeholder="Product name, nickname, SKU, brand or HSN"/>
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
                <div key={product.id}>
                  <button type="button" disabled={saving || checkoutLocked || !permission.allowed}
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
                  {alternatives.filter((match) => match.sourceProductId === product.id).map((match) => (
                    <button key={match.product.id} type="button"
                      disabled={saving || checkoutLocked || !permission.allowed || (match.product.currentStock ?? 0) <= 0}
                      onClick={() => addProduct(match.product)} aria-label={'Add approved alternative ' + match.product.name}
                      className="flex w-full items-start justify-between gap-3 border-t border-slate-100 bg-atlas-50/50 py-2 pl-6 pr-3 text-left text-xs hover:bg-atlas-50 disabled:opacity-60">
                      <span className="min-w-0">
                        <span className="block font-semibold text-atlas-800">Approved alternative · {match.product.name}</span>
                        <span className="block text-slate-600">{match.product.sku} · {match.product.uom} · Stock {match.product.currentStock}</span>
                        <span className="block text-slate-600">{match.comparisonNote}</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-teal-700">
                        {formatCurrency(match.product.sellingPrice)} <Plus size={14}/>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {alternativeResponse.key === productKey && alternativeResponse.unavailable && (
            <p role="status" className="mt-2 text-xs text-slate-600">Approved alternatives are unavailable.</p>
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
            autoComplete="off" disabled={saving || checkoutLocked || !permission.allowed}
            onChange={(e) => {
              if (busyRef.current || checkoutLockedRef.current) return;
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
            placeholder="Customer name, company, phone or GSTIN"/>
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
                <button key={entry.id} type="button" disabled={saving || checkoutLocked || !permission.allowed}
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
        disabled={saving || checkoutLocked || !permission.allowed}
        onQuantityChange={(id, quantity) => updateLines(lines.map((line) =>
          line.product.id === id ? { ...line, quantity } : line))}
        onDiscountChange={(id, discountPercent) => updateLines(lines.map((line) =>
          line.product.id === id ? { ...line, discountPercent } : line))}
        onRemove={(id) => updateLines(lines.filter((line) => line.product.id !== id))}
      />

      <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(310px,370px)]">
        <section className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ShieldCheck size={17} className="text-teal-700"/>
            <h2 className="text-sm font-semibold text-[#142B4D]">Sale details & safeguards</h2>
          </div>
          <label htmlFor="pos-notes" className="block text-xs font-medium text-slate-600">Notes for the sales order (optional)</label>
          <textarea id="pos-notes" value={notes} disabled={saving || checkoutLocked || !permission.allowed} maxLength={500}
            onChange={(e) => {
              if (checkoutLockedRef.current) return;
              idempotencyRef.current = '';
              setNotes(e.target.value);
            }}
            className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-[#142B4D] focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="Delivery instructions or customer reference — do not enter payment credentials"/>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            <strong>Draft vs. paid sale:</strong> Saving a draft does not change stock or create a financial record.
            {' '}Paid checkout confirms stock, issues an invoice, records the selected payment, and links its receipt to the open shift.
            {' '}Recipe-based ingredient consumption and expiry tracking are not included yet.
          </p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Keyboard size={13}/> F2: product lookup · Ctrl+Enter: save ready draft · Tab: next editable cell</p>
        </section>

        <section aria-label="Draft totals and save" className="min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
          {canCheckout && (
            <div className="mt-4">
              <label htmlFor="counter-payment-method" className="block text-xs font-medium text-slate-600">Tender</label>
              <select id="counter-payment-method" value={paymentMethod} disabled={saving || checkoutLocked}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#142B4D] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100">
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
              </select>
            </div>
          )}
          <Button className="mt-4 w-full" isLoading={saving}
            disabled={!permission.allowed || checkoutLocked || !customer || lines.length === 0 || Boolean(totals.error)}
            onClick={() => void saveOrder()}>
            Save draft sales order
          </Button>
          {canCheckout && (
            <Button className="mt-2 w-full" variant="outline" isLoading={saving}
              disabled={!readyToCheckout || Boolean(shiftError)}
              onClick={() => void completeCounterSale()}>
              {checkoutLocked ? 'Retry paid sale' : 'Complete paid sale'}
            </Button>
          )}
          {!canCheckout && <p className="mt-2 text-center text-[11px] text-slate-600">
            Your role can save draft orders but cannot complete invoice-and-payment checkout.
          </p>}
          <p className="mt-2 text-center text-[11px] text-slate-500">
            Drafts need separate review. Paid checkout confirms stock, issues an invoice, records payment, and links the receipt to this shift.
          </p>
        </section>
      </div>
    </div>
  );
};
