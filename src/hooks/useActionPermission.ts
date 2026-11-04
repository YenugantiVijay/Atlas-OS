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
