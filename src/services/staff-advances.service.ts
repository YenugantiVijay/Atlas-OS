import { supabase } from '@/lib/supabase';
import { parseStaffPayAmount } from './staff-pay.service';

export const staffPaymentMethods = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' } as const;
export type StaffPaymentMethod = keyof typeof staffPaymentMethods;

export interface StaffAdvance {
  id: string;
  issued_on: string;
  amount_paise: number;
  balance_paise: number;
  first_month: string | null;
  installment_paise: number;
  method: StaffPaymentMethod;
  note: string;
}

export interface StaffRecovery {
  id: string;
  payday_id: string | null;
  amount_paise: number;
  received_on: string;
  note: string | null;
  method: StaffPaymentMethod | null;
  payday_reversed_at: string | null;
}

export interface StaffPayday {
  id: string;
  period: string;
  gross_paise: number;
  other_deductions_paise: number;
  advance_deductions_paise: number;
  net_paise: number;
  method: StaffPaymentMethod;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface PaydayPreview {
  snapshot: string;
  latest_period: string | null;
  rate: { basis: 'monthly' | 'daily' | 'hourly'; amount_paise: number; effective_on: string } | null;
  lines: { id: string; note: string; balance_paise: number; scheduled_paise: number; catchup_paise: number }[];
}

export interface PaydayAmounts {
  gross: number;
  wageBasis: number;
  other: number;
  limit: number | null;
}

export const advancePageSize = 25;

export function parseStaffDeduction(input: string) {
  return /^0+(\.0{1,2})?$/.test(input.trim()) ? 0 : parseStaffPayAmount(input);
}

export function advanceDeductionCapacity({ gross, wageBasis, other, limit }: PaydayAmounts) {
  if (wageBasis > gross || other > Math.floor(wageBasis / 2)) {
    throw new Error('Wage basis must fit within gross pay, and other deductions must fit within half the wage basis.');
  }
  return Math.min(Math.floor(wageBasis / 2) - other, limit ?? gross);
}

function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace.');
  return supabase;
}

type StaffScope = { orgId: string; staffId: string; userId: string };

async function write(scope: StaffScope, rpc: string, values: Record<string, unknown>) {
  const body = { p_org_id: scope.orgId, p_staff_id: scope.staffId, ...values };
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  const digest = [...new Uint8Array(fingerprint)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const key = 'atlas_staff_request:' + scope.userId + ':' + rpc + ':' + digest;
  const id = localStorage.getItem(key) ?? crypto.randomUUID();
  // Persist IDs for unresolved writes. The financial details stay in the form and database.
  localStorage.setItem(key, id);
  const { error } = await cloud().rpc(rpc, { ...body, p_id: id });
  if (error) {
    if (['22023', '23514', '23505', '40001'].includes(error.code)) {
      localStorage.removeItem(key);
      throw new Error(error.message);
    }
    throw new Error('Could not confirm the record. Retry with the same details or refresh its history.');
  }
  localStorage.removeItem(key);
}

export const staffAdvanceService = {
  async listAdvances(orgId: string, staffId: string, page: number) {
    const start = (page - 1) * advancePageSize;
    const { data, count, error } = await cloud().from('staff_advance_balances')
      .select('id,issued_on,amount_paise,balance_paise,first_month,installment_paise,method,note', { count: 'exact' })
      .eq('organization_id', orgId).eq('staff_id', staffId).order('issued_on', { ascending: false })
      .order('recorded_at', { ascending: false }).order('id').range(start, start + advancePageSize - 1);
    if (error || count === null) throw new Error('Could not load staff advances.');
    return { rows: data as StaffAdvance[], count };
  },

  async listPaydays(orgId: string, staffId: string, page: number) {
    const start = (page - 1) * advancePageSize;
    const paydays = () => cloud().from('staff_paydays');
    const [history, latest] = await Promise.all([
      paydays().select('id,period,gross_paise,other_deductions_paise,advance_deductions_paise,net_paise,method,reversed_at,reversal_reason', { count: 'exact' })
        .eq('organization_id', orgId).eq('staff_id', staffId)
        .order('period', { ascending: false }).order('recorded_at', { ascending: false }).order('id')
        .range(start, start + advancePageSize - 1),
      paydays().select('id').eq('organization_id', orgId).eq('staff_id', staffId)
        .is('reversed_at', null).order('period', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (history.error || latest.error || history.count === null) throw new Error('Could not load pay records.');
    return { rows: history.data as StaffPayday[], count: history.count, latestActiveId: latest.data?.id ?? null };
  },

  async listRecoveries(orgId: string, staffId: string, advanceId: string, page: number) {
    const start = (page - 1) * advancePageSize;
    const { data, count, error } = await cloud().from('staff_advance_recovery_history')
      .select('id,payday_id,amount_paise,received_on,note,method,payday_reversed_at', { count: 'exact' })
      .eq('organization_id', orgId).eq('staff_id', staffId).eq('advance_id', advanceId)
      .order('received_on', { ascending: false }).order('recorded_at', { ascending: false }).order('id')
      .range(start, start + advancePageSize - 1);
    if (error || count === null) throw new Error('Could not load repayment history.');
    return { rows: data as StaffRecovery[], count };
  },

  recordAdvance(scope: StaffScope, entry: {
    issuedOn: string; amount: number; firstMonth: string | null; installment: number; method: StaffPaymentMethod; note: string;
  }) {
    return write(scope, 'record_staff_advance', {
      p_issued_on: entry.issuedOn, p_amount: entry.amount, p_first_month: entry.firstMonth,
      p_installment: entry.installment, p_method: entry.method, p_note: entry.note.trim(),
    });
  },

  recordRepayment(scope: StaffScope, advanceId: string, entry: {
    receivedOn: string; amount: number; method: StaffPaymentMethod; note: string;
  }) {
    return write(scope, 'record_staff_advance_repayment', {
      p_advance_id: advanceId, p_received_on: entry.receivedOn, p_amount: entry.amount, p_method: entry.method,
      p_note: entry.note.trim(),
    });
  },

  async previewPayday(orgId: string, staffId: string, period: string): Promise<PaydayPreview> {
    const { data, error } = await cloud().rpc('preview_staff_payday', { p_org_id: orgId, p_staff_id: staffId, p_period: period });
    if (error) throw new Error(error.code === '22023' ? error.message : 'Could not preview this payday.');
    return data;
  },

  postPayday(scope: StaffScope, period: string, amounts: PaydayAmounts, method: StaffPaymentMethod, snapshot: string,
    deductions: { id: string; amount_paise: number }[]) {
    return write(scope, 'post_staff_payday', {
      p_period: period, p_gross: amounts.gross, p_wage_basis: amounts.wageBasis, p_other: amounts.other,
      p_limit: amounts.limit, p_method: method, p_snapshot: snapshot, p_deductions: deductions,
    });
  },

  reversePayday(scope: StaffScope, paydayId: string, reason: string) {
    return write(scope, 'reverse_staff_payday', { p_payday_id: paydayId, p_reason: reason.trim() });
  },
};
