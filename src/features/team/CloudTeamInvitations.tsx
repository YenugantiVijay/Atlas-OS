import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { formatDisplayDate } from '@/lib/dates';
import { inviteRoles, teamInvitationService, teamInviteLink, type InviteRole } from '@/services/team-invitation.service';

const roleLabels: Record<InviteRole, string> = {
  sales: 'Sales', inventory: 'Inventory', accounts: 'Accounts', viewer: 'Viewer', admin: 'Administrator',
};

export function CloudTeamInvitations({ orgId, userId }: { orgId: string; userId: string }) {
  const queryClient = useQueryClient();
  const key = ['team-invitations', orgId, userId];
  const invitations = useQuery({ queryKey: key, queryFn: () => teamInvitationService.list(orgId), retry: false });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('sales');
  const [shareId, setShareId] = useState<string>();
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();

  const issue = useMutation({
    mutationFn: async () => {
      const id = await teamInvitationService.create(orgId, email.trim(), role);
      return { id, sent: await teamInvitationService.send(orgId, id) };
    },
    onSuccess: async ({ id, sent }) => {
      setOpen(false);
      setEmail('');
      setShareId(sent ? undefined : id);
      setFeedback({ error: false, text: sent
        ? 'The email provider accepted the invitation for delivery.'
        : 'Invitation created. Email delivery could not be confirmed. Share the link below.' });
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => teamInvitationService.revoke(orgId, id),
    onSuccess: async (_, id) => {
      setShareId(previous => previous === id ? undefined : previous);
      setFeedback({ text: 'Invitation revoked.', error: false });
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: error => setFeedback({ text: error.message, error: true }),
  });

  async function copyInvite(id: string) {
    setShareId(id);
    try {
      await navigator.clipboard.writeText(teamInviteLink(id));
      setFeedback({ text: 'Invitation link copied.', error: false });
    } catch {
      setFeedback({ text: 'Select and copy the invitation link below.', error: false });
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Team invitations</h2>
        <Button onClick={() => { issue.reset(); setOpen(true); }}>Invite member</Button>
      </div>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className="text-sm">{feedback.text}</p>}
      {shareId && <Input label="Invitation link" value={teamInviteLink(shareId)} readOnly onFocus={event => event.target.select()} />}
      {invitations.isPending && <p role="status" className="text-sm">Loading invitations…</p>}
      {invitations.isError && <div className="flex flex-wrap items-center gap-2 text-sm">
        <p role="alert">Could not load invitations.</p>
        <Button variant="outline" size="sm" onClick={() => void invitations.refetch()}>Retry</Button>
      </div>}
      {invitations.isSuccess && (invitations.data.length ? <ul className="divide-y divide-border">
        {invitations.data.map(invite => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 text-sm">
            <p className="break-all font-medium">{invite.email}</p>
            <p className="text-content-secondary">{roleLabels[invite.role]} · Expires {formatDisplayDate(invite.expires_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyInvite(invite.id)}>Copy link</Button>
            <Button type="button" variant="outline" size="sm" disabled={revoke.isPending}
              onClick={() => revoke.mutate(invite.id)}>Revoke<span className="sr-only"> invitation for {invite.email}</span></Button>
          </div>
        </li>)}
      </ul> : <p className="text-sm text-content-secondary">No pending invitations.</p>)}
      <Modal isOpen={open} title="Invite a team member"
        description="They’ll join using the verified email address you enter here."
        onClose={() => { if (!issue.isPending) setOpen(false); }}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!issue.isPending) issue.mutate(); }}>
          <Input label="Email address" type="email" required maxLength={254} value={email}
            onChange={event => setEmail(event.target.value)} disabled={issue.isPending} />
          <Select label="Team role" value={role} onChange={event => setRole(event.target.value as InviteRole)}
            disabled={issue.isPending} options={inviteRoles.map(value => ({ value, label: roleLabels[value] }))} />
          {issue.isError && <p role="alert" className="text-sm text-rose-800">{issue.error.message}</p>}
          <Button type="submit" disabled={issue.isPending || !email.trim()} isLoading={issue.isPending}>Send invitation</Button>
        </form>
      </Modal>
    </Card>
  );
}
