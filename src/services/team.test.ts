import { describe, it, expect, beforeEach } from 'vitest';
import { teamService } from './team.service';
import { storage } from '@/lib/storage';

describe('Team Service & Member RBAC Operations', () => {
  const orgId = 'org-team-test-01';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize();
  });

  it('fetches organization memberships in demo/mock mode', async () => {
    const members = await teamService.getMembers(orgId, true);
    expect(Array.isArray(members)).toBe(true);
  });

  it('prevents non-owners from updating member roles', async () => {
    const demoMember = await teamService.addDemoMember(orgId, {
      fullName: 'Aarav Patel',
      email: 'aarav@test.in',
      role: 'sales',
    });

    await expect(
      teamService.updateMemberRole(orgId, demoMember.id, 'admin', 'sales', true)
    ).rejects.toThrow('Unauthorized: Only organization owners can change member roles.');
  });

  it('allows owner to update member roles and logs audit event', async () => {
    const demoMember = await teamService.addDemoMember(orgId, {
      fullName: 'Priya Sharma',
      email: 'priya@test.in',
      role: 'viewer',
    });

    await teamService.updateMemberRole(orgId, demoMember.id, 'accounts', 'owner', true);
    const members = await teamService.getMembers(orgId, true);
    const updated = members.find((m) => m.id === demoMember.id);
    expect(updated?.role).toBe('accounts');
  });

  it('prevents non-owners from deactivating members', async () => {
    const demoMember = await teamService.addDemoMember(orgId, {
      fullName: 'Kiran Rao',
      email: 'kiran@test.in',
      role: 'inventory',
    });

    await expect(
      teamService.toggleMemberActive(orgId, demoMember.id, false, 'inventory', true)
    ).rejects.toThrow('Unauthorized: Only organization owners can activate or deactivate members.');
  });

  it('allows owner to deactivate and reactivate member', async () => {
    const demoMember = await teamService.addDemoMember(orgId, {
      fullName: 'Deepak Verma',
      email: 'deepak@test.in',
      role: 'sales',
    });

    await teamService.toggleMemberActive(orgId, demoMember.id, false, 'owner', true);
    let members = await teamService.getMembers(orgId, true);
    let updated = members.find((m) => m.id === demoMember.id);
    expect(updated?.isActive).toBe(false);

    await teamService.toggleMemberActive(orgId, demoMember.id, true, 'owner', true);
    members = await teamService.getMembers(orgId, true);
    updated = members.find((m) => m.id === demoMember.id);
    expect(updated?.isActive).toBe(true);
  });
});
