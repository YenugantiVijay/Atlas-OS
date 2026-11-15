import { supabase } from '@/lib/supabase';
import { Payment } from '@/types';
import { paymentsService } from './payments.service';

export interface CounterShift {
  id: string;
  organizationId: string;
  openedBy: string;
  openedAt: string;
  openingCash: number;
  status: 'OPEN' | 'CLOSED';
  closedBy?: string;
  closedAt?: string;
  closingCash?: number;
  expectedCash?: number;
  variance?: number;
  idempotencyKey: string;
}

export interface CounterShiftCashSummary {
  expectedCash: number;
  cashReceipts: number;
  nonCashReceipts: number;
  receiptCount: number;
}

export interface CounterShiftReceipt extends Payment {
  customerName?: string;
}

interface DemoShiftState {
  shifts: CounterShift[];
  links: Array<{ shiftId: string; paymentId: string }>;
}

function mapCounterShift(row: any): CounterShift {
  const openingCash = Number(row.opening_cash);
  if (!row.id || !row.organization_id || !row.opened_by || !row.opened_at ||
      !Number.isFinite(openingCash) || openingCash < 0 ||
      (row.status !== 'OPEN' && row.status !== 'CLOSED')) {
    throw new Error('The database returned an invalid counter shift.');
  }
  const readOptionalAmount = (value: unknown) => {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('The database returned an invalid shift cash amount.');
    return parsed;
  };
  return {
    id: row.id,
    organizationId: row.organization_id,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    openingCash,
    status: row.status,
    closedBy: row.closed_by || undefined,
    closedAt: row.closed_at || undefined,
    closingCash: readOptionalAmount(row.closing_cash),
    expectedCash: readOptionalAmount(row.expected_cash),
    variance: readOptionalAmount(row.variance),
    idempotencyKey: row.idempotency_key,
  };
}

function demoKey(orgId: string) {
  return `atlas_os_counter_shifts_v1:${orgId}`;
}

function readDemoState(orgId: string): DemoShiftState {
  const raw = globalThis.localStorage?.getItem(demoKey(orgId));
  if (!raw) return { shifts: [], links: [] };
  try {
    const parsed = JSON.parse(raw) as DemoShiftState;
    if (!Array.isArray(parsed.shifts) || !Array.isArray(parsed.links)) {
      throw new Error('Invalid local shift data.');
    }
    return parsed;
  } catch {
    throw new Error('Saved demo shift data could not be read. Clear the damaged counter-shift entry and try again.');
  }
}

function writeDemoState(orgId: string, state: DemoShiftState) {
  if (!globalThis.localStorage) throw new Error('Local storage is unavailable for demo counter shifts.');
  globalThis.localStorage.setItem(demoKey(orgId), JSON.stringify(state));
}

export function summarizeCounterShiftCash(
  openingCash: number,
  payments: Pick<Payment, 'amount' | 'paymentMethod'>[]
): CounterShiftCashSummary {
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    throw new Error('Opening cash must be a valid nonnegative amount.');
  }
  let cashReceipts = 0;
  let nonCashReceipts = 0;
  for (const payment of payments) {
    if (!Number.isFinite(payment.amount) || payment.amount < 0) {
      throw new Error('Receipt amounts must be valid nonnegative amounts.');
    }
    if (payment.paymentMethod === 'CASH') cashReceipts += payment.amount;
    else nonCashReceipts += payment.amount;
  }
  return {
    expectedCash: Math.round((openingCash + cashReceipts + Number.EPSILON) * 100) / 100,
    cashReceipts: Math.round((cashReceipts + Number.EPSILON) * 100) / 100,
    nonCashReceipts: Math.round((nonCashReceipts + Number.EPSILON) * 100) / 100,
    receiptCount: payments.length,
  };
}

