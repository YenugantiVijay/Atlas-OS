# Employee attendance

Atlas extends the existing staff/pay directory and manager attendance roster with employee self-service at `/#/attendance/my`. Reference: [MetaMinds attendance](https://github.com/YenugantiVijay/MetaMinds-Dashboard/blob/main/src/features/attendance/AttendancePage.tsx) and [checkout/report flow](https://github.com/YenugantiVijay/MetaMinds-Dashboard/blob/main/src/features/attendance/CheckOutModal.tsx).

## Setup

1. Apply `20261127060928_staff_self_service_attendance.sql` through the normal reviewed migration workflow after all earlier Atlas migrations. This change does not apply a migration to the hosted project automatically.
2. The owner adds staff and their assigned work locations in **Staff & Pay Setup**.
3. Invite staff through **Team & Access**. A viewer membership is sufficient for self-service; do not grant finance or attendance-manager privileges merely to allow check-in.
4. Open **Employee Attendance → Link employee accounts**. Link an active sign-in to the corresponding staff profile. One sign-in maps to one staff profile per organization. The owner can enable/disable self-service here after any open shift is completed.
5. Employees use **Employee Attendance** to choose an assigned location, check in, start/end breaks, and submit a 20–2000-character daily work summary when checking out.
6. Owners and explicitly delegated attendance managers can switch to **Show team attendance** for monthly logs, completed-shift totals, recorded work time and daily summaries. The existing daily roster remains available for manager-marked present/half-day/absent/leave/scheduled records.

## Recording rules

- Server timestamps determine check-in, breaks, check-out and the IST work date. The browser cannot choose timestamps, duration or another employee identity.
- A completed shift's work time is elapsed seconds minus recorded break seconds, rounded down to whole minutes. Open shifts do not count toward completed work totals.
- One shift per staff profile per IST day; an open shift must be completed before starting another, including across midnight. The system does not invent a missed checkout or silently cap working time.
- Repeated check-ins and identical checkouts do not duplicate a shift. Break operations serialize on the account link and session. Raw browser INSERT/UPDATE/DELETE on clock records is denied.
- Open shifts prevent account relinking or disabling, so employees can finish their current record. Inactive memberships and unavailable workspace write eligibility block new actions.
- A failed or uncertain write never displays success: refresh authoritative attendance before retrying.
- Monthly totals cover the entire selected month, independently of the paginated log. Unrecorded days are not automatically absences. Attendance does not approve leave, determine overtime or alter salary/payment ledgers.
- Existing manager-marked attendance, historical records, pay setup and advances are preserved. Punches do not overwrite the manager roster or manufacture payroll entries.

## Access and deployment

New tables have RLS and authenticated read-only grants. Employees see their own clock records; owners/delegated attendance managers see authorized organization records. Employee self-service adds only the employee's profile and assigned-location reads, without exposing pay-rate tables. Writes go through guarded private server functions with public invoker wrappers, an empty search path and explicit execution grants. No client receives an elevated key.

No MetaMinds-specific eight-hour target, leave exemption, automatic timeout, holiday calendar, SMTP reminder or payroll deduction policy is enabled. Those rules require an Atlas company policy and a separately tested server scheduler.

The change is repository code plus a migration. A hosted Supabase migration and application deployment are necessary before it is available to live users. Missing hosted schema produces a setup/error state rather than simulated cloud attendance.

## Validation

Disposable PostgreSQL acceptance includes self-link denial, cross-tenant isolation, private pay access, server-only timestamps, duplicate actions, open-shift relinking protection, break subtraction, monthly totals and disabled links. UI tests cover employee check-in/break/checkout, report validation, uncertain writes, unlinked accounts, read-only workspaces and manager monthly reporting. Existing staff-attendance tests are retained.

Local verification on 27 November 2026: 355 disposable PostgreSQL contracts passed, including viewer self-service and logical restore; 76 ERP browser tests passed; all 11 new/existing attendance UI tests and the affected navigation suites passed. Lint, TypeScript and production build passed. Real attendance components were inspected at desktop and 375px mobile widths with clearly labelled synthetic records. Regression testing also corrected a consumed payment-shortcut URL reopening a cancelled dialog; the original scenario passed 15 repetitions and the final suite verifies a later explicit request still opens normally.
