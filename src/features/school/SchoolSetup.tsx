import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { classOptions, CommandForm, QueryState, SchoolPanel, useSchoolCommand, useSchoolRead, yearOptions, type SchoolScope } from './SchoolShared';
import type { SchoolPageData } from './school.types';

export function SchoolSetup({ scope }: { scope: SchoolScope }) {
  const school = scope.bootstrap.settings;
  return <div className="space-y-5"><a href="/templates/Atlas-Client-Handover-Templates.xlsx" download className="text-sm font-semibold text-teal-800 underline">Download client setup and school fee verification workbook</a>
    <CommandForm scope={scope} title="School profile and receipt settings" action="settings" submitLabel="Save school settings"
      initial={school ? { ...school } : { receipt_prefix: 'SCH' }} fields={[
        { name: 'name', label: 'School name' }, { name: 'address', label: 'School address', type: 'textarea' },
        { name: 'phone', label: 'School phone', maxLength: 30 }, { name: 'email', label: 'School email', type: 'email', required: false },
        { name: 'board', label: 'Board / curriculum', required: false, hint: 'Enter your school board or curriculum; this does not certify board compliance.' },
        { name: 'logo_url', label: 'School logo HTTPS URL', required: false, hint: 'Use an approved publicly accessible school logo URL.' },
        { name: 'receipt_prefix', label: 'Receipt prefix', maxLength: 12, hint: 'Letters, digits and hyphens. Existing receipt numbers are preserved.' },
        { name: 'grading_notes', label: 'Grading policy notes', type: 'textarea', required: false, hint: 'Reference notes for future academic modules; no marks or report cards are generated in phases 1–2.' },
      ]} />
    {school && <>
      <div className="grid gap-5 lg:grid-cols-2">
        <CommandForm scope={scope} title="Add academic year" action="year" fields={[
          { name: 'name', label: 'Academic year name' }, { name: 'starts_on', label: 'Year starts', type: 'date' }, { name: 'ends_on', label: 'Year ends', type: 'date' },
        ]} />
        <CommandForm scope={scope} title="Add term" action="term" fields={[
          { name: 'year_id', label: 'Term academic year', type: 'select', options: yearOptions(scope) },
          { name: 'name', label: 'Term name' }, { name: 'starts_on', label: 'Term starts', type: 'date' }, { name: 'ends_on', label: 'Term ends', type: 'date' },
        ]} />
        <CommandForm scope={scope} title="Add class and section" action="class" fields={[
          { name: 'year_id', label: 'Class academic year', type: 'select', options: yearOptions(scope) }, { name: 'name', label: 'Class name' }, { name: 'section', label: 'Section', maxLength: 40 },
        ]} />
        <CommandForm scope={scope} title="Add school calendar date" action="calendar" fields={[
          { name: 'year_id', label: 'Calendar academic year', type: 'select', options: yearOptions(scope) }, { name: 'day', label: 'Calendar date', type: 'date' },
          { name: 'label', label: 'Occasion / event' }, { name: 'kind', label: 'Date type', type: 'select', options: [
            { value: 'holiday', label: 'Holiday' }, { value: 'event', label: 'School event' }, { value: 'working_day', label: 'Working day' },
          ] },
        ]} />
      </div>
      <SchoolPanel title="Academic structure">
        {scope.bootstrap.years.length === 0 && <p className="text-sm">Add an academic year, then its classes and sections.</p>}
        {scope.bootstrap.years.map(year => <section key={year.id} className="border-t border-border pt-3 text-sm">
          <h3 className="font-semibold">{year.name} · {year.starts_on} to {year.ends_on}</h3>
          <p className="mt-1">{scope.bootstrap.classes.filter(row => row.year_id === year.id).map(row => `${row.name} ${row.section}`).join(', ') || 'No classes yet'}</p>
          <p className="mt-1 text-content-secondary">Terms: {scope.bootstrap.terms.filter(row => row.year_id === year.id).map(row => `${row.name}: ${row.starts_on}–${row.ends_on}`).join('; ') || 'None configured'}</p>
        </section>)}
      </SchoolPanel>
      <SchoolPanel title="School calendar">
        {scope.bootstrap.calendar.length === 0 && <p className="text-sm">No holidays or events configured. Dates are school-defined; no holiday list is assumed.</p>}
        {scope.bootstrap.calendar.map(row => <p key={row.id} className="text-sm">{row.day} · {row.label} · {row.kind.replace('_', ' ')}</p>)}
      </SchoolPanel>
    </>}
  </div>;
}

