import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './query-client';
import { OrgProvider } from '@/features/organizations/OrgContext';
import { ToastProvider } from '@/components/ui/Toast';

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <OrgProvider requireAuthenticator={import.meta.env.VITE_REQUIRE_WORKSPACE_AUTHENTICATOR === 'true'}>
        <ToastProvider>{children}</ToastProvider>
      </OrgProvider>
    </QueryClientProvider>
  );
};
