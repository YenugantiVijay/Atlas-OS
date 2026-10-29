import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Membership, Role } from '@/types';
import { auditService } from './audit.service';

export const teamService = {
  async getMembers(orgId: string, isMockAuth: boolean = false): Promise<Membership[]> {
    if (isMockAuth) {
      return storage.getMemberships(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase
      .from('memberships')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch memberships: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role as Role,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));
  },

  async updateMemberRole(
    orgId: string,
    memberId: string,
    newRole: Role,
    currentOperatorRole: Role | null,
    isMockAuth: boolean = false
  ): Promise<void> {
    if (currentOperatorRole !== 'owner') {
      throw new Error('Unauthorized: Only organization owners can change member roles.');
    }

    if (isMockAuth) {
      storage.updateMembership(memberId, { role: newRole });
      await auditService.logEvent(
        orgId,
        'UPDATE_MEMBER_ROLE',
        'MEMBERSHIP',
        memberId,
        { newRole },
        true
      );
      return;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { error } = await supabase
      .from('memberships')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .eq('organization_id', orgId);

    if (error) {
      throw new Error(`Database error updating member role: ${error.message}`);
    }

    await auditService.logEvent(
      orgId,
      'UPDATE_MEMBER_ROLE',
      'MEMBERSHIP',
      memberId,
      { newRole },
      false
    );
  },

  async toggleMemberActive(
    orgId: string,
    memberId: string,
    isActive: boolean,
    currentOperatorRole: Role | null,
    isMockAuth: boolean = false
  ): Promise<void> {
    if (currentOperatorRole !== 'owner') {
      throw new Error('Unauthorized: Only organization owners can activate or deactivate members.');
    }

    if (isMockAuth) {
      storage.updateMembership(memberId, { isActive });
      await auditService.logEvent(
        orgId,
        isActive ? 'ACTIVATE_MEMBER' : 'DEACTIVATE_MEMBER',
        'MEMBERSHIP',
        memberId,
        { isActive },
        true
      );
      return;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { error } = await supabase
      .from('memberships')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .eq('organization_id', orgId);

    if (error) {
      throw new Error(`Database error updating member status: ${error.message}`);
    }

    await auditService.logEvent(
      orgId,
      isActive ? 'ACTIVATE_MEMBER' : 'DEACTIVATE_MEMBER',
      'MEMBERSHIP',
      memberId,
      { isActive },
      false
    );
  },

  async addDemoMember(
    orgId: string,
    memberData: { fullName: string; email: string; role: Role; avatarUrl?: string }
  ): Promise<Membership> {
    const newMember: Membership = {
      id: 'mem-demo-' + Date.now(),
      organizationId: orgId,
      userId: 'u-demo-' + Date.now(),
      role: memberData.role,
      isActive: true,
      createdAt: new Date().toISOString(),
      user: {
        id: 'u-demo-' + Date.now(),
        email: memberData.email.trim(),
        fullName: memberData.fullName.trim(),
        avatarUrl: memberData.avatarUrl || undefined,
      },
    };

    storage.addMembership(newMember);

    await auditService.logEvent(
      orgId,
      'DEMO_MEMBER_SIMULATED',
      'MEMBERSHIP',
      newMember.id,
      { email: memberData.email, role: memberData.role },
      true
    );

    return newMember;
  },
};
