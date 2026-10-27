import React, { useState } from 'react';
import {
  Plus,
  UserCheck,
  Lock,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Role, Membership } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { getRoleBadgeVariant } from '@/lib/permissions';

const ROLES: Role[] = ['owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer'];

export const TeamPage: React.FC = () => {
  const { currentOrg, memberships, refreshOrgData } = useOrg();
  const { showToast } = useToast();

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('sales');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !fullName.trim()) {
      showToast('error', 'Validation Error', 'Full Name and Email are required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      const newMember: Membership = {
        id: 'mem-' + Date.now(),
        organizationId: currentOrg.id,
        userId: 'u-' + Date.now(),
        role,
        isActive: true,
        createdAt: new Date().toISOString(),
        user: {
          id: 'u-' + Date.now(),
          email: email.trim(),
          fullName: fullName.trim(),
        },
      };

      const allMemberships = JSON.parse(localStorage.getItem('atlas_memberships_v1') || '[]');
      allMemberships.push(newMember);
      localStorage.setItem('atlas_memberships_v1', JSON.stringify(allMemberships));

      storage.logAuditEvent(currentOrg.id, 'INVITE_MEMBER', 'MEMBERSHIP', newMember.id, {
        email,
        role,
      });

      showToast('success', 'Member Added', `Invited ${fullName} as ${role}.`);
      setIsInviteModalOpen(false);
      setEmail('');
      setFullName('');
      refreshOrgData();
    } catch (err: any) {
      showToast('error', 'Invite Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Team & Permissions
            </h1>
            <Badge variant="violet" size="sm">
              RBAC Multi-Tenant
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
            Manage organization members and role-based operational permissions across sales, inventory, and accounts.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => setIsInviteModalOpen(true)}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Invite Member
        </Button>
      </div>

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="font-semibold text-content-primary">
                    {m.user?.fullName || 'Distributor Staff'}
                  </div>
                  <div className="text-xs text-content-secondary font-mono">
                    {m.user?.email || 'user@atlas-os.local'}
                  </div>
                </TableCell>

                <TableCell>
                  <Badge variant={getRoleBadgeVariant(m.role)} size="sm">
                    {m.role}
                  </Badge>
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
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Active</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3 rounded-xl bg-surface-panel border border-border">
            <span className="font-bold text-atlas-900 block mb-1">Sales Representative</span>
            <p className="text-content-secondary leading-relaxed">
              Allowed to create customers, generate customer quotations, and log sales orders. Cannot adjust inventory without dispatch confirmation.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-surface-panel border border-border">
            <span className="font-bold text-atlas-900 block mb-1">Inventory Manager</span>
            <p className="text-content-secondary leading-relaxed">
              Authorized to create SKUs, manage suppliers, and record manual stock adjustments with mandatory audit trail reasons.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-surface-panel border border-border">
            <span className="font-bold text-atlas-900 block mb-1">Accounts Officer</span>
            <p className="text-content-secondary leading-relaxed">
              Authorized to issue tax invoices, record customer payments, and manage receivables aging ledgers.
            </p>
          </div>
        </div>
      </Card>

      {/* Invite Modal */}
      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title="Invite Organization Member"
        description="Add a team member to Sri Lakshmi Electrical Distributors with role-based access."
        maxWidth="md"
      >
        <form onSubmit={handleInvite} className="space-y-4">
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
              Invite Member
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
