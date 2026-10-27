import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Boxes,
  ClipboardList,
  FileText,
  Users,
  CreditCard,
  Truck,
  Sparkles,
  ShieldCheck,
  PlusCircle,
  X,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';

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
  const navigate = useNavigate();
  const { currentOrg } = useOrg();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const orgId = currentOrg?.id || '';
  const products = storage.getProducts(orgId);
  const customers = storage.getCustomers(orgId);

  const navigationItems = [
    { label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 text-atlas-600" />, path: '/' },
    { label: 'Products & SKUs', icon: <Boxes className="w-4 h-4 text-atlas-600" />, path: '/products' },
    { label: 'Inventory Ledger', icon: <Boxes className="w-4 h-4 text-atlas-600" />, path: '/inventory' },
    { label: 'Quotations', icon: <ClipboardList className="w-4 h-4 text-atlas-600" />, path: '/quotations' },
    { label: 'Sales Orders', icon: <FileText className="w-4 h-4 text-atlas-600" />, path: '/orders' },
    { label: 'Invoices', icon: <FileText className="w-4 h-4 text-atlas-600" />, path: '/invoices' },
    { label: 'Payments & Receivables', icon: <CreditCard className="w-4 h-4 text-atlas-600" />, path: '/payments' },
    { label: 'Customers', icon: <Users className="w-4 h-4 text-atlas-600" />, path: '/customers' },
    { label: 'Suppliers', icon: <Truck className="w-4 h-4 text-atlas-600" />, path: '/suppliers' },
    { label: 'ATLAS AI Assistant', icon: <Sparkles className="w-4 h-4 text-atlas-600" />, path: '/ai' },
    { label: 'Audit Trail', icon: <ShieldCheck className="w-4 h-4 text-atlas-600" />, path: '/audit' },
  ];

  const quickActions = [
    { label: 'New Product', type: 'product' },
    { label: 'New Customer', type: 'customer' },
    { label: 'New Quotation', type: 'quotation' },
    { label: 'New Sales Order', type: 'order' },
    { label: 'Record Payment', type: 'payment' },
  ];

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
        c.companyName?.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 3);

  const handleSelectNav = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleSelectCreate = (type: string) => {
    onClose();
    onOpenQuickCreate(type);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-content-primary/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-surface-card shadow-modal overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Search Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-border">
          <Search className="w-5 h-5 text-atlas-500 mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, products, customers, or workflows..."
            className="w-full bg-transparent text-sm text-content-primary placeholder-content-muted focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-content-muted hover:text-content-primary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results Container */}
        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-3">
          {/* Quick Actions */}
          <div>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Quick Actions
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1 px-1">
              {quickActions.map((act) => (
                <button
                  key={act.type}
                  onClick={() => handleSelectCreate(act.type)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-content-primary hover:bg-atlas-50 hover:text-atlas-800 transition-colors text-left"
                >
                  <PlusCircle className="w-4 h-4 text-atlas-500" />
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Navigation
            </div>
            <div className="mt-1 space-y-0.5">
              {filteredNav.map((item) => (
                <button
                  key={item.path}
                  onClick={() => handleSelectNav(item.path)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg text-content-primary hover:bg-atlas-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                  <span className="text-[11px] text-content-muted font-mono">{item.path}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Filtered Products */}
          {query.trim() && filteredProducts.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Matching Products
              </div>
              <div className="mt-1 space-y-0.5">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectNav(`/products`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 text-left"
                  >
                    <div>
                      <div className="font-semibold text-content-primary">{p.name}</div>
                      <div className="text-[11px] text-content-secondary">
                        SKU: {p.sku} • Stock: {p.currentStock || 0} {p.uom}
                      </div>
                    </div>
                    <span className="font-medium text-atlas-700">₹{p.sellingPrice}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filtered Customers */}
          {query.trim() && filteredCustomers.length > 0 && (
            <div>
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Matching Customers
              </div>
              <div className="mt-1 space-y-0.5">
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectNav(`/customers`)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-atlas-50 text-left"
                  >
                    <div>
                      <div className="font-semibold text-content-primary">{c.companyName || c.name}</div>
                      <div className="text-[11px] text-content-secondary">{c.phone}</div>
                    </div>
                    <span className="text-[11px] text-content-muted">Customer</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Shortcut hint */}
        <div className="flex items-center justify-between px-4 py-2 bg-surface-panel border-t border-border text-[11px] text-content-muted">
          <span>Navigate with mouse or keyboard</span>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-card border border-border font-mono text-[10px]">
              ESC
            </kbd>
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
