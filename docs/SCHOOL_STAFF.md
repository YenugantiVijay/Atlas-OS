# School staff IDs and attendance

School administrator workflow:

1. Open School Management → Staff IDs & attendance.
2. Register the staff member's existing school-issued ID, name, joining date and position. Select an existing staff profile when available to retain its attendance and payroll history. New profiles receive the School campus location.
3. The school owner invites the person through Team & Access and links that account using Employee sign-in links. Use a minimum-access team role and assign school responsibilities separately.
4. School permissions controls academic access. Attendance managers controls attendance management and leave review. A position such as Principal is descriptive and does not grant these permissions.
5. Linked staff open their employee portal to check in/out, take breaks, review their history and request leave. Attendance managers view team reports and review other staff members' leave.

School IDs are case-insensitively unique within each school and permanent after registration. Different schools may use the same ID. Position updates use revision checks and append private history, preserving staff IDs and attendance. No class or subject assignment is required for staff attendance. Student attendance continues to follow teacher class permissions.

Authentication remains the existing password/OTP account flow. The printed school ID is an identifier, not a password. No public staff-ID lookup or ID-only sign-in is exposed. Only active linked staff can see their own identity and leave; authorities can access the directory. Disabled staff links lose self-service access. Attendance managers cannot approve their own leave. Pending requests can be cancelled by their requester. Overlapping pending/approved leave is rejected. Leave decisions do not rewrite clock records or automatically affect payroll; a missing check-in is not automatically an absence.

Backend: migration `20261127183552_school_staff_identity_and_leave.sql`, private tables `atlas_school.staff_identity`, `staff_identity_history`, `staff_leave`. Public invoker RPCs delegate to authenticated, school-scoped private implementations. Direct table access is revoked. The additional no-policy RLS notices are intentional for these private RPC-only tables.

Verification: 383 disposable database contracts; 15 focused school/attendance screen tests; TypeScript; repository lint; production build. Production release follows the same explicit Supabase and Firebase targets documented in DEPLOYMENT_2026_11_27.md.
