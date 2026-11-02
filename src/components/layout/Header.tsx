import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Search,
  Plus,
  Building2,
  ChevronDown,
  Check,
  Shield,
  Camera,
  User as UserIcon,
  Save,
  Menu,
  LogOut,
  Sparkles,
  Cloud,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { useToast } from '@/components/ui/Toast';
import { getRoleBadgeVariant, hasPermission, Action } from '@/lib/permissions';
import { AuthModal } from '@/features/auth/AuthModal';

export interface HeaderProps {
  collapsed: boolean;
  onOpenCommandPalette: () => void;
  onOpenQuickCreate: (type?: string) => void;
  onOpenNewOrgModal: () => void;
  onToggleMobileMenu?: () => void;
}

const ROUTE_BREADCRUMBS: Record<string, { section?: string; label: string }> = {
  '/': { label: 'Dashboard' },
  '/orders': { section: 'Sales Operations', label: 'Sales Orders' },
  '/quotations': { section: 'Sales Operations', label: 'Quotations' },
  '/customers': { section: 'Sales Operations', label: 'Customers' },
  '/products': { section: 'Inventory & Stock', label: 'Products & SKUs' },
  '/inventory': { section: 'Inventory & Stock', label: 'Stock Movements' },
  '/invoices': { section: 'Finance & Accounts', label: 'Tax Invoices' },
  '/payments': { section: 'Finance & Accounts', label: 'Payments & Ledger' },
  '/suppliers': { section: 'Purchasing', label: 'Suppliers & Vendors' },
  '/ai': { section: 'Intelligence', label: 'ATLAS AI Assistant' },
  '/team': { section: 'Administration', label: 'Team & Access' },
  '/audit': { section: 'Administration', label: 'Audit Trail' },
  '/settings': { section: 'Administration', label: 'Org Settings' },
};

