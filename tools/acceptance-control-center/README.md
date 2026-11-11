# Atlas OS — Independent Acceptance Control Center

**No Hatchable account or deployment required.** This project now runs entirely on localhost, using a private Node.js evidence API and the existing React/Vite/TypeScript UI. The former Hatchable backend in `backend/` is **legacy reference code only**, not part of the local runtime.

## Windows startup

From the Atlas OS repository:

```powershell
cd tools\acceptance-control-center\site
npm install
npm run dev
```

Visit **http://127.0.0.1:4178**. The local API listens only at `127.0.0.1:4179`. For a standalone built site, use `npm run build` followed by `npm run server` and open `http://127.0.0.1:4179`. Data persists in `site/.data/acceptance.json`, which is excluded from Git.

```powershell
npm run test:api  # Node tests: evidence storage, origin checks and no-go enforcement
npm test          # Vitest decision rules
npm run build     # TypeScript + Vite
npm run test:e2e  # Playwright UI using safe fixture state
```

## Workflow and scope

- Preserve **Vijay-Atlas → tests → PR review → main**. Do not merge without successful CI.
- Track staging health, migrations **001–048**, authenticated GRN drafts/posts, supplier quotes/history, duplicate submission, cross-tenant isolation, role rules, audit events, immutable prices, and stock/price safeguards.
- **verified / failed / blocked / unknown** statuses include dated evidence links and exact next steps. The local backend persists an append-only test-run journal. The dashboard calculates GO/NO-GO after each test and refreshes read-only GitHub merge/CI metadata.
- No Supabase service key, no Atlas production database access, and no automatic GRN or quote execution. The **200-entry Demo Mode industrial test is excluded**.
- A real-auth check cannot become verified from SQL simulation, Demo Mode, Vitest, or unauthenticated CI: it needs a real staging authenticated-browser/API observation, HTTPS evidence, and exact current main commit.
- The 11 November staging health snapshot expires after 24 hours; migrations 001–048 were read-only confirmed that day but must be rechecked when staging changes.
- The migration grid uses **the actual staging migration names and Supabase migration IDs**, including timestamp-based IDs for migrations 015–048; upgrading the tracker preserves previously recorded pass/fail evidence.
- The release gate rejects missing or duplicate migration numbers, missing mandatory critical checks, and any newer pending/failed `ATLAS OS CI` run on current `main`. GitHub sync includes main CI separately even during heavy development.
- At the 11 November 2026 audit, staging had **0 Auth users and 0 organizations**. `AUTH-01` and downstream real-auth tests cannot pass until staging-only test identities are provisioned. Do not provision production users or claim that a simulated SQL role is genuine authentication.
- Recorded evidence is an operator assertion. Review traces before production approval.
- GitHub API reads may need optional `GITHUB_TOKEN` for higher rate limits. Never place it in frontend code or commit credentials.
- For offline/isolated testing, `ATLAS_TRACKER_DISABLE_GITHUB_SYNC=1` stops network synchronization, leaving the release at **NO-GO**.

## Legacy status

PR #59 previously stored a Hatchable-specific backend. The preferred implementation is now `site/local/server.mjs` and `site/local/checks.mjs`. Neither the local app nor its CI needs Hatchable.
