import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Building2,
  ChevronDown,
  Database,
  Check,
  Shield,
  Camera,
  User as UserIcon,
  Save,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseStatus } from '@/lib/supabase';
import { getRoleBadgeVariant } from '@/lib/permissions';

export interface HeaderProps {
  collapsed: boolean;
  onOpenCommandPalette: () => void;
  onOpenQuickCreate: (type?: string) => void;
  onOpenNewOrgModal: () => void;
}

function getInitials(name: string): string {
  if (!name) return 'VK';
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
}) => {
  const { currentOrg, organizations, switchOrganization, currentRole, currentUser, updateCurrentUser } = useOrg();
  const { showToast } = useToast();

  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // Dropdown container refs for detecting clicks anywhere outside on the site
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const quickCreateRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Profile Edit Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editFullName, setEditFullName] = useState(currentUser?.fullName || 'Vijay Kumar');
  const [editEmail, setEditEmail] = useState(currentUser?.email || 'vijay@srilakshmielectricals.in');
  const [editAvatarUrl, setEditAvatarUrl] = useState(currentUser?.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

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
      setEditFullName(currentUser.fullName);
      setEditEmail(currentUser.email);
      setEditAvatarUrl(currentUser.avatarUrl || '');
    }
  }, [currentUser]);

  const handleOpenProfileModal = () => {
    setEditFullName(currentUser.fullName);
    setEditEmail(currentUser.email);
    setEditAvatarUrl(currentUser.avatarUrl || '');
    setIsUserMenuOpen(false);
    setIsProfileModalOpen(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFullName.trim()) {
      showToast('error', 'Name Required', 'Please enter your full name.');
      return;
    }

    setIsSavingProfile(true);
    try {
      updateCurrentUser({
        fullName: editFullName.trim(),
        email: editEmail.trim(),
        avatarUrl: editAvatarUrl || undefined,
      });

      showToast('success', 'Profile Updated', 'Your profile details and image have been updated.');
      setIsProfileModalOpen(false);
    } catch (err: any) {
      showToast('error', 'Failed to update profile', err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const supabaseStatus = getSupabaseStatus();

  return (
    <>
      <header
        className={`fixed top-0 right-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface-card/90 backdrop-blur-md px-6 transition-all duration-200 ${
          collapsed ? 'left-20' : 'left-64'
        }`}
      >
        {/* Left: Organization Selector */}
        <div className="flex items-center gap-3">
          <div ref={orgDropdownRef} className="relative">
            <button
              onClick={() => {
                setIsOrgDropdownOpen((prev) => !prev);
                setIsQuickCreateOpen(false);
                setIsUserMenuOpen(false);
              }}
              className={`flex items-center gap-2 rounded-xl border border-border bg-surface-panel px-3 py-1.5 text-xs font-semibold text-content-primary hover:border-atlas-300 hover:bg-atlas-50/50 transition-colors ${
                isOrgDropdownOpen ? 'border-atlas-400 bg-atlas-50 ring-2 ring-atlas-100' : ''
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-atlas-600" />
              <span className="max-w-[180px] truncate">{currentOrg?.name || 'Select Organization'}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-content-muted transition-transform duration-200 ${isOrgDropdownOpen ? 'rotate-180 text-atlas-700' : ''}`} />
            </button>

            {isOrgDropdownOpen && (
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
          <div ref={quickCreateRef} className="relative">
            <Button
              size="sm"
              variant="primary"
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
            )}
          </div>

          {/* User profile capsule trigger & menu (Addressing Image 1 & Image 2) */}
          <div ref={userMenuRef} className="relative pl-1">
            <button
              onClick={() => {
                setIsUserMenuOpen((prev) => !prev);
                setIsOrgDropdownOpen(false);
                setIsQuickCreateOpen(false);
              }}
              className={`flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full border border-border bg-surface-panel/90 hover:bg-atlas-50 hover:border-atlas-300 transition-all shadow-xs group cursor-pointer ${
                isUserMenuOpen ? 'ring-2 ring-atlas-200 border-atlas-400 bg-atlas-50' : ''
              }`}
              title="User Profile & Shop Menu"
            >
              {/* Left side: Profile pic (custom photo or initials) */}
              <div className="relative w-8 h-8 rounded-full overflow-hidden bg-atlas-200 text-atlas-800 font-bold text-xs flex items-center justify-center border border-atlas-300 shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                {currentUser?.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{getInitials(currentUser?.fullName || 'Vijay Kumar')}</span>
                )}
              </div>

              {/* Right side: Top = Name of shop, Bottom = User name & role */}
              <div className="text-left flex flex-col justify-center min-w-0 pr-0.5">
                <div className="text-xs font-bold text-content-primary leading-tight truncate max-w-[140px] sm:max-w-[175px] group-hover:text-atlas-900">
                  {currentOrg?.name || 'Sri Lakshmi Electrical Distributors'}
                </div>
                <div className="text-[11px] font-medium text-content-secondary leading-tight truncate max-w-[140px] sm:max-w-[175px]">
                  {currentUser?.fullName || 'Vijay Kumar'} • <span className="capitalize text-atlas-700 font-semibold">{currentRole}</span>
                </div>
              </div>

              {/* Dropdown Chevron */}
              <ChevronDown
                className={`w-3.5 h-3.5 text-content-muted group-hover:text-atlas-700 shrink-0 transition-transform duration-200 ${
                  isUserMenuOpen ? 'rotate-180 text-atlas-700' : ''
                }`}
              />
            </button>

            {/* Profile Dropdown (Enlarged Text Size - Image 1 Fix) */}
            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl border border-border bg-surface-card p-3 shadow-dropdown z-50 animate-in fade-in zoom-in-95">
                {/* User Profile Header Card */}
                <div className="p-3 border border-border/70 rounded-xl bg-surface-panel/60 mb-2.5">
                  <div className="flex items-center gap-3">
                    <div className="relative w-12 h-12 rounded-full overflow-hidden bg-atlas-200 text-atlas-800 font-bold text-sm flex items-center justify-center border-2 border-atlas-300 shadow-sm shrink-0">
                      {currentUser?.avatarUrl ? (
                        <img
                          src={currentUser.avatarUrl}
                          alt={currentUser.fullName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{getInitials(currentUser?.fullName || 'Vijay Kumar')}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-content-primary leading-tight truncate">
                        {currentUser?.fullName || 'Vijay Kumar'}
                      </div>
                      <div className="text-xs font-medium text-content-secondary truncate mt-0.5">
                        {currentUser?.email || 'vijay@srilakshmielectricals.in'}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
                          {currentRole}
                        </Badge>
                        <span className="text-[11px] text-content-muted font-medium truncate max-w-[140px]">
                          {currentOrg?.name}
                        </span>
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
                      <div className="text-[11px] text-content-muted font-normal truncate">
                        Change avatar image, name & contact
                      </div>
                    </div>
                  </button>

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
                      <div className="text-[11px] text-content-muted font-normal truncate">
                        Legal GSTIN, store address & business details
                      </div>
                    </div>
                  </a>

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
                      <div className="text-[11px] text-content-muted font-normal truncate">
                        Invite staff, manage roles & RBAC permissions
                      </div>
                    </div>
                  </a>
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
            placeholder="e.g. Vijay Kumar"
            leftIcon={<UserIcon className="w-4 h-4" />}
          />

          <Input
            label="Email Address"
            type="email"
            required
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="e.g. vijay@srilakshmielectricals.in"
          />

          <div className="p-3 rounded-xl bg-surface-panel border border-border text-xs flex items-center justify-between">
            <div>
              <span className="font-semibold text-content-primary block">Active Business Shop</span>
              <span className="text-content-secondary">{currentOrg?.name}</span>
            </div>
            <Badge variant={getRoleBadgeVariant(currentRole)} size="sm">
              {currentRole}
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
    </>
  );
};

