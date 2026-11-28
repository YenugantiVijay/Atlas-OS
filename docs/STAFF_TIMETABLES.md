# Staff timetables

Open School Management → Staff IDs & attendance → Staff timetable. Owners, principals and school administrators can select a registered school staff ID, download the Excel template, upload a completed workbook, review the preview and explicitly publish it with an effective date. Directory pagination controls the available staff choices. Staff see their own timetable through the same panel in the employee portal.

The single-sheet .xlsx template contains `day`, `start`, `end`, `activity`, `class`, `section`, `subject`, `room`. Enter full weekday names and HH:mm times. Activities are teaching, break, free or duty. Teaching requires a class and subject. Class sections and rooms are optional. A file supports up to 150 periods and 1 MB. Formulas, hidden/extra worksheets, malformed times and overlapping periods are rejected. Overnight duties must be split into separate dates/days. Excel time-formatted cells and plain HH:mm text are supported.

Staff can choose a date, switch between its weekday and the weekly recurring schedule, review historical/scheduled versions and download the original Excel file. The effective version is the latest effective date not after the selected date, with the higher revision winning ties. Future versions do not replace today's schedule early. Updates retain immutable versions and source files. A new weekly timetable remains effective until a later effective version replaces it; individual holiday exceptions and timetable notifications are not part of this release.

Positions, student-record access and attendance are unchanged by timetable uploads. This release checks conflicts within one person's weekly timetable; cross-teacher room/class allocation conflicts are not checked.

Private table: `atlas_school.staff_timetables`. Public invoker RPCs use private implementations that check the school product, active workspace membership and either school authority or the person's active employee link. Attendance managers alone cannot access another person's timetable unless independently granted school authority. Original files have the same access checks and are omitted from ordinary timetable responses. Direct table access is revoked with RLS enabled. The original workbook is stored privately with the version; it has no public URL.

Publishing takes a per-staff transaction lock, checks the expected latest version and supports identical request retries. Replacements that were based on stale data are rejected. Database validation independently checks periods and overlap rules. The browser parses the workbook; server-side checks validate the submitted period data, file size/type signature and authorization, rather than reparsing Excel.

## Release verification

Released to Supabase project hrxjgbupjtikokqxjzbh and https://atlas-os-8328y-erp.web.app on 28 November 2026 (Asia/Kolkata). Migration 20261128022004 applied. Verified 388 disposable database contracts, 31 focused unit/component/real-Excel tests, 80 browser tests, TypeScript, lint and production build. Production timetable APIs are invoker-only and deny anonymous execution. No synthetic timetable records were added to production.

The security advisor's private-table no-policy count increases from 27 to 28 as intended. Existing security-definer and leaked-password warnings remain as recorded in DEPLOYMENT_2026_11_27.md; this release adds no public definer endpoint.
