import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
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
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useOrg } from '@/features/organizations/OrgContext';
import { Badge } from '@/components/ui/Badge';
import { getRoleBadgeVariant, hasPermission, Action } from '@/lib/permissions';
import { getSupabaseStatus } from '@/lib/supabase';
import {
  ESSENTIAL_WORKSPACE_GROUPS,
  getWorkspaceViewStorageKey,
  loadWorkspaceView,
  saveWorkspaceView,
  WorkspaceView,
} from '@/lib/workspace-view';

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
  const { currentOrg, currentRole, currentUser, isDemoMode } = useOrg();
  const supabaseStatus = getSupabaseStatus();
  const { pathname } = useLocation();
  const [expandedSimpleSections, setExpandedSimpleSections] = useState<Record<string, boolean>>({});

  const preferenceKey = useMemo(
    () => getWorkspaceViewStorageKey(currentOrg?.id, currentUser?.id, isDemoMode),
    [currentOrg?.id, currentUser?.id, isDemoMode]
  );
  const [savedPreference, setSavedPreference] = useState<{
    key: string;
    view: WorkspaceView;
  } | null>(null);
  // When organization or user changes, immediately use that identity's own
  // preference; no previous tenant's UI preference is carried across.
  const workspaceView = savedPreference?.key === preferenceKey
    ? savedPreference.view
    : loadWorkspaceView(preferenceKey);

  const updateWorkspaceView = (view: WorkspaceView) => {
    saveWorkspaceView(preferenceKey, view);
    setSavedPreference({ key: preferenceKey, view });
  };

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
        { label: 'Tax Invoices', path: '/invoices', icon: <FileText className="w-[18px] h-[18px]" />, action: 'reports:financial' },
        { label: 'Payments & Ledger', path: '/payments', icon: <CreditCard className="w-[18px] h-[18px]" />, action: 'reports:financial' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { label: 'Sales & Receipts', path: '/reports/sales-receipts', icon: <FileSpreadsheet className="w-[18px] h-[18px]" />, action: 'reports:financial' },
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

  // Authorization always comes first; neither view introduces new access.
  const authorizedGroups = rawNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.action || hasPermission(currentRole, item.action)),
    }))
    .filter((group) => group.items.length > 0);

  const authorizedItems = new Map(
    authorizedGroups.flatMap((group) => group.items.map((item) => [item.path, item] as const))
  );
  const essentialGroups: NavGroup[] = ESSENTIAL_WORKSPACE_GROUPS
    .map((group) => ({
      title: group.title,
      items: group.paths
        .map((path) => authorizedItems.get(path))
        .filter((item): item is NavItem => item !== undefined),
    }))
    .filter((group) => group.items.length > 0);

  const navGroups = workspaceView === 'essentials' ? essentialGroups : authorizedGroups;

  // Keep the active route discoverable when users navigate via a deep link
  // or universal command palette. This changes no authorization.
  useEffect(() => {
    const active = ESSENTIAL_WORKSPACE_GROUPS.find((group) => group.paths.includes(pathname));
    if (active && active.paths.length > 1) {
      setExpandedSimpleSections((prev) =>
        prev[active.title] === true ? prev : { ...prev, [active.title]: true }
      );
    }
  }, [pathname]);

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
        <div className="flex h-16 items-center justify-between px-4 border-b border-white/10 shrink-0">
          <BrandLogo collapsed={collapsed} variant="dark" />

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

        {/* Navigation density is independent of subscriptions and permissions. */}
        <div className="shrink-0 px-3.5 pt-3">
          {(!collapsed || isMobileOpen) ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5">
              <SlidersHorizontal className="w-4 h-4 shrink-0 text-teal-200" aria-hidden="true" />
              <label htmlFor="atlas-navigation-layout" className="sr-only">Navigation layout</label>
              <select
                id="atlas-navigation-layout"
                value={workspaceView}
                onChange={(event) => updateWorkspaceView(event.target.value as WorkspaceView)}
                title="Change the menu layout; subscription and permissions stay the same"
                className="w-full min-w-0 cursor-pointer rounded-md bg-[#243B53] px-2 py-1.5 text-xs font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                <option value="essentials">Simple View</option>
                <option value="all">Full Navigation</option>
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => updateWorkspaceView(workspaceView === 'essentials' ? 'all' : 'essentials')}
              aria-label={workspaceView === 'essentials' ? 'Show full navigation' : 'Show simple navigation'}
              title={workspaceView === 'essentials' ? 'Full Navigation' : 'Simple View'}
              className="flex w-full justify-center rounded-lg p-2.5 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              <SlidersHorizontal className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
          {navGroups.map((group) => {
            const simple = workspaceView === 'essentials' && (!collapsed || isMobileOpen);
            const expandable = simple && group.items.length > 1;
            const expanded = expandedSimpleSections[group.title] ?? group.items.some((item) => item.path === pathname);
            return (
              <div key={group.title}>
                {expandable ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`simple-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                    onClick={() => setExpandedSimpleSections((prev) => ({ ...prev, [group.title]: !expanded }))}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                  >
                    <span>{group.title}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                ) : (!collapsed || isMobileOpen) && !simple ? (
                  <h5 className="px-2.5 mb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400 select-none">
                    {group.title}
                  </h5>
                ) : null}
                <ul
                  id={expandable ? `simple-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}` : undefined}
                  hidden={expandable && !expanded}
                  className={`space-y-1 ${expandable && !expanded ? 'hidden' : ''} ${expandable ? 'pl-2' : ''}`}
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
