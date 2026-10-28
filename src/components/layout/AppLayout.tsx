import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sparkles, Lock } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { NewOrgModal } from './NewOrgModal';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { AuthModal } from '@/features/auth/AuthModal';

export const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNewOrgModalOpen, setIsNewOrgModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const navigate = useNavigate();

  const { isDemoMode, isAuthenticated, isLoadingAuth, enterDemoMode } = useOrg();

  const handleOpenQuickCreate = (type?: string) => {
    switch (type) {
      case 'product':
        navigate('/products?action=create');
        break;
      case 'customer':
        navigate('/customers?action=create');
        break;
      case 'quotation':
        navigate('/quotations?action=create');
        break;
      case 'order':
        navigate('/orders?action=create');
        break;
      case 'payment':
        navigate('/payments?action=record');
        break;
      default:
        navigate('/orders?action=create');
    }
  };

  return (
    <div className="min-h-screen bg-surface-canvas text-content-primary flex flex-col">
      {/* Sidebar (Desktop persistent + Mobile off-canvas drawer) */}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Header */}
      <Header
        collapsed={collapsed}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenQuickCreate={handleOpenQuickCreate}
        onOpenNewOrgModal={() => setIsNewOrgModalOpen(true)}
        onToggleMobileMenu={() => setIsMobileOpen((prev) => !prev)}
      />

      {/* Main Content Area */}
      <main
        className={`transition-all duration-200 ml-0 ${
          collapsed ? 'lg:ml-20' : 'lg:ml-64'
        } pt-20 px-3.5 sm:px-6 lg:px-8 pb-12 flex-1`}
      >
        <div className="mx-auto max-w-7xl w-full">
          {/* Explicit Demo Sandbox Mode Banner */}
          {isDemoMode && (
            <div className="mb-5 p-3 sm:p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-950 text-xs flex items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2.5 min-w-0">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="truncate">
                  <strong>Demo Sandbox:</strong> Using local demo storage. Sign in with Supabase to connect to live cloud database.
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="bg-white/90 hover:bg-white text-xs shrink-0 border-amber-300/70"
                onClick={() => setIsAuthModalOpen(true)}
              >
                Sign In to Cloud
              </Button>
            </div>
          )}

          {/* Unauthenticated Cloud Gate State */}
          {!isAuthenticated && !isDemoMode && !isLoadingAuth ? (
            <div className="p-8 text-center max-w-md mx-auto my-16 bg-surface-card rounded-2xl border border-border shadow-modal space-y-4 animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-xl bg-atlas-100 text-atlas-600 mx-auto flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-content-primary">Authentication Required</h2>
              <p className="text-xs text-content-secondary leading-relaxed">
                Atlas OS is configured in Live Cloud mode. Please sign in with your verified Supabase credentials to access your organization data.
              </p>
              <div className="pt-2 flex flex-col gap-2.5">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => setIsAuthModalOpen(true)}
                >
                  Sign In with Supabase
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={enterDemoMode}
                >
                  Explore Demo Sandbox
                </Button>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenQuickCreate={handleOpenQuickCreate}
      />

      {/* New Organization Modal */}
      <NewOrgModal
        isOpen={isNewOrgModalOpen}
        onClose={() => setIsNewOrgModalOpen(false)}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
};
