import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuthModal } from '@/features/auth/AuthModal';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inviteTokenPattern, teamInvitationService } from '@/services/team-invitation.service';

export function TeamInvitationPage() {
  const { inviteId } = useParams();
  const { currentUser, isAuthenticated, isLoadingAuth, isLoadingOrgData, refreshOrgData, signOut } = useOrg();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const valid = !!inviteId && inviteTokenPattern.test(inviteId);

  async function accept() {
    if (!inviteId || submitting || !isAuthenticated) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const orgId = await teamInvitationService.accept(inviteId);
      await refreshOrgData(orgId);
      navigate('/', { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not accept the invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto mt-14 max-w-lg px-4">
      <Card className="space-y-4">
        <h1 className="text-xl font-bold">Join an Atlas OS workspace</h1>
        {!valid ? <><p role="alert">This invitation link is invalid.</p><Link to="/">Go to Atlas OS</Link></>
          : isLoadingAuth || isLoadingOrgData ? <p role="status">Checking your account…</p>
            : isAuthenticated ? <>
              <p className="break-all text-sm">Signed in as {currentUser?.email}. Accept using the email that received the invitation.</p>
              {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void accept()} isLoading={submitting} disabled={submitting}>Accept invitation</Button>
                <Button variant="outline" disabled={submitting} onClick={() => { setError(undefined); void signOut(); }}>Switch account</Button>
              </div>
            </> : <>
              <p className="text-sm">Sign in or create an account using the email that received the invitation.</p>
              <Button onClick={() => setOpen(true)}>Continue with email</Button>
            </>}
      </Card>
      {valid && !isAuthenticated && <AuthModal isOpen={open} onClose={() => setOpen(false)} keepInvitationOpen />}
    </main>
  );
}
