import { supabase } from '@/lib/supabase';
import { readDecimalHundredths } from '@/lib/decimal-input';
import type { SchoolBootstrap, SchoolCommand, SchoolPageData } from './school.types';

function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace to use School Management.');
  return supabase;
}
export class SchoolUnconfirmedError extends Error {}
export function parseSchoolMoney(value: string) {
  const amount = readDecimalHundredths(value);
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a positive amount with at most nine whole digits and two decimal places.');
  return amount;
}
export function parseSchoolTax(value: string) {
  const rate = readDecimalHundredths(value);
  if (rate === null || rate > 10000) throw new Error('Enter a tax rate between 0 and 100 with up to two decimal places.');
  return rate;
}
function checkFinancialNumbers(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith('_paise') && (typeof item !== 'number' || !Number.isSafeInteger(item))) {
      throw new Error('A school financial amount could not be represented exactly. Narrow the report or contact support.');
    }
    if (item && typeof item === 'object') checkFinancialNumbers(item);
  }
}
export const schoolService = {
  async read<T>(orgId: string, area: string, filter: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await cloud().rpc('school_read', { p_org_id: orgId, p_area: area, p_filter: filter });
    if (error?.code === '22023') throw new Error(error.message.slice(0, 250));
    if (error || data === null) throw new Error('School records could not be loaded. Check your school permissions and confirm the school migrations are installed.');
    checkFinancialNumbers(data);
    if (filter.export === true && (!Array.isArray(data.rows) || data.rows.length !== data.count || data.count > 5000)) throw new Error('Narrow the export to at most 5000 records and retry.');
    return data as T;
  },
  bootstrap(orgId: string) { return this.read<SchoolBootstrap>(orgId, 'bootstrap'); },
  page<T>(orgId: string, area: string, filter: Record<string, unknown>) { return this.read<SchoolPageData<T>>(orgId, area, filter); },
  async command(orgId: string, action: SchoolCommand, data: Record<string, unknown>, requestId: string): Promise<unknown> {
    const response = await Promise.resolve(cloud().rpc('school_command', { p_org_id: orgId, p_action: action, p_data: data, p_request_id: requestId })).catch(() => { throw new SchoolUnconfirmedError('The change was not confirmed. Refresh school records before retrying.'); });
    const { data: result, error } = response;
    if (error || result === null) {
      const message = error?.message ?? '';
      if (/changed|Reload|no longer pending/i.test(message)) throw new Error('These records changed. Reload before saving again.');
      if (/exceeds|unpaid|refundable|allocation|balance changed/i.test(message)) throw new Error('The amount does not reconcile with the current fee balance. Reload fees and review the amount.');
      if (/duplicate key|already used|unique constraint/i.test(message)) throw new Error('A matching identifier or record already exists. Review the current records before retrying.');
      if (error?.code === '42501') throw new Error('This school action is not available for your account or workspace.');
      if (error?.code === '22023' || error?.code === '23514') throw new Error(message.replace(/^ERROR:\s*/, '').slice(0, 250));
      throw new SchoolUnconfirmedError('The school change was not confirmed. Refresh to check its status; retry identical data with the same request key.');
    }
    return result;
  },
};

export function downloadSchoolCsv(name: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const csv = [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  const href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = href; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
