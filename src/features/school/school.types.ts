export type SchoolRole = 'owner' | 'principal' | 'school_admin' | 'admissions' | 'teacher' | 'accountant';
export interface SchoolSettings { name: string; address: string; phone: string; email: string; board: string; logo_url: string; receipt_prefix: string; grading_notes: string }
export interface SchoolYear { id: string; name: string; starts_on: string; ends_on: string }
export interface SchoolClass { id: string; year_id: string; name: string; section: string }
export interface SchoolBootstrap {
  role: SchoolRole; settings: SchoolSettings | null; years: SchoolYear[]; classes: SchoolClass[];
  terms: Array<{ id: string; year_id: string; name: string; starts_on: string; ends_on: string }>;
  calendar: Array<{ id: string; year_id: string; day: string; kind: string; label: string }>;
  fee_categories: Array<{ id: string; name: string }>;
  roles: Array<{ user_id: string; role: string }>;
  members: Array<{ user_id: string; email: string }>;
  teacher_classes: Array<{ user_id: string; class_id: string }>;
}
export interface SchoolPageData<T> { rows: T[]; count: number; totals?: Record<string, number> }
export interface SchoolStudent {
  id: string; enrolment_id: string; admission_no: string; name: string; dob?: string | null;
  guardian_name: string; guardian_phone: string; guardian_email: string; address?: string; previous_school?: string;
  joining_on: string; class_id: string; class_name: string; section: string; year_id: string; year_name: string;
  enrolment_status: string; revision: number;
}
export interface SchoolAdmission { id: string; applicant: string; guardian_name: string; phone: string; desired_class: string; note: string; status: string; revision: number; student_id: string | null }
export type StudentAttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave';
export interface SchoolAttendance { enrolment_id: string; name: string; admission_no: string; status: StudentAttendanceStatus | null; revision: number | null; reason: string | null; recorded_at: string | null }
export interface SchoolAttendanceHistory { revision: number; status: string; reason: string; recorded_at: string; recorded_by: string }
export interface SchoolSchedule { id: string; class_id: string; label: string; due_on: string; amount_paise: number; tax_basis_points: number; tax_note: string }
export interface SchoolCharge { id: string; enrolment_id: string; label: string; due_on: string; base_paise: number; tax_paise: number; total_paise: number; tax_note: string; concession_paise: number; paid_paise: number; balance_paise: number }
export interface SchoolReceipt {
  id: string; receipt_no: string; paid_on: string; method: string; reference: string; amount_paise: number; refunded_paise?: number;
  school_snapshot: SchoolSettings; student_snapshot: { name: string; admission_no: string; guardian_name: string; class: string; section: string; year: string };
  allocations?: Array<{ label: string; due_on: string; amount_paise: number }>;
  adjustments?: Array<{ kind: string; amount_paise: number; refunded_on: string; reason: string }>;
}
export interface SchoolAdjustment { id: string; amount_paise: number; reason: string; status: string; kind?: string; requested_by: string; reviewed_by?: string }
export type SchoolCommand = 'settings' | 'role' | 'year' | 'term' | 'class' | 'calendar' | 'student' | 'student_update' | 'students_import' | 'enrol' | 'admission' | 'admission_stage' | 'admit' | 'attendance' | 'fee_category' | 'fee_schedule' | 'issue_fees' | 'payment' | 'concession_request' | 'concession_review' | 'refund_request' | 'refund_review';
export const schoolPermissions = (role: SchoolRole) => ({
  setup: ['owner', 'principal', 'school_admin'].includes(role),
  admissions: ['owner', 'principal', 'school_admin', 'admissions'].includes(role),
  attendance: ['owner', 'principal', 'school_admin', 'teacher'].includes(role),
  finance: ['owner', 'principal', 'school_admin', 'accountant'].includes(role),
  approve: ['owner', 'principal'].includes(role),
  roles: role === 'owner',
});
