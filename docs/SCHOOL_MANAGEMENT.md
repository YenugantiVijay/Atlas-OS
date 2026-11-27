# School Management — phases 1 and 2

Choose **School Management** when creating a workspace, or select the school preset (`?tool=school`). School workspaces open the school dashboard at `/` and `/school`. Cloud authentication is required; demo mode shows a labelled workflow preview without simulated student records.

## First setup

1. As workspace owner, open **School setup**, save the school profile and receipt prefix, and create the academic year, terms, classes/sections and calendar entries. Board and grading notes are stored for later academic modules; this release does not calculate grades.
2. Invite staff using Atlas Team. In **School permissions**, assign each active member a school role and assign teachers to classes. School roles are independent of the general ERP roles. The owner has school access automatically.
3. Add existing students manually or use **Students → Import CSV**. Download the nine-column template, select one class, preview and check duplicate admission numbers, then confirm. Each batch of 1–200 students commits together or fails together. Dates use `YYYY-MM-DD`; admission identifiers are normalized to uppercase and unique within the school.
4. For new applicants, create an enquiry and advance it through application, review and approval. Admitting an approved application creates the student and academic-year enrolment atomically.

## Permissions

- Owner: all school functions and assignment/removal of school roles.
- Principal: school administration, admissions, attendance, accounts, concession and refund approval.
- School administrator: school administration, admissions, attendance and accounts; cannot approve financial adjustments or grant roles.
- Admissions: applications and student records; no attendance writing or finance.
- Teacher: student register and attendance for assigned classes only; no school finance or admissions pipeline.
- Accountant: student contact directory, fee schedules, collection recording and adjustment requests; no birth dates/address/previous-school details, admissions pipeline, attendance writing or adjustment approval.

School writes also require an active membership, approved workspace eligibility and current operational write access. Removing school access takes effect on the next server request; all commands and reads authorize on the server. Raw school table access is denied even to signed-in clients. Owner-only role management accepts existing active workspace members, not arbitrary accounts.

## Student attendance

Choose the academic year, class and date (IST). Select explicit Present, Absent, Late, Half day or Approved leave values, then save. Unmarked days remain unmarked and do not count as absences. “Select Present for this page” is an explicit convenience action, not an automatic attendance rule. Future dates and dates outside the student's class academic year or before joining are rejected. Corrections require a reason and the current revision; previous revisions remain stored. Monthly reports count latest recorded statuses and export CSV; no assumed holiday schedule or attendance percentage is invented. Calendar entries do not auto-mark attendance.

## Fees and receipts

Create a fee category and a class instalment with due date, INR amount, explicitly configured tax rate and treatment note. The software does not determine a school's tax exemption or GST liability. Issue each schedule to the class; repeating issue creates charges only for newly enrolled students. Existing charge snapshots remain unchanged.

Amounts use integer paise. Tax for a charge is rounded once, half-up: `floor((base_paise × tax_basis_points + 5000) / 10000)`. Outstanding = issued base + configured tax − approved concessions − allocated payments + approved receipt returns. No late fee or interest is applied automatically.

Record partial or full cash/UPI/bank/cheque collections. Non-cash collections require a reference. Overpayment is rejected; payment is allocated to oldest due charges first. Recording payment does not initiate a transfer or verify bank/UPI settlement. Requests use UUID idempotency keys; repeating identical acknowledged data with the same key returns the original result. An uncertain form submission blocks editing until records are refreshed; review current records before resubmitting.

School receipts have organization-scoped sequential numbers, immutable school/student snapshots, allocation lines and printable copies. Concession/scholarship requests and refund/reversal requests require owner or principal approval and revalidate the current balance. Refunds restore the corresponding dues; reversals undo the remaining retained receipt amount. Original receipts are preserved, with approved adjustments shown separately. Actual refunds must be carried out separately through the stated payment method.

School reports show total charged, concessions, net paid and dues for the whole filter, independently of pagination. Collection reports show positive recorded collections, negative approved refunds/reversals and net retained collections. CSV exports include the complete filter up to 5,000 rows and fail with a narrowing instruction rather than silently truncating. Date-range reports support up to 371 days. Student/enrolment history is retained when creating the next academic year's enrolment; this is manual enrolment, not automatic promotion.

## Release and verification

Apply migrations in order, including `20261127065313_school_management_foundation.sql` (commits the school business-category enum) followed by `20261127065658_school_management_core.sql`. Deploy the ERP build separately from the public marketing site. Do not assume a git push applies hosted database migrations or deploys Firebase. Existing Firebase website project: `atlas-os-8328y`; the ERP Hosting target must be configured separately as documented in the existing deployment setup.

`npm run test:db` includes school workflow, access, tax rounding, full-filter reporting, immutable receipt, revision, next-year enrolment and competing refund tests. `ATLAS_TEST_RESTORE=1` adds the backup/restore rehearsal. Frontend tests cover CSV validation, exact money, permission-specific screens, explicit attendance selection, failed reads, complete exports and uncertain payment retries.

## Later phases

Timetables, homework, examinations, report cards, parent/student portals, library, transport, biometric devices, automated messaging and payment gateway integrations are not part of these two phases. No government identifier or student document upload is collected. Staff self-service attendance remains available through the existing Employee Attendance module.
