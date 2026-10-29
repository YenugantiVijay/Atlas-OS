import React, { useState } from 'react';
import {
  Plus,
  Lock,
  ShieldAlert,
  UserCheck,
  UserX,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { teamService } from '@/services/team.service';
import { Role, Membership } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { useToast } from '@/components/ui/Toast';
import { getRoleBadgeVariant } from '@/lib/permissions';

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

const ROLES: Role[] = ['owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer'];

export const TeamPage: React.FC = () => {
  const { currentOrg, currentRole, currentUser, isMockAuth, isDemoMode, memberships, refreshOrgData } = useOrg();
  const { showToast } = useToast();

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // In-line role change state
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>('sales');

  const isOwner = currentRole === 'owner';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;

    if (!isDemoMode) {
      showToast(
        'error',
        'Cloud Invitation Restricted',
        'Supabase cloud invitations require an Edge Function with email dispatch. Creating unauthenticated identities in Live Cloud mode is disabled.'
      );
      return;
    }

    if (!email.trim() || !fullName.trim()) {
      showToast('error', 'Validation Error', 'Full Name and Email are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await teamService.addDemoMember(currentOrg.id, {
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        avatarUrl: avatarUrl || undefined,
      });

      showToast('success', 'Sandbox Member Added', `Simulated invite for ${fullName} as ${role} in demo storage.`);
      setIsInviteModalOpen(false);
      setEmail('');
      setFullName('');
      setAvatarUrl('');
      await refreshOrgData();
    } catch (err: any) {
      showToast('error', 'Invite Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async (member: Membership) => {
    if (!currentOrg) return;
    if (member.role === 'owner' && selectedRole !== 'owner') {
      const activeOwners = memberships.filter((m) => m.role === 'owner' && m.isActive);
      if (activeOwners.length <= 1) {
        showToast('error', 'Operation Blocked', 'Cannot demote the sole active owner of the organization.');
        return;
      }
    }

    try {
      await teamService.updateMemberRole(
        currentOrg.id,
        member.id,
        selectedRole,
        currentRole,
        isMockAuth
      );
      showToast('success', 'Role Updated', `Updated role to ${selectedRole} for member.`);
      setEditingMemberId(null);
      await refreshOrgData();
    } catch (err: any) {
      showToast('error', 'Role Update Failed', err.message);
    }
  };

  const handleToggleActive = async (member: Membership) => {
    if (!currentOrg) return;
    if (member.userId === currentUser?.id) {
      showToast('error', 'Operation Blocked', 'You cannot deactivate your own active session membership.');
      return;
    }
    if (member.role === 'owner' && member.isActive) {
      const activeOwners = memberships.filter((m) => m.role === 'owner' && m.isActive);
      if (activeOwners.length <= 1) {
        showToast('error', 'Operation Blocked', 'Cannot deactivate the sole active owner of the organization.');
        return;
      }
    }

    try {
      await teamService.toggleMemberActive(
        currentOrg.id,
        member.id,
        !member.isActive,
        currentRole,
        isMockAuth
      );
      showToast(
        'success',
        member.isActive ? 'Member Deactivated' : 'Member Activated',
        `Membership status updated.`
      );
      await refreshOrgData();
    } catch (err: any) {
      showToast('error', 'Status Change Failed', err.message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Team & Permissions
            </h1>
            <Badge variant="violet" size="sm">
              RBAC Multi-Tenant
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Manage organization members and role-based operational permissions across sales, inventory, and accounts.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => setIsInviteModalOpen(true)}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          {isDemoMode ? 'Add Sandbox Member' : 'Invite Member'}
        </Button>
      </div>

      {/* Mode Indicator Banner */}
      {!isDemoMode && (
        <div className="p-3.5 rounded-xl border border-atlas-200 bg-atlas-50 text-atlas-900 text-xs flex items-center gap-3">
          <ShieldAlert className="w-4 h-4 text-atlas-600 shrink-0" />
          <span>
            <strong>Cloud Security Enforced:</strong> Live Cloud permissions and memberships are verified against Supabase Row Level Security. Only organization owners can reassign roles or adjust member status.
          </span>
        </div>
      )}

      {/* Team Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>Active Organization Members</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Assigned Role</TableHead>
              <TableHead>Access Level</TableHead>
              <TableHead>Joined Date</TableHead>
              <TableHead>Status</TableHead>
              {isOwner && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((m) => {
              const isEditing = editingMemberId === m.id;

              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {m.user?.avatarUrl ? (
                        <img
                          src={m.user.avatarUrl}
                          alt={m.user?.fullName || 'User'}
                          className="w-9 h-9 rounded-full object-cover border border-border shadow-xs shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-atlas-100 text-atlas-800 font-bold text-xs flex items-center justify-center border border-atlas-200 shrink-0">
                          {getInitials(m.user?.fullName || 'Staff')}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-content-primary">
                          {m.user?.fullName || 'Distributor Staff'}
                        </div>
                        <div className="text-xs text-content-secondary font-mono mt-0.5">
                          {m.user?.email || 'user@atlas-os.local'}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={selectedRole}
                          onChange={(e) => setSelectedRole(e.target.value as Role)}
                          className="text-xs rounded-lg border border-border bg-surface-card px-2 py-1 focus:outline-none focus:ring-1 focus:ring-atlas-500"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleUpdateRole(m)}
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50"
                          title="Save Role"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingMemberId(null)}
                          className="p-1 rounded text-content-muted hover:bg-slate-100"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <Badge variant={getRoleBadgeVariant(m.role)} showDot size="sm">
                        {m.role}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-content-secondary">
                    {m.role === 'owner' && 'Full organization administration & business access'}
                    {m.role === 'admin' && 'Operational oversight, product catalog & sales approvals'}
                    {m.role === 'sales' && 'Customer management, quotations & order dispatch'}
                    {m.role === 'inventory' && 'SKUs, stock movements & physical adjustments'}
                    {m.role === 'accounts' && 'Invoicing, payment collection & receivables'}
                    {m.role === 'viewer' && 'Read-only access to permitted records'}
                  </TableCell>

                  <TableCell className="text-xs text-content-secondary font-mono">
                    {new Date(m.createdAt).toLocaleDateString('en-IN')}
                  </TableCell>

                  <TableCell>
                    <Badge variant={m.isActive ? 'success' : 'danger'} showDot size="sm">
                      {m.isActive ? 'Active' : 'Deactivated'}
                    </Badge>
                  </TableCell>

                  {isOwner && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setEditingMemberId(m.id);
                              setSelectedRole(m.role);
                            }}
                            leftIcon={<Edit2 className="w-3 h-3" />}
                          >
                            Edit Role
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-8 px-2 text-xs ${
                            m.isActive ? 'text-rose-600 hover:text-rose-700' : 'text-emerald-600 hover:text-emerald-700'
                          }`}
                          onClick={() => handleToggleActive(m)}
                          leftIcon={m.isActive ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                        >
                          {m.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Role Permission Matrix Reference */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-atlas-600" />
            <CardTitle>Role Permissions Reference Guide</CardTitle>
          </div>
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-surface-panel/50 border border-border">
            <span className="font-bold text-sm text-content-primary block mb-1">Sales Representative</span>
            <p className="text-xs text-content-secondary leading-relaxed">
              Allowed to create customers, generate customer quotations, and log sales orders. Cannot adjust inventory without dispatch confirmation.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-surface-panel/50 border border-border">
            <span className="font-bold text-sm text-content-primary block mb-1">Inventory Manager</span>
            <p className="text-xs text-content-secondary leading-relaxed">
              Authorized to create SKUs, manage suppliers, and record manual stock adjustments with mandatory audit trail reasons.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-surface-panel/50 border border-border">
            <span className="font-bold text-sm text-content-primary block mb-1">Accounts Officer</span>
            <p className="text-xs text-content-secondary leading-relaxed">
              Authorized to issue tax invoices, record customer payments, and manage receivables aging ledgers.
            </p>
          </div>
        </div>
      </Card>

      {/* Invite Modal */}
      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title={isDemoMode ? 'Simulate Sandbox Member' : 'Cloud Member Invitation'}
        description={
          isDemoMode
            ? `Add a local test member to ${currentOrg?.name || 'the organization'} in Demo Sandbox.`
            : `Supabase Cloud Invitation Policy for ${currentOrg?.name || 'the organization'}.`
        }
        maxWidth="md"
      >
        {!isDemoMode ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 text-xs space-y-2 leading-relaxed">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <ShieldAlert className="w-4 h-4 text-amber-700" />
                <span>Backend Invitation Service Required</span>
              </div>
              <p>
                In Live Cloud mode, Atlas OS strictly enforces PostgreSQL and Supabase Auth identity boundaries. Real invitations must be dispatched through authenticated Edge Functions invoking <code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-200">supabase.auth.admin.inviteUserByEmail()</code> with transactional email delivery.
              </p>
              <p>
                Browser-only creation of arbitrary cloud user accounts is prevented to protect database integrity and avoid unverified membership records.
              </p>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setIsInviteModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <ImageUpload
              label="Member Photo"
              value={avatarUrl}
              onChange={setAvatarUrl}
              shape="circle"
              helperText="Upload member profile picture (Optional)"
            />

            <Input
              label="Full Name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Ramesh Iyer"
            />

            <Input
              label="Email Address"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ramesh@srilakshmielectricals.in"
            />

            <Select
              label="Role & Capability"
              required
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              options={ROLES.map((r) => ({
                value: r,
                label: `${r.toUpperCase()} — ${r === 'owner' ? 'Full Admin' : r === 'sales' ? 'Orders & Quotes' : r === 'inventory' ? 'Stock Manager' : r === 'accounts' ? 'Finance & Invoices' : 'Viewer'}`,
              }))}
            />

            <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsInviteModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmitting}>
                Add Sandbox Member
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
