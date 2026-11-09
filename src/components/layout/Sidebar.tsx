import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  ClipboardList,
  FileText,
  FileSpreadsheet,
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
  ChevronDown,
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
  collapsible?: boolean;
  items: NavItem[];
}

const NAV_GROUPS_CONFIG: NavGroup[] = [
  {
    title: 'Overview',
    collapsible: false,
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    title: 'Sales',
    collapsible: true,
    items: [
      { label: 'Retail Counter', path: '/pos', icon: <ShoppingCart className="w-[18px] h-[18px]" />, action: 'orders:create' },
      { label: 'Sales Orders', path: '/orders', icon: <FileText className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Tax Invoices', path: '/invoices', icon: <FileText className="w-[18px] h-[18px]" />, action: 'reports:financial' },
      { label: 'Customers', path: '/customers', icon: <Users className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'Inventory',
    collapsible: true,
    items: [
      { label: 'Products & SKUs', path: '/products', icon: <Boxes className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Stock Movements', path: '/inventory', icon: <TrendingUp className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Suppliers & Vendors', path: '/suppliers', icon: <Truck className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'Finance',
    collapsible: true,
    items: [
      { label: 'Payments & Ledger', path: '/payments', icon: <CreditCard className="w-[18px] h-[18px]" />, action: 'reports:financial' },
      { label: 'Sales & Receipts', path: '/reports/sales-receipts', icon: <FileSpreadsheet className="w-[18px] h-[18px]" />, action: 'reports:financial' },
    ],
  },
  {
    title: 'Intelligence',
    collapsible: false,
    items: [
      { label: 'ATLAS AI Assistant', path: '/ai', icon: <Sparkles className="w-[18px] h-[18px] text-teal-400" />, action: 'data:read' },
    ],
  },
  {
    title: 'Administration',
    collapsible: true,
    items: [
      { label: 'Team & Access', path: '/team', icon: <Users className="w-[18px] h-[18px]" />, action: 'members:manage' },
      { label: 'Audit Trail', path: '/audit', icon: <ShieldCheck className="w-[18px] h-[18px]" />, action: 'audit:read' },
      { label: 'Org Settings', path: '/settings', icon: <Building2 className="w-[18px] h-[18px]" />, action: 'org:manage' },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const { currentOrg, currentRole } = useOrg();
  const supabaseStatus = getSupabaseStatus();
  const { pathname } = useLocation();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Strictly filter by authorized permissions; roles cannot see links without permission
  const authorizedGroups = useMemo(
    () =>
      NAV_GROUPS_CONFIG
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.action || hasPermission(currentRole, item.action)),
        }))
        .filter((group) => group.items.length > 0),
    [currentRole]
  );

  // Automatically keep the active route's group open
  useEffect(() => {
    const activeGroup = authorizedGroups.find((group) =>
      group.items.some((item) => item.path === pathname)
    );
    if (activeGroup && activeGroup.collapsible) {
      setExpandedSections((prev) =>
        prev[activeGroup.title] === true ? prev : { ...prev, [activeGroup.title]: true }
      );
    }
  }, [pathname, authorizedGroups]);

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
        className={`fixed top-0 bottom-0 left-0 z-40 flex flex-col border-r border-[#0F1E36] bg-[#142B4D] transition-all duration-200 select-none ${
          // Mobile: drawer that translates in/out
          isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'
        } ${
          // Desktop: width depends on collapsed state
          collapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`flex h-16 items-center border-b border-white/10 shrink-0 ${
            collapsed && !isMobileOpen ? 'justify-between px-3' : 'justify-between px-4'
          }`}
        >
          <BrandLogo collapsed={collapsed && !isMobileOpen} variant="dark" />

          {/* Desktop Collapse Toggle */}
          <button
            onClick={onToggle}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors hidden lg:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors lg:hidden"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tenant Indicator */}
        {(!collapsed || isMobileOpen) && currentOrg && (
          <div className="mx-3.5 mt-3 p-3 rounded-xl bg-white/5 border border-white/10 shadow-xs shrink-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="text-xs font-bold text-white truncate">
                {currentOrg.name}
              </span>
              <Badge variant={getRoleBadgeVariant(currentRole)} size="sm" className="shrink-0">
                {currentRole || 'No Role'}
              </Badge>
            </div>
            <div className="text-xs text-slate-300 truncate">
              {[currentOrg.city, currentOrg.state].filter(Boolean).join(', ') || 'Location not set'}
            </div>
          </div>
        )}

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-4">
          {authorizedGroups.map((group) => {
            const isCollapsible = Boolean(group.collapsible && (!collapsed || isMobileOpen));
            const isExpanded =
              expandedSections[group.title] ?? group.items.some((item) => item.path === pathname);
            const sectionSlug = group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

            return (
              <div key={group.title} className="space-y-1">
                {isCollapsible ? (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`section-${sectionSlug}`}
                    onClick={() =>
                      setExpandedSections((prev) => ({ ...prev, [group.title]: !isExpanded }))
                    }
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                  >
                    <span>{group.title}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180 text-teal-300' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                ) : (!collapsed || isMobileOpen) && group.collapsible === false && group.items.length > 1 ? (
                  <h5 className="px-2.5 mb-1 text-2xs font-bold uppercase tracking-wider text-slate-400 select-none">
                    {group.title}
                  </h5>
                ) : null}

                <ul
                  id={isCollapsible ? `section-${sectionSlug}` : undefined}
                  hidden={isCollapsible && !isExpanded}
                  className={`space-y-1 ${isCollapsible && !isExpanded ? 'hidden' : ''} ${
                    isCollapsible ? 'pl-1' : ''
                  }`}
                >
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
                              ? 'bg-atlas-50 text-atlas-900 font-semibold border border-teal-200/80 shadow-xs'
                              : 'font-normal text-slate-300 hover:bg-white/10 hover:text-white'
                          } ${collapsed && !isMobileOpen ? 'justify-center px-0' : ''}`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span
                              className={`shrink-0 transition-colors ${
                                isActive ? 'text-teal-700' : 'text-slate-400 group-hover:text-white'
                              }`}
                            >
                              {item.icon}
                            </span>
                            {(!collapsed || isMobileOpen) && <span className="truncate">{item.label}</span>}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Bottom status */}
        <div className="p-3.5 border-t border-white/10 bg-black/20 shrink-0">
          <div className={`flex items-center ${collapsed && !isMobileOpen ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  supabaseStatus.configured ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              {(!collapsed || isMobileOpen) && (
                <span className="text-xs font-medium text-slate-300 truncate max-w-[140px]">
                  {supabaseStatus.configured ? 'Supabase Connected' : 'Local Deterministic'}
                </span>
              )}
            </div>
            {(!collapsed || isMobileOpen) && (
              <span className="text-xs text-slate-400 font-mono font-medium">v0.1.0</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
