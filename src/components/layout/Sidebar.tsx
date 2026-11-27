import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  GraduationCap,
  LifeBuoy,
  ShoppingCart,
  ShoppingBag,
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
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  PackagePlus,
  TrendingUpDown,
  FileCode,
  X,
  Clock3,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useOrg } from '@/features/organizations/OrgContext';
import { Badge } from '@/components/ui/Badge';
import { getRoleBadgeVariant, hasPermission, Action } from '@/lib/permissions';
import { getSupabaseStatus } from '@/lib/supabase';
import { showsIndustryNavigation, useIndustryTool } from '@/hooks/useIndustryTool';
import { useAttendanceAccess } from '@/hooks/useAttendanceAccess';

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
  attendance?: boolean;
}

interface NavGroup {
  title: string;
  showHeading?: boolean;
  items: NavItem[];
}

const NAV_GROUPS_CONFIG: NavGroup[] = [
  {
    title: 'Overview',
    showHeading: false,
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
      { label: 'Print Job Board', path: '/studio-jobs', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Stall Counter', path: '/ice-cream-counter', icon: <ShoppingCart className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Distribution Desk', path: '/cold-chain', icon: <Truck className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'School Management', path: '/school', icon: <GraduationCap className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'My Portals', path: '/portals', icon: <Users className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Support', path: '/support', icon: <LifeBuoy className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    title: 'Sales',
    showHeading: true,
    items: [
      { label: 'Retail Counter', path: '/pos', icon: <ShoppingCart className="w-[18px] h-[18px]" />, action: 'orders:create' },
      { label: 'Counter Shift', path: '/counter-shift', icon: <Clock3 className="w-[18px] h-[18px]" />, action: 'orders:create' },
      { label: 'E-commerce Orders', path: '/ecommerce', icon: <ShoppingBag className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Sales Orders', path: '/orders', icon: <FileText className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Quotations', path: '/quotations', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Tax Invoices', path: '/invoices', icon: <FileText className="w-[18px] h-[18px]" />, action: 'reports:financial' },
      { label: 'Customers', path: '/customers', icon: <Users className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'Inventory',
    showHeading: true,
    items: [
      { label: 'Products & SKUs', path: '/products', icon: <Boxes className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Stock Count & Expiry', path: '/stock-count', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Stock Movements', path: '/inventory', icon: <TrendingUp className="w-[18px] h-[18px]" />, action: 'data:read' },
      { label: 'Purchase Orders', path: '/purchase-orders', icon: <ClipboardList className="w-[18px] h-[18px]" />, action: 'inventory:receive' },
      { label: 'Goods Receiving', path: '/receiving', icon: <PackagePlus className="w-[18px] h-[18px]" />, action: 'inventory:receive' },
      { label: 'Supplier Price History', path: '/supplier-prices', icon: <TrendingUpDown className="w-[18px] h-[18px]" />, action: 'supplier-prices:read' },
      { label: 'Suppliers & Vendors', path: '/suppliers', icon: <Truck className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'Finance',
    showHeading: true,
    items: [
      { label: 'Payments & Ledger', path: '/payments', icon: <CreditCard className="w-[18px] h-[18px]" />, action: 'reports:financial' },
      { label: 'Sales & Receipts', path: '/reports/sales-receipts', icon: <FileSpreadsheet className="w-[18px] h-[18px]" />, action: 'reports:financial' },
    ],
  },
  {
    title: 'Intelligence',
    showHeading: false,
    items: [
      { label: 'ATLAS AI Assistant', path: '/ai', icon: <Sparkles className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'People',
    showHeading: true,
    items: [
      { label: 'Employee Attendance', path: '/attendance/my', icon: <CalendarCheck className="w-[18px] h-[18px]" />, action: 'data:read' },
    ],
  },
  {
    title: 'Administration',
    showHeading: true,
    items: [
      { label: 'Team & Access', path: '/team', icon: <Users className="w-[18px] h-[18px]" />, action: 'members:manage' },

      { label: 'Staff Attendance', path: '/attendance', icon: <CalendarCheck className="w-[18px] h-[18px]" />, attendance: true },
      { label: 'Audit Trail', path: '/audit', icon: <ShieldCheck className="w-[18px] h-[18px]" />, action: 'audit:read' },
      { label: 'India Ecosystem', path: '/integrations', icon: <FileCode className="w-[18px] h-[18px]" />, action: 'org:manage' },
      { label: 'Org Settings', path: '/settings', icon: <Building2 className="w-[18px] h-[18px]" />, action: 'org:manage' },
    ],
  },
];

export function Sidebar(props: SidebarProps) {
  const { isAuthenticated, isDemoMode } = useOrg();
  return isAuthenticated && !isDemoMode ? <CloudSidebar {...props} /> : <SidebarNavigation {...props} />;
}

function CloudSidebar(props: SidebarProps) {
  const { data, isError } = useAttendanceAccess();
  return <SidebarNavigation {...props} showAttendance={data === true && !isError} />;
}

const SidebarNavigation: React.FC<SidebarProps & { showAttendance?: boolean }> = ({
  collapsed,
  onToggle,
  isMobileOpen = false,
  onCloseMobile,
  showAttendance = false,
}) => {
  const { currentOrg, currentRole } = useOrg();
  const supabaseStatus = getSupabaseStatus();
  const tool = useIndustryTool();
  const toolId = tool?.id;
  const iconOnly = collapsed && !isMobileOpen;

  // Strictly filter by authorized permissions; roles cannot see links without permission
  const authorizedGroups = useMemo(
    () =>
      NAV_GROUPS_CONFIG
        .map((group) => ({
          ...group,
          items: group.items.filter(item => showsIndustryNavigation(toolId, item.path) &&
            (item.attendance ? showAttendance : !item.action || hasPermission(currentRole, item.action))),
        }))
        .filter((group) => group.items.length > 0),
    [currentRole, showAttendance, toolId]
  );

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden motion-safe:animate-in motion-safe:fade-in duration-150"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex max-w-full select-none flex-col border-r border-slate-200 bg-[#f4f5fb] transition-[transform,width] duration-200 motion-reduce:transition-none ${
          // Mobile: drawer that translates in/out
          isMobileOpen ? 'visible w-72 translate-x-0 shadow-xl lg:shadow-none' : 'invisible -translate-x-full lg:visible lg:translate-x-0'
        } ${
          // Desktop: width depends on collapsed state
          collapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        {/* Brand Header */}
        <div
          className={`flex h-16 shrink-0 items-center justify-between gap-1 border-b border-slate-200 bg-white/80 ${iconOnly ? 'px-2' : 'px-4'}`}
        >
          <BrandLogo collapsed={iconOnly} />

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={onToggle}
            className="hidden shrink-0 rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-700 lg:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-700 lg:hidden"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tenant Indicator */}
        {!iconOnly && currentOrg && (
          <div className="mx-3 mt-3 shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold text-navy-800">
                {currentOrg.name}
              </span>
              <Badge variant={getRoleBadgeVariant(currentRole)} size="sm" className="shrink-0">
                {currentRole || 'No Role'}
              </Badge>
            </div>
            {tool && <p className="mb-1 text-xs font-semibold text-atlas-800">{tool.name}</p>}
            <div className="truncate text-xs text-slate-600">
              {[currentOrg.city, currentOrg.state].filter(Boolean).join(', ') || 'Location not set'}
            </div>
          </div>
        )}

        {/* Navigation list */}
        <nav aria-label="Workspace navigation" className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-3 ${iconOnly ? 'px-2' : 'px-3'}`}>
          {authorizedGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              {!iconOnly && group.showHeading !== false && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                  {group.title}
                </p>
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
                      title={iconOnly ? item.label : undefined}
                      aria-label={iconOnly ? item.label : undefined}
                      className={({ isActive }) =>
                        `group relative flex min-h-10 items-center gap-2.5 rounded-lg border text-sm transition-colors focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-700 ${
                          isActive
                            ? 'border-atlas-200 bg-atlas-100/70 font-semibold text-atlas-900 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-atlas-700 before:content-[""]'
                            : 'border-transparent font-medium text-slate-700 hover:bg-slate-200/70 hover:text-navy-800'
                        } ${iconOnly ? 'justify-center px-0' : 'px-3'}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden="true"
                            className={`shrink-0 transition-colors ${
                              isActive ? 'text-atlas-700' : 'text-slate-600 group-hover:text-navy-800'
                            }`}
                          >
                            {item.icon}
                          </span>
                          {!iconOnly && <span className="truncate">{item.label}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom status */}
        <div className="shrink-0 border-t border-slate-200 bg-white/80 p-3.5">
          <div className={`flex items-center gap-2 ${iconOnly ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  supabaseStatus.configured ? 'bg-emerald-700' : 'bg-slate-500'
                }`}
                aria-hidden="true"
              />
              {!iconOnly && (
                <span className="max-w-[140px] truncate text-xs font-medium text-slate-700">
                  {supabaseStatus.configured ? 'Supabase Connected' : 'Local Deterministic'}
                </span>
              )}
            </div>
            {!iconOnly && (
              <span className="font-mono text-xs font-medium text-slate-600">v0.1.0</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
