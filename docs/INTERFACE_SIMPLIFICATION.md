# Interface simplification — 28 November 2026

Atlas now starts with a shorter navigation menu. Sales, Inventory, Finance, People and Administration expand on request; direct routes open their containing group. The module search filters only already-authorized navigation entries, opens matching groups and clears after selecting a page. Role and industry filtering still applies before search. Mobile navigation closes after selecting a module.

The shared workspace heading uses a compact plain layout. Dashboard onboarding/import and reconciliation panels are expandable, with low-stock warnings still visible. Specialty workspaces keep activity graphs collapsed and group privileged reports and location administration behind a labelled disclosure. Uncertain-save recovery stays visible. School sections use one role-filtered selector on phones and a horizontally scrollable module row on larger screens. Switching sections uses the existing URL parameters.

This is a presentation change. It does not change subscriptions, authentication, role checks, tax calculations, financial posting, database schemas or saved operational records. Existing features remain reachable through their modules and global search. The footer says “Cloud configured” when a cloud connection is configured; it does not claim that connectivity has been verified.

The hierarchy takes reference from [Zoho Books navigation](https://www.zoho.com/us/books/help/getting-started/navigating-zoho-books.html). Atlas retains its own branding and workflow names. No Zoho download is required.

Validation: 21 focused unit/component tests, all 88 browser tests, lint, TypeScript production build and repository hygiene passed. Browser coverage includes grouped navigation, authorized module search, direct-route recovery, phone-menu closing, stock/cash workflows, school timetable upload, and overflow checks at 320, 375, 768 and 1280 pixels. Desktop, phone catalog and phone stall screenshots were visually reviewed using synthetic demo data. No database migration is needed for this release.