export const counterShiftsService = {
  async getLatestShift(orgId: string, isMockAuth = false): Promise<CounterShift | null> {
    if (isMockAuth) {
      return [...readDemoState(orgId).shifts]
        .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())[0] || null;
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.from('counter_shifts')
      .select('*').eq('organization_id', orgId).order('opened_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Failed to load the latest counter shift: ${error.message}`);
    return data ? mapCounterShift(data) : null;
  },

  async getLinkedPaymentIds(orgId: string, shiftId: string, isMockAuth = false): Promise<string[]> {
    if (isMockAuth) {
      return readDemoState(orgId).links
        .filter((link) => link.shiftId === shiftId)
        .map((link) => link.paymentId);
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.from('counter_shift_payments')
      .select('payment_id').eq('organization_id', orgId).eq('shift_id', shiftId);
    if (error) throw new Error(`Failed to load shift receipts: ${error.message}`);
    return (data || []).map((row) => row.payment_id);
  },

  async getShiftPayments(
    orgId: string,
    shiftId: string,
    openedAt: string,
    isMockAuth = false
  ): Promise<CounterShiftReceipt[]> {
    if (isMockAuth) {
      const payments = await paymentsService.getPayments(orgId, true);
      const openedAtMs = new Date(openedAt).getTime();
      return payments
        .filter((payment) => new Date(payment.createdAt).getTime() >= openedAtMs)
        .map((payment) => ({ ...payment, customerName: payment.customer?.name }));
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.rpc('get_counter_shift_receipts', {
      p_org_id: orgId,
      p_shift_id: shiftId,
    });
    if (error) throw new Error(`Failed to load receipts recorded during this shift: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('The database did not return valid counter shift receipts.');
    return data.map((row) => {
      const amount = Number(row.amount);
      if (!row.id || row.organization_id !== orgId || !row.payment_number || !row.customer_id ||
          !row.created_at || !Number.isFinite(amount) || amount < 0 ||
          !['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER'].includes(row.payment_method)) {
        throw new Error('The database returned an invalid counter shift receipt.');
      }
      return {
        id: row.id,
        organizationId: row.organization_id,
        paymentNumber: row.payment_number,
        customerId: row.customer_id,
        customerName: row.customer_name || undefined,
        amount,
        paymentMethod: row.payment_method,
        paymentDate: row.payment_date,
        createdAt: row.created_at,
      };
    });
  },

  async openShift(orgId: string, openingCash: number, idempotencyKey: string, isMockAuth = false): Promise<CounterShift> {
    if (!Number.isFinite(openingCash) || openingCash < 0 || openingCash > 9_999_999_999.99) {
      throw new Error('Opening cash must be between 0 and 9,999,999,999.99.');
    }
    if (!idempotencyKey) throw new Error('A secure shift request ID is required.');
    if (isMockAuth) {
      const state = readDemoState(orgId);
      const replay = state.shifts.find((shift) => shift.idempotencyKey === idempotencyKey);
      if (replay) {
        if (replay.openingCash !== openingCash) throw new Error('Shift retry used a different opening cash amount.');
        return replay;
      }
      if (state.shifts.some((shift) => shift.status === 'OPEN')) {
        throw new Error('A counter shift is already open for this business.');
      }
      const shift: CounterShift = {
        id: globalThis.crypto?.randomUUID?.() || idempotencyKey,
        organizationId: orgId,
        openedBy: 'demo-user',
        openedAt: new Date().toISOString(),
        openingCash,
        status: 'OPEN',
        idempotencyKey,
      };
      state.shifts.push(shift);
      writeDemoState(orgId, state);
      return shift;
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.rpc('open_counter_shift', {
      p_org_id: orgId,
      p_opening_cash: openingCash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(`Unable to open counter shift: ${error.message}`);
    return mapCounterShift(data);
  },

  async linkPayment(orgId: string, shiftId: string, paymentId: string, isMockAuth = false): Promise<void> {
    if (isMockAuth) {
      const state = readDemoState(orgId);
      const shift = state.shifts.find((item) => item.id === shiftId && item.status === 'OPEN');
      if (!shift) throw new Error('Counter shift is not open in this business.');
      const payments = await this.getShiftPayments(orgId, shift.id, shift.openedAt, true);
      const payment = payments.find((item) => item.id === paymentId);
      if (!payment || new Date(payment.createdAt).getTime() < new Date(shift.openedAt).getTime()) {
        throw new Error('Only receipts recorded after this shift opened can be linked.');
      }
      const existing = state.links.find((link) => link.paymentId === paymentId);
      if (existing && existing.shiftId !== shiftId) throw new Error('This receipt is already assigned to another shift.');
      if (!existing) state.links.push({ shiftId, paymentId });
      writeDemoState(orgId, state);
      return;
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { error } = await supabase.rpc('link_counter_shift_payment', {
      p_org_id: orgId,
      p_shift_id: shiftId,
      p_payment_id: paymentId,
    });
    if (error) throw new Error(`Unable to link receipt to shift: ${error.message}`);
  },

  async closeShift(orgId: string, shiftId: string, closingCash: number, isMockAuth = false): Promise<CounterShift> {
    if (!Number.isFinite(closingCash) || closingCash < 0 || closingCash > 9_999_999_999.99) {
      throw new Error('Counted cash must be between 0 and 9,999,999,999.99.');
    }
    if (isMockAuth) {
      const state = readDemoState(orgId);
      const shift = state.shifts.find((item) => item.id === shiftId);
      if (!shift) throw new Error('Counter shift not found.');
      if (shift.status === 'CLOSED') {
        if (shift.closingCash === closingCash) return shift;
        throw new Error('Counter shift is already closed with a different counted amount.');
      }
      const payments = await this.getShiftPayments(orgId, shift.id, shift.openedAt, true);
      const linkedIds = new Set(state.links.filter((link) => link.shiftId === shiftId).map((link) => link.paymentId));
      const sinceOpen = payments.filter((payment) => new Date(payment.createdAt).getTime() >= new Date(shift.openedAt).getTime());
      if (sinceOpen.some((payment) => !linkedIds.has(payment.id))) {
        throw new Error('Link every payment recorded since shift opening before closing the drawer.');
      }
      const summary = summarizeCounterShiftCash(shift.openingCash, sinceOpen.filter((payment) => linkedIds.has(payment.id)));
      const closed: CounterShift = {
        ...shift,
        status: 'CLOSED',
        closedBy: 'demo-user',
        closedAt: new Date().toISOString(),
        closingCash,
        expectedCash: summary.expectedCash,
        variance: Math.round((closingCash - summary.expectedCash + Number.EPSILON) * 100) / 100,
      };
      state.shifts = state.shifts.map((item) => item.id === shiftId ? closed : item);
      writeDemoState(orgId, state);
      return closed;
    }
    if (!supabase) throw new Error('Cloud backend is not configured.');
    const { data, error } = await supabase.rpc('close_counter_shift', {
      p_org_id: orgId,
      p_shift_id: shiftId,
      p_closing_cash: closingCash,
    });
    if (error) throw new Error(`Unable to close counter shift: ${error.message}`);
    return mapCounterShift(data);
  },
};
