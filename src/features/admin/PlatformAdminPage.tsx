import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, ClipboardCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { AuthModal } from '@/features/auth/AuthModal';
import { useOrg } from '@/features/organizations/OrgContext';
import { usePlatformReviewer } from '@/hooks/usePlatformReviewer';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';
import { isSupabaseConfigured } from '@/lib/supabase';
import { platformAdminService, WORKSPACE_FILTERS, type PlatformWorkspace, type ReviewDecision, type WorkspaceFilter } from '@/services/platform-admin.service';

const statusLabel = (status: string | null) => status ? status.replace(/_/g, ' ') : 'Unassigned';

export function PlatformAdminPage() {
  const { currentUser, isAuthenticated, isDemoMode, isLoadingAuth, signOut, exitDemoMode } = useOrg();
  const access = usePlatformReviewer();
  const [signInOpen, setSignInOpen] = useState(false);
  const signedIn = isAuthenticated && !isDemoMode;
  const hasAccess = signedIn && !access.isError && access.data === true;
  return (
    <div className="min-h-screen bg-surface-canvas">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-atlas-800">
            <ArrowLeft size={16} aria-hidden="true" /> Atlas OS workspace
          </Link>
          {signedIn && <Button variant="outline" size="sm" onClick={() => void signOut()}>Sign out</Button>}
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8 sm:py-12">
        <div className="rounded-2xl border border-atlas-200 bg-atlas-50 p-5 sm:p-8">
          <ShieldCheck className="mb-4 text-atlas-800" size={26} aria-hidden="true" />
          <h1 className="text-3xl font-bold tracking-tight">Atlas Platform Admin</h1>
          <p className="mt-2 text-sm text-content-muted">Review business declarations and check workspace access, plans, and trial dates.</p>
        </div>
        {isLoadingAuth || (signedIn && access.isLoading) ? <p role="status">Checking platform access…</p>
          : hasAccess && currentUser ? <WorkspaceDirectory key={currentUser.id} userId={currentUser.id} />
          : !isSupabaseConfigured() ? <p>Connect Atlas OS to Supabase to use the platform portal.</p>
          : !signedIn ? (
            <div className="space-y-3">
              <p>Sign in with an Atlas platform reviewer account.</p>
              <Button onClick={async () => {
                if (isDemoMode) await exitDemoMode();
                setSignInOpen(true);
              }}>Sign in</Button>
            </div>
          ) : access.isError ? (
            <div className="space-y-3"><p role="alert">Unable to verify platform access.</p>
              <Button variant="outline" onClick={() => void access.refetch()}>Retry</Button>
            </div>
          ) : <p role="alert">This account does not have platform reviewer access.</p>}
      </main>
      <AuthModal isOpen={signInOpen && !signedIn} onClose={() => setSignInOpen(false)} signInOnly />
    </div>
  );
}

