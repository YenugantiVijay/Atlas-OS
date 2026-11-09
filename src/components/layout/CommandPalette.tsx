import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Boxes,
  ClipboardList,
  FileText,
  FileSpreadsheet,
  Users,
  CreditCard,
  Truck,
  Sparkles,
  ShieldCheck,
  PlusCircle,
  X,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { Product, Supplier, Quotation, SalesOrder } from '@/types';
import { searchCustomerDirectory, type CustomerDirectorySearchResult } from '@/services/customer-directory-search.service';
import { hasPermission, Action } from '@/lib/permissions';
import { useActionPermission } from '@/hooks/useActionPermission';
import { useDialog } from '@/components/ui/useDialog';
import { searchFinancialDocuments, type FinancialSearchResult } from '@/services/universal-search.service';
import { searchOperationalRecords, type OperationalSearchResult } from '@/services/operational-search.service';
import { suppliersService } from '@/services/suppliers.service';
import { ordersService } from '@/services/orders.service';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenQuickCreate: (type?: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onOpenQuickCreate,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { currentOrg, currentRole, isMockAuth, isAuthenticated, currentUser } = useOrg();
  const { check: checkActionPermission } = useActionPermission();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogResponseKey, setCatalogResponseKey] = useState('');
  const [customers, setCustomers] = useState<CustomerDirectorySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [financeResponse, setFinanceResponse] = useState<{ key: string; rows: FinancialSearchResult[] }>({ key: '', rows: [] });
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialError, setFinancialError] = useState(false);
  const [operationsResponse, setOperationsResponse] = useState<{ key: string; rows: OperationalSearchResult[] }>({ key: '', rows: [] });
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [operationalError, setOperationalError] = useState(false);
  const demoCatalogCache = useRef<{
    identity: string;
    promise: Promise<[Product[], CustomerDirectorySearchResult[]]>;
  } | null>(null);
  const demoOperationsCache = useRef<{
    identity: string;
    promise: Promise<[Supplier[], Quotation[], SalesOrder[]]>;
  } | null>(null);
  const dialogRef = useDialog(isOpen, onClose);
  const orgId = currentOrg?.id;
  // Bind every response to its request identity: no previous org, role or term
  // may flash results while effects/timers for the new identity are settling.
  const cacheIdentity = JSON.stringify([orgId, currentUser?.id, isAuthenticated]);
  const searchKey = JSON.stringify([cacheIdentity, currentRole, isMockAuth, isOpen, query.trim()]);
  const financeAllowed = !isMockAuth && hasPermission(currentRole, 'reports:financial');
  const dataAllowed = hasPermission(currentRole, 'data:read');
  const financialResults = financeAllowed && financeResponse.key === searchKey ? financeResponse.rows : [];
  const operationalResults = dataAllowed && operationsResponse.key === searchKey ? operationsResponse.rows : [];

  useEffect(() => {
    if (isOpen) { setQuery(''); setSelectedIndex(0); }
    else {
      // Reopen reads fresh local demo data; never reuse across palette sessions.
      demoCatalogCache.current = null;
      demoOperationsCache.current = null;
    }
  }, [isOpen, orgId]);

  // Demo keeps its small in-memory catalog; cloud searches use bounded
  // server-side pages only after the operator types a useful query.
  useEffect(() => {
    let active = true;
    setProducts([]);
    setCustomers([]);
    setCatalogResponseKey('');
    setLoadError(false);
    setIsLoading(false);
    if (!isOpen || !orgId || !dataAllowed) return;
    const term = query.trim();
    if ((!isMockAuth && term.length < 2) || term.length > 100) return;
    const getDemoCatalog = () => {
      if (demoCatalogCache.current?.identity === cacheIdentity) return demoCatalogCache.current.promise;
      const promise = Promise.all([
        productsService.getProducts(orgId, true),
        customersService.getCustomers(orgId, true),
      ]);
      demoCatalogCache.current = { identity: cacheIdentity, promise };
      return promise;
    };
    const load = async () => {
      setIsLoading(true);
      try {
        const [productList, customerList] = isMockAuth
          ? await getDemoCatalog()
          : await Promise.all([
              productsService.getProductsPaginated(orgId, { page: 1, pageSize: 4, search: term }, false)
                .then((result) => result.data),
              searchCustomerDirectory(orgId, term, 3),
            ]);
        if (active) {
          setProducts(productList);
          setCustomers(customerList);
          setCatalogResponseKey(searchKey);
        }
      } catch {
        if (active) {
          if (isMockAuth) demoCatalogCache.current = null;
          setLoadError(true);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    const timer = window.setTimeout(() => { if (active) void load(); }, isMockAuth ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [isOpen, orgId, currentRole, isMockAuth, retryCount, query, dataAllowed, searchKey, cacheIdentity]);


  useEffect(() => {
    let active = true;
    const term = query.trim();
    setFinanceResponse({ key: '', rows: [] });
    setFinancialError(false);
    setFinancialLoading(false);
    if (!isOpen || !orgId || !financeAllowed || term.length < 2 || term.length > 100) return;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setFinancialLoading(true);
      searchFinancialDocuments(orgId, currentRole, term).then((rows) => {
        if (active) setFinanceResponse({ key: searchKey, rows });
      }).catch(() => {
        if (active) setFinancialError(true);
      }).finally(() => {
        if (active) setFinancialLoading(false);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, isOpen, orgId, isMockAuth, currentRole, financeAllowed, searchKey, retryCount]);

  useEffect(() => {
    let active = true;
    const term = query.trim();
    setOperationsResponse({ key: '', rows: [] });
    setOperationalError(false);
    setOperationalLoading(false);
    if (!isOpen || !orgId || term.length < 2 || term.length > 100 || !dataAllowed) return;

    const getDemoOperations = () => {
      if (demoOperationsCache.current?.identity === cacheIdentity) return demoOperationsCache.current.promise;
      const promise = Promise.all([
        suppliersService.getSuppliers(orgId, true),
        ordersService.getQuotations(orgId, true),
        ordersService.getSalesOrders(orgId, true),
      ]);
      demoOperationsCache.current = { identity: cacheIdentity, promise };
      return promise;
    };
    const load = async () => {
      setOperationalLoading(true);
      try {
        let results: OperationalSearchResult[];
        if (isMockAuth) {
          const [suppliers, quotations, orders] = await getDemoOperations();
          const q = term.toLowerCase();
          const digits = term.replace(/\D/g, '');
          const matchesPhone = (phone?: string) => digits.length >= 3 &&
            Boolean(phone?.replace(/\D/g, '').includes(digits));
          results = [
            ...suppliers.filter((s) => s.name.toLowerCase().includes(q) ||
              s.companyName?.toLowerCase().includes(q) || matchesPhone(s.phone))
              .slice(0, 3).map((s) => ({
                recordType: 'supplier' as const, recordId: s.id, reference: s.name,
                displayName: s.companyName || s.name, contactPhone: s.phone,
              })),
            ...quotations.filter((qtn) => qtn.quotationNumber.toLowerCase().includes(q) ||
              qtn.customer?.name.toLowerCase().includes(q) ||
              qtn.customer?.companyName?.toLowerCase().includes(q))
              .slice(0, 3).map((qtn) => ({
                recordType: 'quotation' as const, recordId: qtn.id,
                reference: qtn.quotationNumber, displayName: qtn.customer?.name || '',
              })),
            ...orders.filter((o) => o.orderNumber.toLowerCase().includes(q) ||
              o.customer?.name.toLowerCase().includes(q) ||
              o.customer?.companyName?.toLowerCase().includes(q))
              .slice(0, 3).map((o) => ({
                recordType: 'sales_order' as const, recordId: o.id,
                reference: o.orderNumber, displayName: o.customer?.name || '',
              })),
          ];
        } else {
          results = await searchOperationalRecords(orgId, term, 3);
        }
        if (active) setOperationsResponse({ key: searchKey, rows: results });
      } catch {
        if (active) {
          if (isMockAuth) demoOperationsCache.current = null;
          setOperationalError(true);
        }
      } finally {
        if (active) setOperationalLoading(false);
      }
    };
    const timer = window.setTimeout(() => { if (active) void load(); }, isMockAuth ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, isOpen, orgId, isMockAuth, currentRole, dataAllowed, searchKey, retryCount, cacheIdentity]);

  if (!isOpen) return null;

  const navigationItems = [
    { label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 text-atlas-600" />, path: '/' },
    { label: 'Products & SKUs', icon: <Boxes className="w-4 h-4 text-atlas-600" />, path: '/products' },
    { label: 'Inventory Ledger', icon: <Boxes className="w-4 h-4 text-atlas-600" />, path: '/inventory' },
    { label: 'Quotations', icon: <ClipboardList className="w-4 h-4 text-atlas-600" />, path: '/quotations' },
    { label: 'Sales Orders', icon: <FileText className="w-4 h-4 text-atlas-600" />, path: '/orders' },
    { label: 'Invoices', icon: <FileText className="w-4 h-4 text-atlas-600" />, path: '/invoices' },
    { label: 'Payments & Receivables', icon: <CreditCard className="w-4 h-4 text-atlas-600" />, path: '/payments' },
    { label: 'Sales & Receipts Reports', icon: <FileSpreadsheet className="w-4 h-4 text-atlas-600" />, path: '/reports/sales-receipts' },
    { label: 'Customers', icon: <Users className="w-4 h-4 text-atlas-600" />, path: '/customers' },
    { label: 'Suppliers', icon: <Truck className="w-4 h-4 text-atlas-600" />, path: '/suppliers' },
    { label: 'ATLAS AI Assistant', icon: <Sparkles className="w-4 h-4 text-atlas-600" />, path: '/ai' },
    { label: 'Audit Trail', icon: <ShieldCheck className="w-4 h-4 text-atlas-600" />, path: '/audit' },
  ].filter((item) => {
    if (item.path === '/') return true;
    if (['/invoices', '/payments', '/reports/sales-receipts'].includes(item.path)) return hasPermission(currentRole, 'reports:financial');
    if (item.path === '/audit') return hasPermission(currentRole, 'audit:read');
    return hasPermission(currentRole, 'data:read');
  });

  const quickActions = [
    { label: 'New Product', type: 'product', action: 'products:create' as Action },
    { label: 'New Customer', type: 'customer', action: 'customers:manage' as Action },
    { label: 'New Quotation', type: 'quotation', action: 'quotations:create' as Action },
    { label: 'New Sales Order', type: 'order', action: 'orders:create' as Action },
    { label: 'Record Payment', type: 'payment', action: 'payments:record' as Action },
  ].filter((item) => checkActionPermission(item.action).allowed &&
    item.label.toLowerCase().includes(query.trim().toLowerCase()));

  const filteredNav = navigationItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  const filteredProducts = catalogResponseKey === searchKey && dataAllowed ? products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.sku.toLowerCase().includes(query.toLowerCase()) ||
        p.brand?.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 4) : [];

  const filteredCustomers = catalogResponseKey === searchKey && dataAllowed ? customers
    .filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.companyName?.toLowerCase().includes(query.toLowerCase()) ||
        c.phone?.replace(/\D/g, '').includes(query.replace(/\D/g, '')) && query.replace(/\D/g, '').length >= 3
    )
    .slice(0, 3) : [];

  const resultCount = quickActions.length + filteredNav.length + financialResults.length + operationalResults.length +
    (query.trim() ? filteredProducts.length + filteredCustomers.length : 0);

  const activeIndex = resultCount > 0 ? Math.min(selectedIndex, resultCount - 1) : 0;
  const readableResults = [
    ...quickActions.map((a) => a.label),
    ...filteredNav.map((n) => n.label),
    ...financialResults.map((r) => r.document_number),
    ...operationalResults.map((r) => r.reference),
    ...(query.trim() ? filteredProducts.map((p) => p.name) : []),
    ...(query.trim() ? filteredCustomers.map((c) => c.name) : []),
  ];
  const selectedLabel = readableResults[activeIndex];

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (resultCount === 0) return;
      setSelectedIndex((index) => (Math.min(index, resultCount - 1) + (event.key === 'ArrowDown' ? 1 : -1) + resultCount) % resultCount);
    } else if (event.key === 'Home' && resultCount > 0) {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === 'End' && resultCount > 0) {
      event.preventDefault();
      setSelectedIndex(resultCount - 1);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      const results = dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-command-result]');
      const selected = results?.[activeIndex];
      if (selected) { event.preventDefault(); selected.click(); }
    }
  };

  const handleSelectNav = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleSelectCreate = (type: string) => {
    onClose();
    onOpenQuickCreate(type);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-white shadow-modal overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-border bg-white">
          <Search className="w-5 h-5 text-atlas-500 mr-3 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleSearchKeyDown}
            aria-describedby="atlas-command-selection"
            placeholder="Search commands, products, customers, or workflows..."
            className="w-full bg-transparent text-sm text-content-primary placeholder-content-muted focus:outline-none"
            aria-label="Search Atlas OS"
            maxLength={100}
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-content-muted hover:text-content-primary hover:bg-slate-100 transition-colors"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div id="atlas-command-selection" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {selectedLabel ? `Selected ${activeIndex + 1} of ${resultCount}: ${selectedLabel}` : 'No search results selected'}
        </div>
        {/* Results Container */}
        <div className="max-h-[60vh] overflow-y-auto p-2.5 space-y-3.5">
          {/* Quick Actions */}
          {quickActions.length > 0 && <div>
            <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
              Quick Actions
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1 px-1">
              {quickActions.map((act) => (
                <button
                  key={act.type}
                    data-command-result
                    data-active={activeIndex === quickActions.indexOf(act)}
                  type="button"
                  onClick={() => handleSelectCreate(act.type)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-content-primary hover:bg-atlas-50 data-[active=true]:bg-atlas-100 hover:text-atlas-800 transition-colors text-left"
                >
                  <PlusCircle className="w-4 h-4 text-atlas-500" />
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          </div>}

          {/* Navigation */}
          <div>
            <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
              Navigation
            </div>
            <div className="mt-1 space-y-0.5">
              {filteredNav.map((item) => (
                <button
                  key={item.path}
                    data-command-result
                    data-active={activeIndex === quickActions.length + filteredNav.indexOf(item)}
                  type="button"
                  onClick={() => handleSelectNav(item.path)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-content-primary hover:bg-atlas-50 data-[active=true]:bg-atlas-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon}
                    <span className="font-medium">{item.label}</span>
                  </div>
                  <span className="text-xs text-content-muted font-mono">{item.path}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Finance-only, server-bounded invoice and payment results */}
          {financialLoading && <p role="status" className="px-3 text-xs text-content-muted">Searching financial documents...</p>}
          {financialError && <div role="alert" className="px-3 text-sm text-rose-700">
            Financial document search is unavailable.{' '}
            <button type="button" className="underline" onClick={() => setRetryCount((n) => n + 1)}>Try finance search again</button>
          </div>}
          {query.trim().length >= 2 && financialResults.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
                Invoices & Receipts
              </div>
              <div className="mt-1 space-y-1">
                {financialResults.map((result) => (
                  <button
                    key={`${result.record_type}-${result.record_id}`}
                    data-command-result
                    data-active={activeIndex === quickActions.length + filteredNav.length + financialResults.indexOf(result)}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-atlas-50 data-[active=true]:bg-atlas-100"
                    onClick={() => handleSelectNav(`/${result.record_type === 'invoice' ? 'invoices' : 'payments'}?search=${encodeURIComponent(result.document_number)}`)}
                  >
                    <span className="font-semibold text-content-primary">{result.document_number}</span>
                    <span className="truncate pl-3 text-content-muted">{result.customer_name} · {result.document_date}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Operational searches: 3 rows per family, tenant/RLS-bound in cloud. */}
          {operationalLoading && <p role="status" className="px-3 text-xs text-content-muted">Searching suppliers and orders...</p>}
          {operationalError && <div role="alert" className="px-3 text-sm text-rose-700">
            Operational search is unavailable.{' '}
            <button type="button" className="underline" onClick={() => setRetryCount((n) => n + 1)}>Try operational search again</button>
          </div>}
          {query.trim().length >= 2 && operationalResults.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
                Suppliers, Quotations & Orders
              </div>
              <div className="mt-1 space-y-1">
                {operationalResults.map((result, index) => (
                  <button
                    key={`${result.recordType}-${result.recordId}`}
                    data-command-result
                    data-active={activeIndex === quickActions.length + filteredNav.length + financialResults.length + index}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-atlas-50 data-[active=true]:bg-atlas-100"
                    onClick={() => handleSelectNav(`${result.recordType === 'supplier' ? '/suppliers' : result.recordType === 'quotation' ? '/quotations' : '/orders'}?search=${encodeURIComponent(result.reference)}`)}
                  >
                    <span className="font-semibold text-content-primary">
                      {result.recordType === 'supplier' ? 'Supplier' : result.recordType === 'quotation' ? 'Quotation' : 'Sales Order'} · {result.reference}
                    </span>
                    <span className="truncate pl-3 text-content-muted">{result.displayName}{result.contactPhone ? ` · ${result.contactPhone}` : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtered Products */}
          {isLoading && <p role="status" className="px-3 text-sm text-content-secondary">Loading products and customers...</p>}
          {loadError && (
            <div role="alert" className="px-3 text-sm text-rose-700">
              Search data could not be loaded.{' '}
              <button type="button" className="underline" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
            </div>
          )}
          {query.trim() && !isLoading && !loadError && filteredNav.length === 0 && quickActions.length === 0 &&
            filteredProducts.length === 0 && filteredCustomers.length === 0 && operationalResults.length === 0 && financialResults.length === 0 &&
            !operationalLoading && !financialLoading && !operationalError && !financialError && (
              <p role="status" className="px-3 text-sm text-content-secondary">No matching results.</p>
            )}
          {query.trim() && filteredProducts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
                Matching Products
              </div>
              <div className="mt-1 space-y-0.5">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    data-command-result
                    data-active={activeIndex === quickActions.length + filteredNav.length + financialResults.length + operationalResults.length + filteredProducts.indexOf(p)}
                    type="button"
                    onClick={() => handleSelectNav(`/products?search=${encodeURIComponent(p.sku)}`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 data-[active=true]:bg-atlas-100 text-left"
                  >
                    <div>
                      <div className="font-semibold text-content-primary">{p.name}</div>
                      <div className="text-xs text-content-secondary mt-0.5">
                        SKU: {p.sku} • Stock: {p.currentStock || 0} {p.uom}
                      </div>
                    </div>
                    <span className="font-medium text-atlas-700 tabular-nums">₹{p.sellingPrice}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtered Customers */}
          {query.trim() && filteredCustomers.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-content-muted">
                Matching Customers
              </div>
              <div className="mt-1 space-y-0.5">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    data-command-result
                    data-active={activeIndex === quickActions.length + filteredNav.length + financialResults.length + operationalResults.length + filteredProducts.length + filteredCustomers.indexOf(c)}
                    type="button"
                    onClick={() => handleSelectNav(`/customers?search=${encodeURIComponent(c.name)}`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 data-[active=true]:bg-atlas-100 text-left"
                  >
                    <div>
                      <div className="font-semibold text-content-primary">{c.companyName || c.name}</div>
                      <div className="text-xs text-content-secondary mt-0.5">{c.phone}</div>
                    </div>
                    <span className="text-xs text-content-muted">Customer</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Shortcut hint */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-border text-xs text-content-muted">
          <span>↑ ↓ select · Home / End · Enter open · Esc close</span>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-xs">
              ESC
            </kbd>
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
