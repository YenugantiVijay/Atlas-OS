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
  X,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useOrg } from '@/features/organizations/OrgContext';
import { Badge } from '@/components/ui/Badge';
import { getRoleBadgeVariant, hasPermission, Action } from '@/lib/permissions';
import { getSupabaseStatus } from '@/lib/supabase';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  action?: Action;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const { currentOrg, currentRole } = useOrg();
  const supabaseStatus = getSupabaseStatus();

  const rawNavGroups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
      ],
    },
    {
      title: 'Sales Operations',
      items: [
        { label: 'Sales Orders', path: '/orders', icon: <FileText className="w-[18px] h-[18px]" />, action: 'data:read' },
        { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'data:read' },
        { label: 'Customers', path: '/customers', icon: <Users className="w-[18px] h-[18px]" />, action: 'data:read' },
      ],
    },
    {
      title: 'Inventory & Stock',
      items: [
        { label: 'Products & SKUs', path: '/products', icon: <Boxes className="w-[18px] h-[18px]" />, action: 'data:read' },
        { label: 'Stock Movements', path: '/inventory', icon: <TrendingUp className="w-[18px] h-[18px]" />, action: 'data:read' },
      ],
    },
    {
      title: 'Finance & Accounts',
      items: [
        { label: 'Tax Invoices', path: '/invoices', icon: <FileText className="w-[18px] h-[18px]" />, action: 'data:read' },
        { label: 'Payments & Ledger', path: '/payments', icon: <CreditCard className="w-[18px] h-[18px]" />, action: 'data:read' },
      ],
    },
    {
      title: 'Purchasing',
      items: [
        { label: 'Suppliers & Vendors', path: '/suppliers', icon: <Truck className="w-[18px] h-[18px]" />, action: 'data:read' },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { label: 'ATLAS AI Assistant', path: '/ai', icon: <Sparkles className="w-[18px] h-[18px] text-atlas-600" />, action: 'data:read' },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Team & Access', path: '/team', icon: <Users className="w-[18px] h-[18px]" />, action: 'members:manage' },
        { label: 'Audit Trail', path: '/audit', icon: <ShieldCheck className="w-[18px] h-[18px]" />, action: 'audit:read' },
        { label: 'Org Settings', path: '/settings', icon: <Building2 className="w-[18px] h-[18px]" />, action: 'org:manage' },
      ],
    },
  ];

  const navGroups = rawNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.action || hasPermission(currentRole, item.action)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden animate-in fade-in duration-150"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 flex flex-col border-r border-border bg-surface-card transition-all duration-200 select-none ${
          // Mobile: drawer that translates in/out
          isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'
        } ${
          // Desktop: width depends on collapsed state
          collapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-border shrink-0">
          <BrandLogo collapsed={collapsed} />

          {/* Desktop Collapse Toggle */}
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-content-muted hover:bg-slate-100 hover:text-content-primary transition-colors hidden lg:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="rounded-lg p-1.5 text-content-muted hover:bg-slate-100 hover:text-content-primary transition-colors lg:hidden"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tenant Indicator */}
        {(!collapsed || isMobileOpen) && currentOrg && (
          <div className="mx-3.5 mt-3 p-3 rounded-xl bg-slate-50 border border-border shadow-xs shrink-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-xs font-bold text-content-primary truncate">
                {currentOrg.name}
              </span>
              <Badge variant={getRoleBadgeVariant(currentRole)} size="sm" className="shrink-0">
                {currentRole || 'No Role'}
              </Badge>
            </div>
            <div className="text-xs text-content-secondary truncate">
              {[currentOrg.city, currentOrg.state].filter(Boolean).join(', ') || 'Location not set'}
            </div>
          </div>
        )}

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              {(!collapsed || isMobileOpen) && (
                <h5 className="px-2.5 mb-1.5 text-2xs font-semibold uppercase tracking-wider text-content-muted select-none">
                  {group.title}
                </h5>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      onClick={() => {
                        if (isMobileOpen && onCloseMobile) {
                          onCloseMobile();
                        }
                      }}
                      title={collapsed && !isMobileOpen ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
                          isActive
                            ? 'bg-atlas-50 text-atlas-900 font-medium border border-atlas-200/80 shadow-2xs'
                            : 'font-normal text-content-secondary hover:bg-slate-100/80 hover:text-content-primary'
                        } ${collapsed && !isMobileOpen ? 'justify-center px-0' : ''}`
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
                          {(!collapsed || isMobileOpen) && (
                            <span className="truncate">{item.label}</span>
                          )}
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
        <div className="p-3.5 border-t border-border bg-slate-50/70 shrink-0">
          <div className={`flex items-center ${collapsed && !isMobileOpen ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  supabaseStatus.configured ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              {(!collapsed || isMobileOpen) && (
                <span className="text-xs font-medium text-content-secondary truncate max-w-[140px]">
                  {supabaseStatus.configured ? 'Supabase Connected' : 'Local Deterministic'}
                </span>
              )}
            </div>
            {(!collapsed || isMobileOpen) && (
              <span className="text-xs text-content-muted font-mono font-medium">v0.1.0</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
