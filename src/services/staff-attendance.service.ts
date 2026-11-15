import { supabase } from '@/lib/supabase';
import { staffPageSize, type StaffProfile } from './staff-pay.service';

export const attendanceStatuses = {
  scheduled: 'Scheduled',
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  leave: 'On leave',
} as const;

export type AttendanceStatus = keyof typeof attendanceStatuses;
export type AttendanceEmployee = Pick<StaffProfile, 'id' | 'display_name' | 'joining_on'>;

export interface AttendanceEntry {
  staff_id: string;
  location_id: string | null;
  status: AttendanceStatus;
  revision: number;
  recorded_at: string;
}

export interface AttendanceManagerCandidate {
  user_id: string;
  email: string | null;
  is_active: boolean;
  is_granted: boolean;
}

export class AttendanceConflictError extends Error {}

function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace to manage attendance.');
  return supabase;
}

const entryColumns = 'staff_id,location_id,status,revision,recorded_at';

export const staffAttendanceService = {
  async canManage(orgId: string): Promise<boolean> {
    const { data, error } = await cloud().rpc('can_manage_staff_attendance', { p_org_id: orgId });
    if (error) throw new Error('Attendance access could not be verified.');
    return data === true;
  },

  async listDay(orgId: string, date: string, page: number) {
    const start = (page - 1) * staffPageSize;
    const roster = await cloud().from('staff_profiles').select('id,display_name,joining_on', { count: 'exact' })
      .eq('organization_id', orgId).lte('joining_on', date)
      .order('display_name').order('id').range(start, start + staffPageSize - 1);
    if (roster.error || roster.count === null) throw new Error('The attendance roster could not be loaded.');
    if (roster.data.length === 0) return { staff: [], entries: [], count: roster.count };
    const { data, error } = await cloud().rpc('staff_attendance_day', {
      p_org_id: orgId, p_work_date: date, p_staff_ids: roster.data.map(employee => employee.id),
    }).select(entryColumns);
    if (error) throw new Error('Attendance could not be loaded for this date.');
    return { staff: roster.data as AttendanceEmployee[], entries: data as AttendanceEntry[], count: roster.count };
  },

  async listHistory(orgId: string, staffId: string, date: string, limit: number): Promise<AttendanceEntry[]> {
    const { data, error } = await cloud().from('staff_attendance').select(entryColumns)
      .eq('organization_id', orgId).eq('staff_id', staffId).eq('work_date', date)
      .order('revision', { ascending: false }).limit(limit);
    if (error) throw new Error('Attendance history could not be loaded.');
    return data as AttendanceEntry[];
  },

  async save(orgId: string, employee: AttendanceEmployee, date: string, entry: {
    revision: number;
    location: string | null;
    status: AttendanceStatus;
  }) {
    const { error } = await cloud().from('staff_attendance').insert({
      organization_id: orgId, staff_id: employee.id, joining_on: employee.joining_on, work_date: date,
      revision: entry.revision, location_id: entry.location, status: entry.status,
    });
    if (error?.code === '23505' || error?.code === '40001') {
      const [latest] = await this.listHistory(orgId, employee.id, date, 1);
      if (latest?.revision === entry.revision && latest.location_id === entry.location && latest.status === entry.status) return;
      throw new AttendanceConflictError('Someone updated this employee’s attendance. Review the latest entry before saving.');
    }
    if (error?.code === '42501') throw new Error('Attendance changes are unavailable for this workspace or account.');
    if (error) throw new Error('Attendance could not be saved. Check the date and work location, then try again.');
  },

  async listManagerCandidates(orgId: string): Promise<AttendanceManagerCandidate[]> {
    const members: AttendanceManagerCandidate[] = [];
    const pageSize = 100;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await cloud().rpc('staff_attendance_manager_candidates', { p_org_id: orgId })
        .order('email').order('user_id').range(start, start + pageSize - 1);
      if (error) throw new Error('Attendance managers could not be loaded.');
      members.push(...data as AttendanceManagerCandidate[]);
      if (data.length < pageSize) return members;
    }
  },

  async setManager(orgId: string, userId: string, grant: boolean) {
    const managers = cloud().from('staff_attendance_managers');
    const { error } = grant
      ? await managers.upsert({ organization_id: orgId, user_id: userId }, {
        onConflict: 'organization_id,user_id', ignoreDuplicates: true,
      })
      : await managers.delete().eq('organization_id', orgId).eq('user_id', userId);
    if (error) throw new Error('Attendance access could not be updated. Check that the member is active and try again.');
  },
};