function WorkspaceDirectory({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<WorkspaceFilter>('review_required');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PlatformWorkspace | null>(null);
  const [decision, setDecision] = useState<ReviewDecision | ''>('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const result = useQuery({
    queryKey: ['platform-workspaces', userId, filter, search, page],
    queryFn: ({ signal }) => platformAdminService.list(filter, search, page, signal),
    retry: false,
    staleTime: 0,
  });
  const review = useMutation({
    mutationFn: ({ workspace, action, note }: { workspace: PlatformWorkspace; action: ReviewDecision; note: string }) =>
      platformAdminService.review(workspace, action, note),
    onSuccess: async () => {
      setSelected(null);
      setFeedback('Decision recorded in the workspace audit history.');
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ['platform-workspaces', userId] });
    },
  });
  return (
    <section className="space-y-4" aria-labelledby="workspace-directory">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="workspace-directory" className="flex items-center gap-2 text-xl font-bold"><Building2 size={20} aria-hidden="true" /> Workspaces</h2>
        <Button variant="outline" size="sm" disabled={result.isFetching} onClick={() => void result.refetch()} leftIcon={<RefreshCw size={15} />}>Refresh</Button>
      </div>
      <form className="grid items-end gap-3 rounded-xl border border-border bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
        onSubmit={event => { event.preventDefault(); setSearch(draftSearch.trim()); setPage(1); }}>
        <Select label="Eligibility status" options={[...WORKSPACE_FILTERS]} value={filter}
          onChange={event => { setFilter(event.target.value as WorkspaceFilter); setPage(1); }} />
        <Input label="Workspace name" value={draftSearch} maxLength={150} onChange={event => setDraftSearch(event.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {feedback && <p role="status" className="rounded-lg bg-status-success-bg p-3 text-sm text-status-success-text">{feedback}</p>}
      {result.isPending ? <p role="status">Loading workspaces…</p>
        : result.isError ? <p role="alert">{result.error.message}</p>
        : !result.data.workspaces.length ? <p className="rounded-xl border border-border bg-white p-4 text-sm">
          No workspaces match these filters.
        </p> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {result.data.workspaces.map(workspace => {
              const canReview = workspace.declaration_updated_at && ['pending', 'review_required'].includes(workspace.eligibility_status);
              return <li key={workspace.id} className="space-y-3 rounded-xl border border-border bg-white p-4 sm:p-5">
                <h3 className="break-words font-semibold">{workspace.name}</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-content-secondary">Industry</dt><dd>{workspace.business_category ? BUSINESS_CATEGORIES[workspace.business_category]?.label : 'Not declared'}</dd></div>
                  <div><dt className="text-content-secondary">Eligibility</dt><dd className="capitalize">{statusLabel(workspace.eligibility_status)}</dd></div>
                  <div><dt className="text-content-secondary">Plan</dt><dd className="capitalize">{statusLabel(workspace.plan_tier)} · {statusLabel(workspace.subscription_status)}</dd></div>
                  <div><dt className="text-content-secondary">Access period end</dt><dd>{workspace.access_expires_at ? new Date(workspace.access_expires_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</dd></div>
                </dl>
                {canReview && <Button variant="secondary" size="sm" leftIcon={<ClipboardCheck size={15} />}
                  onClick={() => { review.reset(); setDecision(''); setReason(''); setSelected(workspace); }}>Review declaration</Button>}
              </li>;
            })}
          </ul>
        )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={page === 1 || result.isFetching} onClick={() => setPage(page - 1)}>Previous</Button>
        <span className="text-sm text-content-muted">Page {page}</span>
        <Button variant="outline" size="sm" disabled={!result.data?.hasNext || result.isFetching} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
      {selected && <Modal isOpen title="Review business declaration" onClose={() => { if (!review.isPending) setSelected(null); }}>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          if (decision && reason.trim() && !review.isPending) review.mutate({ workspace: selected, action: decision, note: reason });
        }}>
          <div>
            <p className="break-words font-semibold">{selected.name}</p>
            <p className="mt-1 text-sm text-content-muted">Tax identity {selected.identity_present ? 'on file' : 'missing'} · Electrical products {selected.sells_electrical ? 'declared' : 'not declared'}</p>
            <p className="mt-1 break-words text-sm text-content-muted">Product lines: {selected.product_lines?.join(', ') || 'None declared'}</p>
          </div>
          <Select required label="Decision" value={decision} disabled={review.isPending}
            options={[{ value: '', label: 'Choose decision', disabled: true }, { value: 'approved', label: 'Approve' }, { value: 'rejected', label: 'Reject' }]}
            onChange={event => setDecision(event.target.value as ReviewDecision)} />
          <Input label="Decision reason" required maxLength={500} value={reason} disabled={review.isPending}
            helperText="The reason is saved with the workspace’s eligibility record."
            onChange={event => setReason(event.target.value)} />
          {review.isError && <p role="alert" className="text-sm text-status-danger-text">{review.error.message}</p>}
          <Button type="submit" isLoading={review.isPending} disabled={!decision || !reason.trim()}>Record decision</Button>
        </form>
      </Modal>}
    </section>
  );
}
