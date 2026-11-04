import { useCallback } from 'react';
import { useOrg } from '@/features/organizations/OrgContext';
import {
  Action,
  ActionPermissionCheck,
  evaluateActionPermission,
} from '@/lib/permissions';

export function useActionPermission() {
  const {
    currentRole,
    isAuthenticated,
    isDemoMode,
    currentOrg,
    canWriteOperations,
    eligibility,
    subscription,
    authError,
  } = useOrg();

  const check = useCallback(
    (action: Action): ActionPermissionCheck => {
      return evaluateActionPermission(action, {
        role: currentRole,
        isAuthenticated,
        isDemoMode,
        currentOrg,
        canWriteOperations,
        eligibility,
        subscription,
        authError,
      });
    },
    [
      currentRole,
      isAuthenticated,
      isDemoMode,
      currentOrg,
      canWriteOperations,
      eligibility,
      subscription,
      authError,
    ]
  );

  const can = useCallback(
    (action: Action): boolean => {
      return check(action).allowed;
    },
    [check]
  );

  return { check, can };
}
