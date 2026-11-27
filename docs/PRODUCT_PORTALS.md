# Product subscriptions and role portals

Atlas authenticates a person, then authorizes a workspace, its bound product and the assigned portal. An email/password identifies the account; it is not a licence for every industry. A person may legitimately belong to multiple organizations, but each product workspace has its own subscription and permissions.

## Entry points

The public website provides `/login/`, with separate product/role links. The ERP provides **My Portals**, showing assigned portals for the current workspace. Product URLs use `?tool=<product>&portal=<portal>`; navigating between role links reloads the page into a distinct session rather than changing the existing workspace skin.

- Businesses: Owner/Admin, Workspace (authorized sales, inventory, accounts and read-only staff), Manager/HR, Employee.
- Schools: School Admin, Admissions, Teacher, School Accounts, Parent, Student, Manager/HR and Employee where assigned.
- Employee opens personal check-in/out, breaks, daily work summaries and attendance history. Manager/HR opens the existing authorized team attendance/reporting tools; manager grants remain controlled by the existing staff-attendance permissions.
- School staff portals use school roles and teacher class assignments. Parents/students use explicit student account links and receive read-only linked records, recent attendance, outstanding fees and recorded receipt summaries. Exams, homework and report cards remain later school phases.

## Product boundaries

`atlas_private.workspace_products` binds one product to each organization. Migration backfills the current supported business category; future organizations bind their initial product when declaring eligibility. Changing an eligibility declaration to a different supported product is rejected. A client cannot update the binding or acquire another product through a URL, user metadata, an edition change or a second login.

A different product needs a separate organization and its own valid trial/subscription. Existing anti-abuse checks for repeated trials, eligibility review, membership roles, MFA, subscription dates and edition scope remain enforced. No charge or subscription activation is fabricated by portal selection. Existing pricing editions continue to apply within the selected workspace; portal links are not payment confirmation.

The client filters the saved organization list by both product and assigned portal through `atlas_product_workspaces`; an old company selection such as an electronics workspace is not reused for a school entry. Requested-product headers add a boundary to read/write authorization. Fixed school, e-commerce and specialty RPCs validate their product even when headers are omitted. Restrictive ERP table policies and guarded privileged business RPCs prevent a school subscription from exposing ERP ledgers. Attendance-only viewers can read their linked staff profile/attendance without acquiring ERP customer/catalog/finance access. Their attendance-only classification persists after disabling or relinking the employee account, so revocation cannot accidentally promote them into ERP viewer access. Business roles must be assigned explicitly.

Product/portal browser sessions, saved organization selections, demo mode, demo records, specialty records, counter drawers, receiving scratchpads and offline recovery queues are isolated. Legacy local data is retained in its original keys rather than copied into new products. Signing out revokes the current Supabase session locally, preserving other independently signed-in portals.

## Assigning people

1. Owners invite each person through **Team & Access** with their own account. Do not share an administrator account.
2. Business staff receive the required ERP role and/or existing attendance manager/employee account link.
3. School owners use **School permissions** to grant school staff roles and assign teacher classes.
4. For family access, invite a parent/student with a viewer membership. Open **School → Students → View profile → Parent / student account access**, choose the account and portal, and link that student. The server verifies ownership, active membership and the school/student boundary.
5. Revoke a family link from the same screen. A parent link does not authorize the student portal, or vice versa. Inactive membership immediately blocks requests, and an owner can revoke links even while the member is inactive or the subscription has expired. New links still require operational write access.

## Deployment and audit

Deploy `20261127090729_product_portals_and_entitlements.sql` after all prior migrations, then deploy the ERP and website builds. The prior two school migrations must also be installed. A git push alone does not change the hosted database or Firebase application. Configure the public website app URL and the existing Firebase ERP Hosting target before publishing portal launch links.

Before rollout, review existing `organization_eligibility` categories. Supported categories retain their current product. Workspaces without a supported declaration have no bound product and fail closed until the intended product is declared through an authorized eligibility/review flow; do not bulk-enable all products. Product binding changes for an existing workspace are not exposed as a client self-service action.

Regression coverage includes all existing ERP/school/staff database contracts; product and portal denial with changed/omitted headers; raw and privileged ERP access; teacher/accounts role checks; parent/student isolation and revocation; inactive membership; endpoint execution privileges; and backup/restore checks covering the product bindings and family links. UI and browser tests cover login entry URLs, stale-company filtering, separate storage, invalid portals, mobile layouts and existing operations.

These checks establish the tested behavior. They do not certify every deployment, integration or production dataset as perfect; hosted configuration and migration state must be verified during deployment.
