import type { ReactNode } from 'react';
import { formatCurrency } from '@/lib/money';
import type { Command } from './operations';

export const inputClass =
  'mt-1 block w-full min-w-0 rounded-lg border border-border bg-white px-3 py-2 text-sm text-content-primary focus:outline-atlas-600 disabled:bg-slate-100';
export const money = (paise: number) => formatCurrency(paise / 100);
export const panel = 'min-w-0 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-6';
export type Save = (command: Command) => Promise<boolean>;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-sm font-semibold text-content-primary">
      {label}
      {children}
    </label>
  );
}
export function Text({
  name,
  label,
  maxLength = 120,
  defaultValue = '',
  required = true,
}: {
  name: string;
  label: string;
  maxLength?: number;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        className={inputClass}
        name={name}
        maxLength={maxLength}
        defaultValue={defaultValue}
        required={required}
      />
    </Field>
  );
}
export function NumberField({
  name,
  label,
  min = 0,
  onFocus,
  step = 'any',
  max,
}: {
  name: string;
  label: string;
  min?: number;
  step?: string;
  onFocus?: () => void;
  max: number;
}) {
  return (
    <Field label={label}>
      <input className={inputClass} onFocus={onFocus} type="number" name={name} min={min} step={step} max={max} required />
    </Field>
  );
}
export const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
export const number = (form: FormData, key: string) => Number(text(form, key));
