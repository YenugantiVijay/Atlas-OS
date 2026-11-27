import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { staffPayService } from '@/services/staff-pay.service';
import { staffAttendanceService } from '@/services/staff-attendance.service';
import { staffClockService } from '@/services/staff-clock.service';

export function EmployeeAccountLinks({ orgId, userId, editable }: { orgId: string; userId: string; editable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [staffId, setStaffId] = useState('');
  const [memberId, setMemberId] = useState('');
  const client = useQueryClient();
  const scope = ['employee-links', orgId, userId];
  const staff = useQuery({ queryKey: [...scope, 'staff', page], queryFn: () => staffPayService.listStaff(orgId, page - 1), enabled: expanded });
  const members = useQuery({ queryKey: [...scope, 'members'], queryFn: () => staffAttendanceService.listManagerCandidates(orgId), enabled: expanded });
  const accounts = useQuery({ queryKey: [...scope, 'accounts'], queryFn: () => staffClockService.accounts(orgId), enabled: expanded });
  const save = useMutation({ mutationFn: ({ employee, member, active }: { employee: string; member: string; active: boolean }) =>
    staffClockService.link(orgId, employee, member, active), onSuccess: async () => {
    setStaffId(''); setMemberId('');
    await client.invalidateQueries({ queryKey: scope });
    await client.invalidateQueries({ queryKey: ['staff-clock', orgId] });
  } });
  return <Card className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Employee sign-in links</h2>
      <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide employee links' : 'Link employee accounts'}</Button></div>
    {expanded && <>
      <p className="text-sm text-content-secondary">Invite the employee through Team &amp; Access first, then link that active sign-in to a staff profile. This grants attendance self-service, not attendance management or payroll access.</p>
      {(staff.isError || members.isError || accounts.isError) && <div role="alert" className="text-sm text-rose-800">Employee links could not be loaded.
        <Button size="sm" variant="ghost" onClick={() => void client.invalidateQueries({ queryKey: scope })}>Retry employee links</Button></div>}
      {(staff.isPending || members.isPending || accounts.isPending) && <p role="status">Loading employee links…</p>}
      {staff.isSuccess && members.isSuccess && accounts.isSuccess && <>
        <form className="grid items-end gap-3 sm:grid-cols-3" onSubmit={event => {
          event.preventDefault(); if (editable && staffId && memberId) save.mutate({ employee: staffId, member: memberId, active: true });
        }}>
          <Select label="Employee profile" value={staffId} disabled={!editable || save.isPending} onChange={event => setStaffId(event.target.value)}
            options={[{ value: '', label: 'Choose employee' }, ...staff.data.rows.map(row => ({ value: row.id, label: row.display_name }))]} />
          <Select label="Employee sign-in" value={memberId} disabled={!editable || save.isPending} onChange={event => setMemberId(event.target.value)}
            options={[{ value: '', label: 'Choose active team member' }, { value: userId, label: 'My owner account' }, ...members.data.filter(row => row.is_active).map(row => ({ value: row.user_id, label: row.email ?? row.user_id }))]} />
          <Button type="submit" disabled={!editable || save.isPending || !staffId || !memberId}>Save employee link</Button>
        </form>
        {staff.data.rows.map(person => {
          const account = accounts.data.find(row => row.staff_id === person.id);
          return account && <div key={person.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm">
            <p>{person.display_name} · {members.data.find(row => row.user_id === account.user_id)?.email ?? account.user_id} · {account.is_active ? 'Enabled' : 'Disabled'}</p>
            <Button variant="ghost" size="sm" disabled={!editable || save.isPending}
              onClick={() => save.mutate({ employee: person.id, member: account.user_id, active: !account.is_active })}>{account.is_active ? 'Disable' : 'Enable'} self-service<span className="sr-only"> for {person.display_name}</span></Button>
          </div>;
        })}
        {staff.data.count > 25 && <Pagination page={page} pageSize={25} totalCount={staff.data.count} totalPages={Math.ceil(staff.data.count / 25)}
          onPageChange={next => { setStaffId(''); setPage(next); }} />}
      </>}
      {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
      {save.isSuccess && <p role="status" className="text-sm text-teal-800">Employee link saved.</p>}
    </>}
  </Card>;
}
