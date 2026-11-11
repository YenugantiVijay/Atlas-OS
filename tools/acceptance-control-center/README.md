# Atlas OS — Acceptance Control Center

**Private hosted tracker:** https://atlas-os-acceptance.hatchable.site

Development policy: `Vijay-Atlas → test → PR → main`. This code is proposed on the current development branch; keep `main` for reviewed changes.

## What is tracked
- Staging health and migrations 001–048.
- Actual authenticated JWT, goods receipt, supplier quote, price history, duplicate prevention, cross-tenant and role isolation, audits, immutable snapshots, stock and price safeguards.
- Verified / failed / blocked / unknown outcomes, exact next verification steps, HTTPS evidence, run history, commit and PR notes.
- GitHub CI and merges through an hourly read-only public API sync plus manual refresh.
- Conservative NO-GO until every current-main critical authenticated check passes and staging/migrations/main CI are healthy.

**Production remains untouched. The 200-entry Demo Mode industrial test stays excluded.**

## Source
- `site/`: React 18, Vite, TypeScript entry, htm React components, Vitest and Playwright UI checks.
- `backend/`: Hatchable API handlers, read-only GitHub sync and separate PostgreSQL evidence database.

Run `cd tools/acceptance-control-center/site && npm install && npm test && npm run build`.
For browser UI tests: `npx playwright install chromium && npm run test:e2e`.
Playwright intercepts /api/state with synthetic UI fixtures. It is **not** real Supabase-authenticated acceptance.

The hosted private tracker updates its state after every saved staging test and on GitHub sync. It invalidates earlier real-auth results when main SHA changes and never auto-verifies auth from Demo Mode.
