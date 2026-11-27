import { portalEntry } from '@/lib/portal-entry';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { GraduationCap, Users, ClipboardCheck, Receipt, Settings, UserPlus, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { schoolService } from './school.service';
import { schoolPermissions } from './school.types';
import { QueryState, SchoolPanel, useSchoolRead, yearOptions, type SchoolScope } from './SchoolShared';
import { SchoolSetup, SchoolPermissions } from './SchoolSetup';
import { SchoolStudents } from './SchoolStudents';
import { SchoolAdmissions } from './SchoolAdmissions';
import { SchoolAttendance } from './SchoolAttendance';
import { SchoolFees } from './SchoolFees';
import { SchoolReports } from './SchoolReports';

export function SchoolPage() {
  const { currentOrg, currentUser, currentRole, isAuthenticated, isDemoMode, canWriteOperations } = useOrg();
  return <div className="space-y-5">
    <header className="flex items-start gap-3"><GraduationCap className="mt-1 h-7 w-7 shrink-0 text-teal-700" /><div>
      <h1 className="text-2xl font-bold">School Management</h1><p className="mt-1 text-sm text-content-secondary">Academic setup, student admissions, attendance and school fee records.</p>
    </div></header>
    {!isAuthenticated || isDemoMode || !currentOrg || !currentUser
      ? <Card><h2 className="font-semibold">School workspace preview</h2><p className="mt-2 text-sm">Sign in to a cloud workspace to set up your school. The school owner assigns principal, administrator, admissions, teacher and accountant access.</p>
        <p className="mt-2 text-sm text-content-secondary">School setup → Classes → Admissions → Student register → Attendance → Fee receipts. Student and financial records are loaded from the server; no cloud records are simulated here.</p></Card>
      : <SchoolCloud key={currentOrg.id + ':' + currentUser.id + ':' + currentRole} orgId={currentOrg.id} userId={currentUser.id} editable={canWriteOperations} />}
  </div>;
}
function SchoolCloud({ orgId, userId, editable }: { orgId: string; userId: string; editable: boolean }) {
  const bootstrap = useQuery({ queryKey: ['school', orgId, userId, 'bootstrap'], queryFn: () => schoolService.bootstrap(orgId), retry: false, refetchInterval: 60_000 });
  return <>
    <QueryState pending={bootstrap.isPending} error={bootstrap.error} retry={bootstrap.refetch} />
    {bootstrap.data && !bootstrap.isError && <SchoolWorkspace key={bootstrap.data.role + ':' + bootstrap.data.classes.map(row => row.id).join(',')}
      scope={{ orgId, userId, editable, bootstrap: bootstrap.data }} />}
  </>;
}
function SchoolWorkspace({ scope }: { scope: SchoolScope }) {
  const [params, setParams] = useSearchParams(); const permission = schoolPermissions(scope.bootstrap.role);
  const sections = [
    { id: 'overview', label: 'School dashboard', Icon: GraduationCap, allowed: true },
    { id: 'setup', label: 'School setup', Icon: Settings, allowed: permission.setup },
    { id: 'students', label: 'Students', Icon: Users, allowed: true },
    { id: 'admissions', label: 'Admissions', Icon: UserPlus, allowed: permission.admissions },
    { id: 'attendance', label: 'Student attendance', Icon: ClipboardCheck, allowed: permission.attendance },
    { id: 'fees', label: 'Fees & receipts', Icon: Receipt, allowed: permission.finance },
    { id: 'reports', label: 'School reports', Icon: FileSpreadsheet, allowed: permission.finance },
    { id: 'permissions', label: 'School permissions', Icon: ShieldCheck, allowed: permission.roles },
  ].filter(section => section.allowed && (portalEntry() === 'admissions' ? ['overview','students','admissions'].includes(section.id) : portalEntry() === 'teacher' ? ['overview','students','attendance'].includes(section.id) : portalEntry() === 'school_accounts' ? ['overview','students','fees','reports'].includes(section.id) : true));
  const selected = params.get('section') ?? 'overview';
  const section = sections.some(row => row.id === selected) ? selected : 'overview';
  const ready = !!scope.bootstrap.settings;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-card p-4 text-sm"><div>
      <strong>{scope.bootstrap.settings?.name ?? 'School not configured'}</strong><p className="mt-1 text-content-secondary">School role: {scope.bootstrap.role.replace(/_/g, ' ')}</p></div>
      <Link className="font-semibold text-teal-800 hover:underline" to="/attendance/my">Staff check-in &amp; attendance</Link>
    </div>
    {!scope.editable && <p role="status" className="text-sm text-amber-800">School records are read-only while workspace writes are unavailable.</p>}
    <nav aria-label="School modules" className="flex flex-wrap gap-2">{sections.map(({ id, label, Icon }) => <Button key={id} size="sm" variant={id === section ? 'primary' : 'outline'}
      aria-current={id === section ? 'page' : undefined} onClick={() => { const next = new URLSearchParams(params); next.set('section', id); setParams(next); }}><Icon size={16} />{label}</Button>)}</nav>
    {!ready && section !== 'setup' && <SchoolPanel title="Start with school setup">
      <p className="text-sm">{permission.setup ? 'Save the school profile, add an academic year, then create classes and sections.' : 'Ask the school owner or principal to finish academic setup.'}</p>
      {permission.setup && <Button onClick={() => setParams({ section: 'setup' })}>Open school setup</Button>}
    </SchoolPanel>}
    {section === 'setup' && permission.setup && <SchoolSetup scope={scope} />}
    {ready && section === 'overview' && <SchoolDashboard scope={scope} />}
    {ready && section === 'students' && <SchoolStudents scope={scope} />}
    {ready && section === 'admissions' && permission.admissions && <SchoolAdmissions scope={scope} />}
    {ready && section === 'attendance' && permission.attendance && <SchoolAttendance scope={scope} />}
    {ready && section === 'fees' && permission.finance && <SchoolFees scope={scope} />}
    {ready && section === 'reports' && permission.finance && <SchoolReports scope={scope} />}
    {ready && section === 'permissions' && permission.roles && <SchoolPermissions scope={scope} />}
  </div>;
}
function SchoolDashboard({ scope }: { scope: SchoolScope }) {
  const [year, setYear] = useState(scope.bootstrap.years[0]?.id ?? '');
  const metrics = useSchoolRead<{ students: number; classes: number; pending_admissions: number | null; today_recorded: number }>(scope, 'dashboard', { year_id: year }, !!year);
  return <SchoolPanel title="School overview">
    <div className="max-w-sm"><Select label="Dashboard academic year" value={year} options={yearOptions(scope)} onChange={event => setYear(event.target.value)} /></div>
    {!year && <p className="text-sm">Add an academic year and classes in School setup to start.</p>}
    {!!year && <QueryState pending={metrics.isPending} error={metrics.error} retry={metrics.refetch} />}
    {metrics.data && !metrics.isError && <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
      ['Active students', metrics.data.students], ['Authorized classes', metrics.data.classes], ['Attendance recorded today', metrics.data.today_recorded],
      ...(metrics.data.pending_admissions === null ? [] : [['Pending admissions', metrics.data.pending_admissions]]),
    ].map(([label, value]) => <div key={label} className="rounded-xl bg-surface-muted p-4"><dt className="text-sm text-content-secondary">{label}</dt><dd className="mt-2 text-2xl font-bold">{value}</dd></div>)}</dl>}
    <p className="text-xs text-content-secondary">Student counts follow your school role and class assignments. Finance reports show issued charges, approved concessions, payments and approved receipt adjustments.</p>
    {scope.bootstrap.calendar.length > 0 && <section className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">School calendar</h3>
      {scope.bootstrap.calendar.filter(row => scope.bootstrap.years.find(item => item.id === year)?.id === row.year_id).slice(0, 10).map(row => <p key={row.id} className="text-sm">{row.day} · {row.label}</p>)}</section>}
  </SchoolPanel>;
}
