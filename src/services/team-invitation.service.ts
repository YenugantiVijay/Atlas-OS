import { supabase } from '@/lib/supabase';
import type { Role } from '@/types';

export const inviteRoles = ['sales', 'inventory', 'accounts', 'viewer', 'admin'] as const satisfies readonly Role[];
export type InviteRole = typeof inviteRoles[number];
export interface TeamInvitation {
  id: string;
  email: string;
  role: InviteRole;
  expires_at: string;
}

export const inviteTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function teamInviteLink(inviteId: string) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '/invite/' + inviteId;
  return url.toString();
}

function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace.');
  return supabase;
}

export const teamInvitationService = {
  async create(orgId: string, email: string, role: InviteRole) {
    const { data, error } = await cloud().rpc('create_team_invitation', {
      p_org_id: orgId, p_email: email, p_role: role,
    });
    if (error) throw new Error(['22023', '23505', '23514'].includes(error.code) ? error.message : 'Could not create the team invitation.');
    if (typeof data?.id !== 'string' || !inviteTokenPattern.test(data.id)) throw new Error('The invitation could not be confirmed.');
    return data.id as string;
  },

  async list(orgId: string): Promise<TeamInvitation[]> {
    const { data, error } = await cloud().rpc('list_team_invitations', { p_org_id: orgId });
    if (error) throw new Error('Could not load team invitations.');
    return data;
  },

  async revoke(orgId: string, inviteId: string) {
    const { error } = await cloud().rpc('revoke_team_invitation', { p_org_id: orgId, p_invite_id: inviteId });
    if (error) throw new Error(error.code === '23514' ? error.message : 'Could not revoke the team invitation.');
  },

  async send(orgId: string, inviteId: string): Promise<boolean> {
    try {
      const { data, error } = await cloud().functions.invoke('send-team-invitation', { body: { organizationId: orgId, inviteId } });
      return !error && data?.sent === true;
    } catch {
      return false;
    }
  },

  async accept(inviteId: string) {
    const { data, error } = await cloud().rpc('accept_team_invitation', { p_invite_id: inviteId });
    if (error) throw new Error(['42501', '23505'].includes(error.code) ? error.message : 'Could not accept the invitation. Try again.');
    if (typeof data !== 'string' || !inviteTokenPattern.test(data)) throw new Error('Workspace membership could not be confirmed.');
    return data;
  },
};
