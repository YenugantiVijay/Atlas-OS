import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  FileText,
  CreditCard,
  Users,
  Truck,
  Sparkles,
  ShieldCheck,
  Building2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  History,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useOrg } from '@/features/organizations/OrgContext';
import { Badge } from '@/components/ui/Badge';
import { getRoleBadgeVariant } from '@/lib/permissions';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { currentOrg, currentRole } = useOrg();

  const navGroups = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-4 h-4" /> },
        { label: 'Activity Feed', path: '/audit', icon: <History className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Sales',
      items: [
        { label: 'Sales Orders', path: '/orders', icon: <FileText className="w-4 h-4" /> },
        { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="w-4 h-4" /> },
        { label: 'Customers', path: '/customers', icon: <Users className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { label: 'Products & SKUs', path: '/products', icon: <Boxes className="w-4 h-4" /> },
        { label: 'Stock Movements', path: '/inventory', icon: <TrendingUp className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Invoices', path: '/invoices', icon: <FileText className="w-4 h-4" /> },
        { label: 'Payments & Receivables', path: '/payments', icon: <CreditCard className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Purchasing',
      items: [
        { label: 'Suppliers', path: '/suppliers', icon: <Truck className="w-4 h-4" /> },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { label: 'ATLAS AI Assistant', path: '/ai', icon: <Sparkles className="w-4 h-4 text-atlas-500" /> },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Team & Access', path: '/team', icon: <Users className="w-4 h-4" /> },
        { label: 'Audit Logs', path: '/audit', icon: <ShieldCheck className="w-4 h-4" /> },
        { label: 'Organization Settings', path: '/settings', icon: <Building2 className="w-4 h-4" /> },
      ],
    },
  ];

  return (
    <aside
      className={`fixed top-0 bottom-0 left-0 z-30 flex flex-col border-r border-border bg-surface-card transition-all duration-200 select-none ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-border/80">
        <BrandLogo collapsed={collapsed} />
        <button
          onClick={onToggle}
          className="rounded-lg p-1.5 text-content-muted hover:bg-surface-muted hover:text-content-primary transition-colors hidden lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Tenant Indicator */}
      {!collapsed && currentOrg && (
        <div className="mx-3 mt-3 p-2.5 rounded-xl bg-surface-panel border border-border flex items-center justify-between">
          <div className="truncate">
            <div className="text-xs font-semibold text-content-primary truncate">
              {currentOrg.name}
            </div>
            <div className="text-[10px] text-content-secondary truncate">
              {currentOrg.city}, {currentOrg.state}
            </div>
          </div>
          <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
            {currentRole}
          </Badge>
        </div>
      )}

      {/* Navigation list */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <h5 className="px-2.5 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                {group.title}
              </h5>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-2.5 py-2 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-atlas-100/90 text-atlas-900 font-semibold shadow-xs'
                          : 'text-content-secondary hover:bg-atlas-50 hover:text-content-primary'
                      } ${collapsed ? 'justify-center px-0' : ''}`
                    }
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom status */}
      <div className="p-3 border-t border-border bg-surface-panel/40">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {!collapsed && (
              <span className="text-[11px] font-medium text-content-secondary">
                Operational Ledger Active
              </span>
            )}
          </div>
          {!collapsed && (
            <span className="text-[10px] text-content-muted font-mono">v0.1.0</span>
          )}
        </div>
      </div>
    </aside>
  );
};
