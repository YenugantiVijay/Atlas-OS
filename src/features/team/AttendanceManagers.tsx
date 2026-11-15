import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { staffAttendanceService } from '@/services/staff-attendance.service';

interface AttendanceManagersProps {
  orgId: string;
  userId: string;
}

export function AttendanceManagers({ orgId, userId }: AttendanceManagersProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('');
  const queryKey = ['attendance-manager-candidates', orgId, userId];
  const members = useQuery({
    queryKey,
    queryFn: () => staffAttendanceService.listManagerCandidates(orgId),
    enabled: expanded,
  });
  const save = useMutation({
    mutationFn: ({ memberId, grant }: { memberId: string; grant: boolean }) => (
      staffAttendanceService.setManager(orgId, memberId, grant)
    ),
    onSuccess: async () => {
      setSelected('');
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const granted = members.data?.filter(member => member.is_granted) ?? [];
  const candidates = members.data?.filter(member => !member.is_granted && member.is_active) ?? [];
  const memberLabel = (member: { email: string | null; user_id: string }) =>
    member.email || 'Member ' + member.user_id.slice(0, 8);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Attendance managers</h2>
        <Button type="button" variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Close manager access' : 'Manage access'}
        </Button>
      </div>
      {expanded && <>
        <p className="text-sm text-content-secondary">Grant an existing team member access to assign locations and record attendance.</p>
        {members.isPending && <p role="status" className="text-sm">Loading team members…</p>}
        {members.isError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-800">
          Could not load team members.
          <Button size="sm" variant="outline" onClick={() => void members.refetch()}>Retry</Button>
        </div>}
        {members.isSuccess && <>
          {granted.length === 0 && <p className="text-sm text-content-secondary">No attendance managers assigned.</p>}
          {granted.length > 0 && <ul className="divide-y divide-border">
            {granted.map(member => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 break-all">{memberLabel(member)}{!member.is_active && ' (inactive)'}</span>
              <Button type="button" variant="outline" size="sm" disabled={save.isPending}
                onClick={() => save.mutate({ memberId: member.user_id, grant: false })}>
                Revoke<span className="sr-only"> access for {memberLabel(member)}</span>
              </Button>
            </li>)}
          </ul>}
          {candidates.length > 0 && <form className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={event => {
            event.preventDefault();
            if (selected) save.mutate({ memberId: selected, grant: true });
          }}>
            <Select label="Team member" value={selected} onChange={event => setSelected(event.target.value)}
              disabled={save.isPending} options={[
                { value: '', label: 'Choose a team member' },
                ...candidates.map(member => ({ value: member.user_id, label: memberLabel(member) })),
              ]} />
            <Button type="submit" disabled={!selected || save.isPending}>Grant access</Button>
          </form>}
        </>}
        {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-sm text-teal-800">Manager access updated.</p>}
      </>}
    </Card>
  );
}
