import { supabase } from '@/lib/supabase';

export interface StaffClockSession {
  id: string;
  staff_id: string;
  user_id: string;
  work_date: string;
  location_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  break_started_at: string | null;
  break_seconds: number;
  work_summary: string | null;
  worked_minutes: number | null;
}
export interface EmployeeAccount { staff_id: string; user_id: string; is_active: boolean }
export type ClockAction = 'check_in' | 'start_break' | 'end_break' | 'check_out';
function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace to use employee attendance.');
  return supabase;
}
export function attendanceMonthBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1900) {
    throw new Error('Choose a valid attendance month.');
  }
  const year = Number(month.slice(0, 4));
  const next = Number(month.slice(5)) === 12 ? `${year + 1}-01` : `${year}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${next}-01` };
}
export const staffClockService = {
  async summary(orgId: string, month: string, userId?: string): Promise<{ recorded_shifts: number; completed_shifts: number; worked_minutes: number }> {
    const bounds = attendanceMonthBounds(month);
    const { data, error } = await cloud().rpc('staff_clock_month_summary', {
      p_org_id: orgId, p_month: bounds.start, p_user_id: userId ?? null,
    });
    if (error || !data?.[0]) throw new Error('Monthly attendance totals could not be loaded.');
    return data[0];
  },
  async locations(orgId: string, staffId: string) {
    const ids: string[] = [];
    for (let start = 0; ; start += 100) {
      const { data, error } = await cloud().from('staff_location_assignments').select('location_id')
        .eq('organization_id', orgId).eq('staff_id', staffId).order('location_id').range(start, start + 99);
      if (error) throw new Error('Assigned work locations could not be loaded.');
      ids.push(...data.map(row => row.location_id as string));
      if (data.length < 100) break;
    }
    if (!ids.length) return [];
    const rows: Array<{ id: string; name: string }> = [];
    for (let start = 0; start < ids.length; start += 100) {
      const { data, error } = await cloud().from('staff_locations').select('id,name')
        .eq('organization_id', orgId).in('id', ids.slice(start, start + 100)).order('name');
      if (error) throw new Error('Assigned work locations could not be loaded.');
      rows.push(...data);
    }
    return rows;
  },
  async account(orgId: string, userId: string): Promise<EmployeeAccount | null> {
    const { data, error } = await cloud().from('staff_employee_accounts').select('staff_id,user_id,is_active')
      .eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
    if (error) throw new Error('Employee access could not be loaded. Confirm the attendance migration is installed.');
    return data;
  },
  async accounts(orgId: string): Promise<EmployeeAccount[]> {
    const rows: EmployeeAccount[] = [];
    for (let start = 0; ; start += 100) {
      const { data, error } = await cloud().from('staff_employee_accounts').select('staff_id,user_id,is_active')
        .eq('organization_id', orgId).order('staff_id').range(start, start + 99);
      if (error) throw new Error('Employee account links could not be loaded.');
      rows.push(...data);
      if (data.length < 100) return rows;
    }
  },
  async link(orgId: string, staffId: string, userId: string, active: boolean) {
    const { error } = await cloud().rpc('link_staff_employee', {
      p_org_id: orgId, p_staff_id: staffId, p_user_id: userId, p_active: active,
    });
    if (error) throw new Error('Could not link the account. Choose an active member, finish any open shift, and check for an existing link.');
  },
  async active(orgId: string, userId: string): Promise<StaffClockSession | null> {
    const { data, error } = await cloud().from('staff_clock_log').select('*')
      .eq('organization_id', orgId).eq('user_id', userId).is('checked_out_at', null).maybeSingle();
    if (error) throw new Error('Your current shift could not be loaded.');
    return data;
  },
  async month(orgId: string, month: string, page: number, userId?: string) {
    const bounds = attendanceMonthBounds(month);
    let query = cloud().from('staff_clock_log').select('*', { count: 'exact' })
      .eq('organization_id', orgId).gte('work_date', bounds.start).lt('work_date', bounds.end);
    if (userId) query = query.eq('user_id', userId);
    const { data, error, count } = await query.order('work_date', { ascending: false }).order('id')
      .range((page - 1) * 25, page * 25 - 1);
    if (error || count === null) throw new Error('Attendance history could not be loaded.');
    return { rows: data as StaffClockSession[], count };
  },
  async act(orgId: string, action: ClockAction, sessionId?: string, locationId?: string, summary?: string) {
    const { error } = await cloud().rpc('staff_clock_action', {
      p_org_id: orgId, p_action: action, p_session_id: sessionId ?? null,
      p_location_id: locationId ?? null, p_summary: summary?.trim() ?? null,
    });
    if (error) throw new Error('Attendance action was not confirmed. Refresh your shift before retrying; check your account link, location and work summary.');
  },
};