export function SchoolPermissions({ scope }: { scope: SchoolScope }) {
  const [member, setMember] = useState(''); const [role, setRole] = useState('teacher'); const [classes, setClasses] = useState<string[]>([]);
  const save = useSchoolCommand(scope);
  const audit = useSchoolRead<SchoolPageData<{ id: number; actor: string; action: string; recorded_at: string }>>(scope, 'audit');
  return <div className="space-y-5"><a href="/templates/Atlas-Client-Handover-Templates.xlsx" download className="text-sm font-semibold text-teal-800 underline">Download client setup and school fee verification workbook</a><SchoolPanel title="School responsibilities">
    <p className="text-sm text-content-secondary">Invite staff through Team &amp; Access first. School roles are separate from business finance privileges. Teachers access only assigned classes; principal/owner approval is required for concessions and refunds.</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (member && (role !== 'teacher' || classes.length)) save.mutate({ action: 'role', data: { user_id: member, role, class_ids: classes } }); }}>
      <Select label="School team member" value={member} disabled={!scope.editable || save.isPending} onChange={event => setMember(event.target.value)}
        options={[{ value: '', label: 'Choose active member' }, ...scope.bootstrap.members.map(row => ({ value: row.user_id, label: row.email }))]} />
      <Select label="School role" value={role} disabled={!scope.editable || save.isPending} onChange={event => setRole(event.target.value)} options={[
        { value: 'principal', label: 'Principal' }, { value: 'school_admin', label: 'School administrator' }, { value: 'admissions', label: 'Admissions' },
        { value: 'teacher', label: 'Teacher / class teacher' }, { value: 'accountant', label: 'School accountant' }, { value: 'remove', label: 'Remove school access' },
      ]} />
      {role === 'teacher' && <fieldset><legend className="mb-2 text-sm font-semibold">Assigned classes</legend><div className="grid gap-2 sm:grid-cols-2">
        {classOptions(scope).map(row => <label key={row.value} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!scope.editable || save.isPending}
          checked={classes.includes(row.value)} onChange={event => setClasses(current => event.target.checked ? [...current, row.value] : current.filter(id => id !== row.value))} />{row.label}</label>)}
      </div></fieldset>}
      <Button type="submit" disabled={!scope.editable || save.isPending || !member || (role === 'teacher' && !classes.length)}>Save school responsibility</Button>
    </form>
    {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
    {save.isSuccess && <p role="status" className="text-sm text-teal-800">School responsibility saved.</p>}
    {scope.bootstrap.roles.map(row => <p key={row.user_id} className="border-t border-border pt-2 text-sm">
      {scope.bootstrap.members.find(member => member.user_id === row.user_id)?.email ?? row.user_id} · {row.role.replace('_', ' ')}
      {row.role === 'teacher' && ' · ' + scope.bootstrap.teacher_classes.filter(item => item.user_id === row.user_id).map(item => classOptions(scope).find(cls => cls.value === item.class_id)?.label).join(', ')}
    </p>)}
  </SchoolPanel><SchoolPanel title="Recent school changes">
    <QueryState pending={audit.isPending} error={audit.error} retry={audit.refetch} />
    {audit.data?.rows.map(row => <p key={row.id} className="text-sm">{new Date(row.recorded_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {row.action.replace(/_/g, ' ')} · {scope.bootstrap.members.find(member => member.user_id === row.actor)?.email ?? row.actor}</p>)}
  </SchoolPanel></div>;
}
