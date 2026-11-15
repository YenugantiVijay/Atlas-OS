import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/features/organizations/OrgContext';
import { staffAttendanceService } from '@/services/staff-attendance.service';

export function useAttendanceAccess() {
  const { currentOrg, currentUser, currentRole, isAuthenticated, isDemoMode } = useOrg();
  const orgId = currentOrg?.id;
  const enabled = Boolean(orgId && currentUser?.id && currentRole && isAuthenticated && !isDemoMode);
  return useQuery({
    queryKey: ['attendance-access', orgId, currentUser?.id, currentRole],
    queryFn: () => staffAttendanceService.canManage(orgId!),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: enabled ? 60_000 : false,
    retry: false,
  });
}
