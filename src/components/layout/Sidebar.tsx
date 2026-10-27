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
        { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
        { label: 'Activity Feed', path: '/audit', icon: <History className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Sales Operations',
      items: [
        { label: 'Sales Orders', path: '/orders', icon: <FileText className="w-[18px] h-[18px]" /> },
        { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="w-[18px] h-[18px]" /> },
        { label: 'Customers', path: '/customers', icon: <Users className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Inventory & Stock',
      items: [
        { label: 'Products & SKUs', path: '/products', icon: <Boxes className="w-[18px] h-[18px]" /> },
        { label: 'Stock Movements', path: '/inventory', icon: <TrendingUp className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Finance & Accounts',
      items: [
        { label: 'Tax Invoices', path: '/invoices', icon: <FileText className="w-[18px] h-[18px]" /> },
        { label: 'Payments & Ledger', path: '/payments', icon: <CreditCard className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Purchasing',
      items: [
        { label: 'Suppliers & Vendors', path: '/suppliers', icon: <Truck className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { label: 'ATLAS AI Assistant', path: '/ai', icon: <Sparkles className="w-[18px] h-[18px] text-atlas-600" /> },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Team & Access', path: '/team', icon: <Users className="w-[18px] h-[18px]" /> },
        { label: 'Audit Trail', path: '/audit', icon: <ShieldCheck className="w-[18px] h-[18px]" /> },
        { label: 'Org Settings', path: '/settings', icon: <Building2 className="w-[18px] h-[18px]" /> },
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
      <div className="flex h-16 items-center justify-between px-4 border-b border-border/80 shrink-0">
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
        <div className="mx-3.5 mt-3 p-3 rounded-xl bg-surface-panel border border-border shadow-xs shrink-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-xs font-bold text-content-primary truncate">
              {currentOrg.name}
            </span>
            <Badge variant={getRoleBadgeVariant(currentRole)} size="sm" className="shrink-0">
              {currentRole}
            </Badge>
          </div>
          <div className="text-[11px] text-content-secondary truncate">
            {currentOrg.city ? `${currentOrg.city}, ${currentOrg.state}` : 'Karnataka, India'}
          </div>
        </div>
      )}

      {/* Navigation list */}
      <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
        {navGroups.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <h5 className="px-2.5 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-content-secondary/75">
                {group.title}
              </h5>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-all duration-150 ${
                        isActive
                          ? 'bg-atlas-100 text-atlas-900 font-semibold shadow-xs'
                          : 'font-medium text-content-secondary hover:bg-atlas-50 hover:text-content-primary'
                      } ${collapsed ? 'justify-center px-0' : ''}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`shrink-0 transition-colors ${
                            isActive ? 'text-atlas-700' : 'text-content-muted'
                          }`}
                        >
                          {item.icon}
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom status */}
      <div className="p-3.5 border-t border-border bg-surface-panel/60 shrink-0">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {!collapsed && (
              <span className="text-xs font-semibold text-content-secondary">
                Operational Ledger
              </span>
            )}
          </div>
          {!collapsed && (
            <span className="text-[11px] text-content-muted font-mono font-medium">v0.1.0</span>
          )}
        </div>
      </div>
    </aside>
  );
};
