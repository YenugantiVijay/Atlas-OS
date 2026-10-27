import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { NewOrgModal } from './NewOrgModal';

export const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNewOrgModalOpen, setIsNewOrgModalOpen] = useState(false);
  const navigate = useNavigate();

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
    <div className="min-h-screen bg-surface-canvas text-content-primary">
      {/* Sidebar */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      {/* Header */}
      <Header
        collapsed={collapsed}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenQuickCreate={handleOpenQuickCreate}
        onOpenNewOrgModal={() => setIsNewOrgModalOpen(true)}
      />

      {/* Main Content Area */}
      <main
        className={`pt-20 px-6 pb-12 transition-all duration-200 ${
          collapsed ? 'pl-26' : 'pl-70'
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <Outlet />
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
    </div>
  );
};
