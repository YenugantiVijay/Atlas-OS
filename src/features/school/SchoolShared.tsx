import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { schoolService, SchoolUnconfirmedError } from './school.service';
import type { SchoolBootstrap, SchoolCommand, SchoolPageData } from './school.types';

export interface SchoolScope { orgId: string; userId: string; editable: boolean; bootstrap: SchoolBootstrap }
export function useSchoolRead<T>(scope: SchoolScope, area: string, filter: Record<string, unknown> = {}, enabled = true) {
  return useQuery({ queryKey: ['school', scope.orgId, scope.userId, scope.bootstrap.role, area, filter],
    queryFn: () => schoolService.read<T>(scope.orgId, area, filter), enabled });
}
export function useSchoolCommand(scope: SchoolScope) {
  const client = useQueryClient();
  const request = useRef<{ signature: string; id: string }>();
  return useMutation({ mutationFn: async ({ action, data }: { action: SchoolCommand; data: Record<string, unknown> }) => {
    if (!scope.editable) throw new Error('School records are read-only while workspace writes are unavailable.');
    const signature = JSON.stringify({ action, data });
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    return schoolService.command(scope.orgId, action, data, request.current.id);
  }, onSuccess: async () => {
    request.current = undefined;
    await client.invalidateQueries({ queryKey: ['school', scope.orgId] });
  } });
}
export interface SchoolField {
  name: string; label: string; type?: 'text' | 'date' | 'email' | 'textarea' | 'select' | 'number';
  options?: Array<{ value: string; label: string }>; required?: boolean; maxLength?: number; hint?: string;
}
export function CommandForm({ scope, title, action, fields, initial = {}, transform, onSaved, submitLabel = 'Save' }: {
  scope: SchoolScope; title: string; action: SchoolCommand; fields: SchoolField[]; initial?: Record<string, string>;
  transform?: (values: Record<string, string>) => Record<string, unknown>; onSaved?: (result: unknown) => void; submitLabel?: string;
}) {
  const [values, setValues] = useState(initial);
  const [validation, setValidation] = useState('');
  const save = useSchoolCommand(scope);
  const client = useQueryClient();
  const pending = useRef(false);
  const uncertain = save.error instanceof SchoolUnconfirmedError;
  return <Card className="space-y-3">
    <h2 className="font-semibold">{title}</h2>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); if (pending.current || !scope.editable || uncertain) return;
      setValidation('');
      try {
        const data = transform ? transform(values) : values;
        pending.current = true;
        const result = await save.mutateAsync({ action, data }); setValues(initial); onSaved?.(result);
      } catch (error) { setValidation(error instanceof Error ? error.message : 'The change could not be saved.'); }
      finally { pending.current = false; }
    }}>
      {fields.map(field => {
        const change = (value: string) => { setValues(current => ({ ...current, [field.name]: value })); setValidation(''); save.reset(); };
        const value = values[field.name] ?? '';
        return <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
          {field.type === 'select' ? <Select label={field.label} value={value} required={field.required !== false}
            disabled={!scope.editable || save.isPending || uncertain} onChange={event => change(event.target.value)}
            options={[{ value: '', label: 'Choose…' }, ...(field.options ?? [])]} />
            : field.type === 'textarea' ? <label className="block text-sm font-medium">{field.label}
              <textarea value={value} rows={3} required={field.required !== false} maxLength={field.maxLength ?? 1000}
                disabled={!scope.editable || save.isPending || uncertain} onChange={event => change(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface-card p-3" /></label>
              : <Input label={field.label} type={field.type === 'number' ? 'text' : field.type ?? 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={value} required={field.required !== false} maxLength={field.maxLength ?? 150} disabled={!scope.editable || save.isPending || uncertain}
                onChange={event => change(event.target.value)} />}
          {field.hint && <p className="mt-1 text-xs text-content-muted">{field.hint}</p>}
        </div>;
      })}
      <div className="sm:col-span-2"><Button type="submit" disabled={!scope.editable || save.isPending || uncertain} isLoading={save.isPending}>{submitLabel}</Button></div>
      {uncertain && <Button type="button" variant="outline" onClick={async () => {
        try { await client.invalidateQueries({ queryKey: ['school', scope.orgId] }, { throwOnError: true }); save.reset(); setValidation('Review the refreshed records before resubmitting.'); }
        catch { setValidation('The server records could not be refreshed. Check your connection and retry the refresh.'); }
      }}>Refresh and review school records</Button>}
      {validation && <p role="alert" className="text-sm text-rose-800 sm:col-span-2">{validation}</p>}
      {save.isSuccess && !validation && <p role="status" className="text-sm text-teal-800 sm:col-span-2">Change confirmed by the server.</p>}
    </form>
  </Card>;
}
export function QueryState({ pending, error, retry }: { pending: boolean; error: Error | null; retry: () => unknown }) {
  if (pending) return <p role="status" className="text-sm">Loading school records…</p>;
  if (error) return <div role="alert" className="space-y-2 text-sm text-rose-800"><p>{error.message}</p><Button size="sm" variant="outline" onClick={() => void retry()}>Retry school records</Button></div>;
  return null;
}
export function Pager<T>({ data, page, onChange }: { data: SchoolPageData<T>; page: number; onChange: (page: number) => void }) {
  return data.count > 25 ? <Pagination page={page} pageSize={25} totalCount={data.count} totalPages={Math.ceil(data.count / 25)} onPageChange={onChange} /> : null;
}
export function SchoolPanel({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="space-y-3"><h2 className="font-semibold">{title}</h2>{children}</Card>;
}
export const classOptions = (scope: SchoolScope, yearId?: string) => scope.bootstrap.classes.filter(row => !yearId || row.year_id === yearId)
  .map(row => ({ value: row.id, label: `${row.name} · ${row.section} · ${scope.bootstrap.years.find(year => year.id === row.year_id)?.name ?? ''}` }));
export const yearOptions = (scope: SchoolScope) => scope.bootstrap.years.map(row => ({ value: row.id, label: row.name }));
export const methodOptions = ['cash', 'upi', 'bank', 'cheque'].map(value => ({ value, label: value.toUpperCase() }));