function getInitials(name?: string | null): string {
  if (!name || !name.trim() || name.trim().toLowerCase() === 'user') return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export const Header: React.FC<HeaderProps> = ({
  collapsed,
  onOpenCommandPalette,
  onOpenQuickCreate,
  onOpenNewOrgModal,
  onToggleMobileMenu,
}) => {
  const {
    currentOrg,
    organizations,
    switchOrganization,
    currentRole,
    currentUser,
    updateCurrentUser,
    isAuthenticated,
    isMockAuth,
    isLoadingAuth,
    signOut,
  } = useOrg();
  const { showToast } = useToast();
  const location = useLocation();

  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Dropdown container refs for detecting clicks anywhere outside on the site
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const quickCreateRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Profile Edit Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editFullName, setEditFullName] = useState(currentUser?.fullName || '');
  const [editEmail, setEditEmail] = useState(currentUser?.email || '');
  const [editAvatarUrl, setEditAvatarUrl] = useState(currentUser?.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const currentBreadcrumb = ROUTE_BREADCRUMBS[location.pathname] || { label: 'Dashboard' };

  const availableQuickActions = [
    { label: 'New Product', type: 'product', action: 'products:create' as Action },
    { label: 'New Customer', type: 'customer', action: 'customers:manage' as Action },
    { label: 'New Quotation', type: 'quotation', action: 'quotations:create' as Action },
    { label: 'New Sales Order', type: 'order', action: 'orders:create' as Action },
    { label: 'Record Payment', type: 'payment', action: 'payments:record' as Action },
  ].filter((act) => hasPermission(currentRole, act.action));

  // Global click-outside listener to close dropdowns when clicking anywhere on the site
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(target)) {
        setIsOrgDropdownOpen(false);
      }
      if (quickCreateRef.current && !quickCreateRef.current.contains(target)) {
        setIsQuickCreateOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOrgDropdownOpen(false);
        setIsQuickCreateOpen(false);
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (currentUser) {
      setEditFullName(currentUser.fullName || '');
      setEditEmail(currentUser.email || '');
      setEditAvatarUrl(currentUser.avatarUrl || '');
    } else {
      setEditFullName('');
      setEditEmail('');
      setEditAvatarUrl('');
    }
  }, [currentUser]);

  const handleOpenProfileModal = () => {
    setEditFullName(currentUser?.fullName || '');
    setEditEmail(currentUser?.email || '');
    setEditAvatarUrl(currentUser?.avatarUrl || '');
    setIsUserMenuOpen(false);
    setIsProfileModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFullName.trim()) {
      showToast('error', 'Name Required', 'Please enter your full name.');
      return;
    }

    setIsSavingProfile(true);
    try {
      await updateCurrentUser({
        fullName: editFullName.trim(),
        email: editEmail.trim(),
        avatarUrl: editAvatarUrl,
      });

      showToast('success', 'Profile Updated', 'Your profile details and image have been updated.');
      setIsProfileModalOpen(false);
    } catch (err: any) {
      showToast('error', 'Failed to update profile', err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <>
      <header
        className={`fixed top-0 right-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface-card/95 backdrop-blur-md px-4 sm:px-6 transition-all duration-200 left-0 ${
          collapsed ? 'lg:left-20' : 'lg:left-64'
        }`}
      >
        {/* Left: Hamburger & Organization Selector */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 mr-2">
          {onToggleMobileMenu && (
            <button
              type="button"
              onClick={onToggleMobileMenu}
              className="p-1.5 -ml-1 shrink-0 rounded-lg text-content-secondary hover:bg-slate-100 hover:text-content-primary lg:hidden focus-visible:ring-2 focus-visible:ring-atlas-500"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div ref={orgDropdownRef} className="relative min-w-0">
            <button
              onClick={() => {
                setIsOrgDropdownOpen((prev) => !prev);
                setIsQuickCreateOpen(false);
                setIsUserMenuOpen(false);
              }}
              aria-label={`Switch organization: ${currentOrg?.name || 'No organization selected'}`}
              aria-expanded={isOrgDropdownOpen}
              className={`flex w-full h-9 items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 text-xs font-semibold text-content-primary hover:border-slate-300 hover:bg-slate-100/70 transition-colors ${
                isOrgDropdownOpen ? 'border-atlas-400 bg-atlas-50 ring-2 ring-atlas-100' : ''
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-atlas-600 shrink-0" />
              <span className="max-w-[130px] sm:max-w-[180px] truncate">{currentOrg?.name || 'Select Organization'}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-content-muted transition-transform duration-200 ${isOrgDropdownOpen ? 'rotate-180 text-atlas-700' : ''}`} />
            </button>

            {isOrgDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-64 rounded-xl border border-border bg-surface-card p-1.5 shadow-dropdown z-50 animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-content-muted">
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
                      <div className="text-xs text-content-secondary truncate">
                        {[org.city, org.state].filter(Boolean).join(', ') || 'Location not set'}
                      </div>
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
            )}
          </div>

          {/* Backend / Cloud status badge */}
          <button
            type="button"
            onClick={() => !isAuthenticated && setIsAuthModalOpen(true)}
            title={
              isAuthenticated
                ? 'Connected to live Supabase cloud database'
                : 'Operating in local demo mode. Click to sign in to Supabase.'
            }
            className={`hidden md:flex h-9 items-center gap-1.5 px-3 rounded-full border text-xs font-medium transition-all ${
              isAuthenticated
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100 cursor-pointer'
            }`}
          >
            {isAuthenticated ? (
              <>
                <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                <span>Live Cloud</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Demo Mode · Sign In</span>
              </>
            )}
          </button>

          {/* Breadcrumb Trail (Desktop / Wide screen) */}
          <nav aria-label="Breadcrumb" className="hidden xl:flex items-center gap-1.5 text-xs text-content-secondary ml-3 pl-3 border-l border-border/70">
            {currentBreadcrumb.section && (
              <>
                <span className="text-content-muted font-medium">{currentBreadcrumb.section}</span>
                <span className="text-content-muted/60" aria-hidden="true">/</span>
              </>
            )}
            <span className="font-semibold text-content-primary">{currentBreadcrumb.label}</span>
          </nav>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Command Palette Trigger */}
          <button
            onClick={onOpenCommandPalette}
            aria-label="Search Atlas OS"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-slate-50 px-2.5 sm:px-3 text-xs text-content-secondary hover:border-slate-300 hover:text-content-primary transition-colors shadow-2xs"
          >
            <Search className="w-3.5 h-3.5 text-content-muted" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-surface-card border border-border font-mono text-2xs text-content-secondary">
              Ctrl+K
            </kbd>
          </button>

          {/* Quick Create Dropdown - role-aware */}
          {availableQuickActions.length > 0 && (
            <div ref={quickCreateRef} className="relative">
              <Button
                size="sm"
                variant="primary"
                aria-label="Quick Create"
                onClick={() => {
                  setIsQuickCreateOpen((prev) => !prev);
                  setIsOrgDropdownOpen(false);
                  setIsUserMenuOpen(false);
                }}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                <span className="hidden sm:inline">Quick Create</span>
              </Button>

              {isQuickCreateOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-border bg-surface-card p-1 shadow-dropdown z-50 animate-in fade-in zoom-in-95">
                  <div className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-content-muted">
                    Create Record
                  </div>
                  {availableQuickActions.map((act) => (
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
              )}
            </div>
          )}

          {/* User profile capsule trigger & menu */}
          <div ref={userMenuRef} className="relative pl-1">
            <button
              onClick={() => {
                setIsUserMenuOpen((prev) => !prev);
                setIsOrgDropdownOpen(false);
                setIsQuickCreateOpen(false);
              }}
              aria-label="User Profile & Shop Menu"
              aria-expanded={isUserMenuOpen}
              className={`flex h-9 items-center gap-2.5 px-1.5 sm:pr-3 rounded-full border border-border bg-slate-50 hover:bg-atlas-50 hover:border-atlas-300 transition-all shadow-2xs group cursor-pointer ${
                isUserMenuOpen ? 'ring-2 ring-atlas-200 border-atlas-400 bg-atlas-50' : ''
              }`}
              title="User Profile & Shop Menu"
            >
              {/* Left side: Profile pic (custom photo or initials) */}
              <div className="relative w-7 h-7 rounded-full overflow-hidden bg-atlas-200 text-atlas-800 font-bold text-2xs flex items-center justify-center border border-atlas-300 shadow-2xs shrink-0 group-hover:scale-105 transition-transform">
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.fullName || 'User avatar'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{getInitials(currentUser?.fullName || currentUser?.email || 'User')}</span>
                )}
              </div>

              {/* Right side: Top = Name of shop, Bottom = User name & role */}
              <div className="text-left hidden xl:flex flex-col justify-center min-w-0 pr-0.5">
                <div className="text-xs font-bold text-content-primary leading-tight truncate max-w-[140px] sm:max-w-[175px] group-hover:text-atlas-900">
                  {currentOrg?.name || 'Organization'}
                </div>
                <div className="text-xs font-medium text-content-secondary leading-tight truncate max-w-[140px] sm:max-w-[175px]">
                  {currentUser?.fullName || currentUser?.email || (isLoadingAuth ? 'Loading...' : 'User')} • <span className="capitalize text-atlas-700 font-semibold">{currentRole || 'No Role'}</span>
                </div>
              </div>

              {/* Dropdown Chevron */}
              <ChevronDown
                className={`hidden sm:block w-3.5 h-3.5 text-content-muted group-hover:text-atlas-700 shrink-0 transition-transform duration-200 ${
                  isUserMenuOpen ? 'rotate-180 text-atlas-700' : ''
                }`}
              />
            </button>

            {/* Profile Dropdown */}
            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl border border-border bg-surface-card p-3 shadow-dropdown z-50 animate-in fade-in zoom-in-95">
                {/* User Profile Header Card */}
                <div className="p-3 border border-border/70 rounded-xl bg-surface-panel/60 mb-2.5">
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12 rounded-full overflow-hidden bg-atlas-200 text-atlas-800 font-bold text-sm flex items-center justify-center border-2 border-atlas-300 shadow-sm shrink-0">
                      {currentUser?.avatarUrl ? (
                        <img
                          src={currentUser.avatarUrl}
                          alt={currentUser.fullName || 'User avatar'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{getInitials(currentUser?.fullName || currentUser?.email || 'User')}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-content-primary leading-tight truncate">
                        {currentUser?.fullName || (currentUser?.email ? currentUser.email.split('@')[0] : (isLoadingAuth ? 'Loading...' : 'User'))}
                      </div>
                      <div className="text-xs font-medium text-content-secondary truncate mt-0.5">
                        {currentUser?.email || (isLoadingAuth ? 'Loading account...' : 'No email set')}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
                          {currentRole || 'No Role'}
                        </Badge>
                        {currentOrg?.name && (
                          <span className="text-xs text-content-muted font-medium truncate max-w-[140px]">
                            {currentOrg.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions Navigation with increased text size */}
                <div className="space-y-1">
                  <button
                    onClick={handleOpenProfileModal}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-content-primary hover:bg-atlas-50 hover:text-atlas-900 transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-atlas-100 text-atlas-700 flex items-center justify-center group-hover:bg-atlas-200 group-hover:scale-105 transition-all shrink-0">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-content-primary group-hover:text-atlas-900">
                        Edit Profile & Photo
                      </div>
                      <div className="text-xs text-content-muted font-normal truncate">
                        Change avatar image, name & contact
                      </div>
                    </div>
                  </button>

                  {hasPermission(currentRole, 'org:manage') && (
                    <a
                      href="#/settings"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-content-primary hover:bg-atlas-50 hover:text-atlas-900 transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface-panel text-content-secondary flex items-center justify-center group-hover:bg-atlas-100 group-hover:text-atlas-700 transition-colors shrink-0 border border-border">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-content-primary group-hover:text-atlas-900">
                          Organization Settings
                        </div>
                        <div className="text-xs text-content-muted font-normal truncate">
                          Legal GSTIN, store address & business details
                        </div>
                      </div>
                    </a>
                  )}

                  {hasPermission(currentRole, 'members:manage') && (
                    <a
                      href="#/team"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-content-primary hover:bg-atlas-50 hover:text-atlas-900 transition-colors text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface-panel text-content-secondary flex items-center justify-center group-hover:bg-atlas-100 group-hover:text-atlas-700 transition-colors shrink-0 border border-border">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-content-primary group-hover:text-atlas-900">
                          Team & Memberships
                        </div>
                        <div className="text-xs text-content-muted font-normal truncate">
                          Invite staff, manage roles & RBAC permissions
                        </div>
                      </div>
                    </a>
                  )}

                  {/* Auth Actions: Sign Out or Sign In */}
                  <div className="pt-2 border-t border-border mt-2">
                    {isAuthenticated ? (
                      <button
                        onClick={async () => {
                          setIsUserMenuOpen(false);
                          await signOut();
                          showToast('info', 'Signed Out', 'You have been disconnected from Supabase.');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center group-hover:bg-rose-200 transition-colors shrink-0">
                          <LogOut className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-rose-700">Sign Out</div>
                          <div className="text-xs text-rose-500 font-normal truncate">
                            Disconnect active Supabase session
                          </div>
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setIsAuthModalOpen(true);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold text-atlas-700 hover:bg-atlas-50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-atlas-100 text-atlas-700 flex items-center justify-center group-hover:bg-atlas-200 transition-colors shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-atlas-900">Sign In to Cloud</div>
                          <div className="text-xs text-content-muted font-normal truncate">
                            Switch from Demo to Live Supabase
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Edit Profile & Photo Modal */}
      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        title="Edit Profile & Avatar"
        description="Update your personal account credentials and profile photo displayed in ATLAS OS."
        maxWidth="md"
      >
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <ImageUpload
            label="Profile Photo"
            value={editAvatarUrl}
            onChange={setEditAvatarUrl}
            shape="circle"
            helperText="Upload a square or circular profile avatar (Optional)"
          />

          <Input
            label="Full Name"
            required
            value={editFullName}
            onChange={(e) => setEditFullName(e.target.value)}
            placeholder="Enter your full name"
            leftIcon={<UserIcon className="w-4 h-4" />}
          />

          <Input
            label="Email Address"
            type="email"
            required
            disabled={!isMockAuth}
            helperText={!isMockAuth ? 'Your sign-in email cannot be changed from this profile form.' : undefined}
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="Enter your email address"
          />

          <div className="p-3 rounded-xl bg-surface-panel border border-border text-xs flex items-center justify-between">
            <div>
              <span className="font-semibold text-content-primary block">Active Business Shop</span>
              <span className="text-content-secondary">{currentOrg?.name || 'Organization'}</span>
            </div>
            <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
              {currentRole || 'No Role'}
            </Badge>
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsProfileModalOpen(false)}
              disabled={isSavingProfile}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSavingProfile}
              leftIcon={<Save className="w-4 h-4" />}
            >
              Save Profile
            </Button>
          </div>
        </form>
      </Modal>

      {/* Supabase Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </>
  );
};

