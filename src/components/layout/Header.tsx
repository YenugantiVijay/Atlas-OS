import React, { useState } from 'react';
import {
  Search,
  Plus,
  Building2,
  ChevronDown,
  Database,
  Check,
  Shield,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { getSupabaseStatus } from '@/lib/supabase';
import { getRoleBadgeVariant } from '@/lib/permissions';

export interface HeaderProps {
  collapsed: boolean;
  onOpenCommandPalette: () => void;
  onOpenQuickCreate: (type?: string) => void;
  onOpenNewOrgModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  collapsed,
  onOpenCommandPalette,
  onOpenQuickCreate,
  onOpenNewOrgModal,
}) => {
  const { currentOrg, organizations, switchOrganization, currentRole } = useOrg();
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const supabaseStatus = getSupabaseStatus();

  return (
    <header
      className={`fixed top-0 right-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface-card/90 backdrop-blur-md px-6 transition-all duration-200 ${
        collapsed ? 'left-20' : 'left-64'
      }`}
    >
      {/* Left: Organization Selector */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface-panel px-3 py-1.5 text-xs font-semibold text-content-primary hover:border-atlas-300 hover:bg-atlas-50/50 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5 text-atlas-600" />
            <span className="max-w-[180px] truncate">{currentOrg?.name || 'Select Organization'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
          </button>

          {isOrgDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsOrgDropdownOpen(false)}
              />
              <div className="absolute left-0 mt-1.5 w-64 rounded-xl border border-border bg-surface-card p-1.5 shadow-dropdown z-50 animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                  Organizations
                </div>
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => {
                      switchOrganization(org.id);
                      setIsOrgDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-xs text-left transition-colors ${
                      org.id === currentOrg?.id
                        ? 'bg-atlas-100 text-atlas-900 font-semibold'
                        : 'text-content-primary hover:bg-surface-panel'
                    }`}
                  >
                    <div className="truncate">
                      <div className="truncate font-medium">{org.name}</div>
                      <div className="text-[10px] text-content-secondary truncate">{org.city || 'India'}</div>
                    </div>
                    {org.id === currentOrg?.id && <Check className="w-4 h-4 text-atlas-600 shrink-0" />}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    setIsOrgDropdownOpen(false);
                    onOpenNewOrgModal();
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-atlas-700 font-medium hover:bg-atlas-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create New Organization</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Backend status badge */}
        <div
          title={supabaseStatus.message}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-panel border border-border text-[11px] text-content-secondary font-medium cursor-help"
        >
          <Database className={`w-3 h-3 ${supabaseStatus.configured ? 'text-emerald-500' : 'text-atlas-500'}`} />
          <span>{supabaseStatus.configured ? 'Supabase Live' : 'Deterministic Storage Engine'}</span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        {/* Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface-panel px-3 py-1.5 text-xs text-content-muted hover:border-atlas-300 hover:text-content-primary transition-colors shadow-xs"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Search or jump to...</span>
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-surface-card border border-border font-mono text-[10px] text-content-secondary">
            Ctrl+K
          </kbd>
        </button>

        {/* Quick Create Dropdown */}
        <div className="relative">
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsQuickCreateOpen(!isQuickCreateOpen)}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            <span className="hidden sm:inline">Quick Create</span>
          </Button>

          {isQuickCreateOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsQuickCreateOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-border bg-surface-card p-1 shadow-dropdown z-50">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                  Create Record
                </div>
                {[
                  { label: 'New Product', type: 'product' },
                  { label: 'New Customer', type: 'customer' },
                  { label: 'New Quotation', type: 'quotation' },
                  { label: 'New Sales Order', type: 'order' },
                  { label: 'Record Payment', type: 'payment' },
                ].map((act) => (
                  <button
                    key={act.type}
                    onClick={() => {
                      setIsQuickCreateOpen(false);
                      onOpenQuickCreate(act.type);
                    }}
                    className="w-full flex items-center px-2.5 py-2 text-xs rounded-lg text-content-primary hover:bg-atlas-50 hover:text-atlas-800 text-left transition-colors font-medium"
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* User profile avatar & menu */}
        <div className="relative">
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex items-center gap-2 pl-2 border-l border-border hover:opacity-85 transition-opacity"
          >
            <div className="w-8 h-8 rounded-full bg-atlas-200 text-atlas-800 font-bold text-xs flex items-center justify-center border border-atlas-300">
              VK
            </div>
          </button>

          {isUserMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsUserMenuOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-surface-card p-2 shadow-dropdown z-50">
                <div className="px-3 py-2 border-b border-border/80 mb-1">
                  <div className="text-xs font-semibold text-content-primary">Vijay Kumar</div>
                  <div className="text-[11px] text-content-secondary truncate">
                    vijay@srilakshmielectricals.in
                  </div>
                  <div className="mt-1">
                    <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
                      {currentRole}
                    </Badge>
                  </div>
                </div>

                <div className="text-xs space-y-0.5">
                  <a
                    href="#/settings"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-content-primary hover:bg-surface-panel"
                  >
                    <Building2 className="w-3.5 h-3.5 text-content-secondary" />
                    <span>Organization Settings</span>
                  </a>
                  <a
                    href="#/team"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-content-primary hover:bg-surface-panel"
                  >
                    <Shield className="w-3.5 h-3.5 text-content-secondary" />
                    <span>Team & Memberships</span>
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
