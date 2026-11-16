import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/features/organizations/OrgContext';
import { platformAdminService } from '@/services/platform-admin.service';
import { isSupabaseConfigured } from '@/lib/supabase';

export function usePlatformReviewer() {
  const { currentUser, isAuthenticated, isDemoMode } = useOrg();
  const userId = currentUser?.id;
  const enabled = Boolean(isSupabaseConfigured() && userId && isAuthenticated && !isDemoMode);
  return useQuery({
    queryKey: ['platform-reviewer', userId],
    queryFn: () => platformAdminService.canReview(userId!),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: enabled ? 30_000 : false,
    retry: false,
  });
}
