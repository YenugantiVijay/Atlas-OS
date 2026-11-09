import React, { useState, useEffect } from 'react';
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
import { Product, Customer } from '@/types';
import { hasPermission, Action } from '@/lib/permissions';
import { useActionPermission } from '@/hooks/useActionPermission';
import { useDialog } from '@/components/ui/useDialog';
import { searchFinancialDocuments, type FinancialSearchResult } from '@/services/universal-search.service';

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
  const { currentOrg, currentRole, isMockAuth } = useOrg();
  const { check: checkActionPermission } = useActionPermission();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [financialResults, setFinancialResults] = useState<FinancialSearchResult[]>([]);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialError, setFinancialError] = useState(false);
  const dialogRef = useDialog(isOpen, onClose);
  const orgId = currentOrg?.id;

  useEffect(() => {
    if (isOpen) { setQuery(''); setSelectedIndex(0); }
  }, [isOpen, orgId]);

  // Demo keeps its small in-memory catalog; cloud searches use bounded
  // server-side pages only after the operator types a useful query.
  useEffect(() => {
    let active = true;
    setProducts([]);
    setCustomers([]);
    setLoadError(false);
    setIsLoading(false);
    if (!isOpen || !orgId || !hasPermission(currentRole, 'data:read')) return;
    const term = query.trim();
    if (!isMockAuth && term.length < 2) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const [productList, customerList] = isMockAuth
          ? await Promise.all([
              productsService.getProducts(orgId, true),
              customersService.getCustomers(orgId, true),
            ])
          : await Promise.all([
              productsService.getProductsPaginated(orgId, { page: 1, pageSize: 4, search: term }, false)
                .then((result) => result.data),
              customersService.getCustomersPaginated(orgId, { page: 1, pageSize: 3, search: term }, false)
                .then((result) => result.data),
            ]);
        if (active) {
          setProducts(productList);
          setCustomers(customerList);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    const timer = window.setTimeout(() => { if (active) void load(); }, isMockAuth ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [isOpen, orgId, currentRole, isMockAuth, retryCount, query]);


  useEffect(() => {
    let active = true;
    const term = query.trim();
    setFinancialResults([]);
    setFinancialError(false);
    setFinancialLoading(false);
    if (!isOpen || !orgId || isMockAuth ||
        !hasPermission(currentRole, 'reports:financial') || term.length < 2) return;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setFinancialLoading(true);
      searchFinancialDocuments(orgId, currentRole, term).then((rows) => {
        if (active) setFinancialResults(rows);
      }).catch(() => {
        if (active) setFinancialError(true);
      }).finally(() => {
        if (active) setFinancialLoading(false);
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, isOpen, orgId, isMockAuth, currentRole]);

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

  const filteredProducts = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.sku.toLowerCase().includes(query.toLowerCase()) ||
        p.brand?.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 4);

  const filteredCustomers = customers
    .filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.companyName?.toLowerCase().includes(query.toLowerCase()) ||
        c.phone?.replace(/\D/g, '').includes(query.replace(/\D/g, '')) && query.replace(/\D/g, '').length >= 3
    )
    .slice(0, 3);

  const resultCount = quickActions.length + filteredNav.length + financialResults.length +
    (query.trim() ? filteredProducts.length + filteredCustomers.length : 0);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (resultCount === 0) return;
      setSelectedIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + resultCount) % resultCount);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      const results = dialogRef.current?.querySelectorAll<HTMLButtonElement>('[data-command-result]');
      const selected = results?.[Math.min(selectedIndex, (results?.length ?? 1) - 1)];
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
            placeholder="Search commands, products, customers, or workflows..."
            className="w-full bg-transparent text-sm text-content-primary placeholder-content-muted focus:outline-none"
            aria-label="Search Atlas OS"
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
                    data-active={selectedIndex === quickActions.indexOf(act)}
                  type="button"
                  onClick={() => handleSelectCreate(act.type)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-content-primary hover:bg-atlas-50 hover:text-atlas-800 transition-colors text-left"
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
                    data-active={selectedIndex === quickActions.length + filteredNav.indexOf(item)}
                  type="button"
                  onClick={() => handleSelectNav(item.path)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-content-primary hover:bg-atlas-50 transition-colors text-left"
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
          {financialError && <p role="alert" className="px-3 text-sm text-rose-700">Financial document search is unavailable.</p>}
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
                    data-active={selectedIndex === quickActions.length + filteredNav.length + financialResults.indexOf(result)}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-atlas-50"
                    onClick={() => handleSelectNav(`/${result.record_type === 'invoice' ? 'invoices' : 'payments'}?search=${encodeURIComponent(result.document_number)}`)}
                  >
                    <span className="font-semibold text-content-primary">{result.document_number}</span>
                    <span className="truncate pl-3 text-content-muted">{result.customer_name} · {result.document_date}</span>
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
            filteredProducts.length === 0 && filteredCustomers.length === 0 && (
              <p role="status" className="px-3 text-sm text-content-secondary">No matching commands, products, or customers.</p>
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
                    data-active={selectedIndex === quickActions.length + filteredNav.length + financialResults.length + filteredProducts.indexOf(p)}
                    type="button"
                    onClick={() => handleSelectNav(`/products?search=${encodeURIComponent(p.sku)}`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 text-left"
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
                    data-active={selectedIndex === quickActions.length + filteredNav.length + financialResults.length + filteredProducts.length + filteredCustomers.indexOf(c)}
                    type="button"
                    onClick={() => handleSelectNav(`/customers?search=${encodeURIComponent(c.name)}`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 text-left"
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
          <span>↑ ↓ select · Enter open · Esc close</span>
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
