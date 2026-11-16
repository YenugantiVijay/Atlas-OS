import { getSupabaseClient } from '@/lib/supabase';
import type { BusinessCategory } from '@/types';

export const WORKSPACE_FILTERS = [
  { value: 'review_required', label: 'Needs review' },
  { value: 'all', label: 'All workspaces' },
  { value: 'pending', label: 'Pending declaration' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'undeclared', label: 'Not declared' },
] as const;
export type WorkspaceFilter = typeof WORKSPACE_FILTERS[number]['value'];
export type ReviewDecision = 'approved' | 'rejected';

export interface PlatformWorkspace {
  id: string;
  name: string;
  business_category: BusinessCategory | null;
  eligibility_status: Exclude<WorkspaceFilter, 'all'>;
  declaration_updated_at: string | null;
  product_lines: string[] | null;
  identity_present: boolean;
  sells_electrical: boolean | null;
  plan_tier: string | null;
  subscription_status: string | null;
  access_expires_at: string | null;
}

const PAGE_SIZE = 25;

export const platformAdminService = {
  async canReview(userId: string): Promise<boolean> {
    const { data, error } = await getSupabaseClient().from('platform_reviewers')
      .select('is_active').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('Unable to check platform access.');
    return data?.is_active === true;
  },

  async list(filter: WorkspaceFilter, search: string, page: number, signal: AbortSignal) {
    const { data, error } = await getSupabaseClient().rpc('platform_workspace_page', {
      p_filter: filter, p_search: search, p_offset: (page - 1) * PAGE_SIZE,
    }).abortSignal(signal);
    if (error) {
      if (error.code === '42501') throw new Error('Platform reviewer access is required.');
      throw new Error('Unable to load workspaces. Check your connection or platform setup.');
    }
    const rows = (data ?? []) as PlatformWorkspace[];
    return { workspaces: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
  },

  async review(workspace: PlatformWorkspace, decision: ReviewDecision, reason: string) {
    const { error } = await getSupabaseClient().rpc('platform_review_workspace', {
      p_org_id: workspace.id, p_expected_updated_at: workspace.declaration_updated_at,
      p_decision: decision, p_reason: reason.trim(),
    });
    if (error) {
      if (error.code === '40001') throw new Error('The declaration changed. Close this review and refresh the queue.');
      if (error.code === '42501' || error.message.includes('ERR_FORBIDDEN')) throw new Error('Platform reviewer access is required.');
      if (error.message.includes('ERR_INVALID_APPROVAL')) throw new Error('This declaration cannot be approved under the current eligibility rules.');
      throw new Error('The decision could not be saved. Refresh the queue before retrying.');
    }
  },
};
