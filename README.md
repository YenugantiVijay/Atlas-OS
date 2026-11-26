# ATLAS OS

### The operating system for electrical distribution businesses.

**One workspace. Connected operations. Smarter decisions.**

ATLAS OS is an AI-ready business operations platform designed for electrical-goods wholesalers and distributors in India. It aims to bring products, inventory, customers, quotations, sales orders, invoices, payments, and business insights into one connected workspace.

Instead of managing daily operations across disconnected spreadsheets and tools, distributors can work toward a single source of truth for their business.

> **Project status:** Active development. The current codebase includes a React/TypeScript application, a local mock-data engine, initial Supabase integration, PostgreSQL migrations, and automated tests. Authentication, database security, and critical transactional workflows require further verification before production use.

---

## ✨ Vision

ATLAS OS is being built to help electrical distributors move from fragmented operations to connected, data-driven business management.

The long-term vision is to combine reliable distribution workflows with AI-assisted insights and, eventually, an optional network connecting buyers and suppliers.

### What we're building

- **Unified operations** — Manage core business workflows in one place.
- **Inventory visibility** — Track stock movements, quantities, and low-stock products.
- **Connected sales workflows** — Move from quotations to orders and invoices.
- **Receivables management** — Track payments, outstanding balances, and overdue invoices.
- **Business intelligence** — Turn operational records into useful reports and insights.
- **AI-assisted workflows** — Introduce grounded recommendations and human-approved actions.
- **Extensible architecture** — Build a foundation for future integrations and business-network capabilities.

---

## 🚀 Product capabilities

The repository currently contains the following application areas. Their presence in the codebase does not mean every workflow has been fully implemented or production-verified.

| Module | Purpose |
|---|---|
| Dashboard | Overview of business activity and key metrics |
| Products | Electrical product catalog and SKU management |
| Inventory | Stock movements, adjustments, and low-stock visibility |
| Customers | Customer records and business relationships |
| Suppliers | Supplier information and management |
| Quotations | Prepare and manage customer quotations |
| Sales orders | Track sales order workflows |
| Invoices | Invoice and document management |
| Payments | Payment history and receivables visibility |
| Reports | Business reporting and summaries |
| Team | Organization membership and access management |
| Audit | Visibility into business activity |
| AI assistant | Initial rule-based business assistance |

### Planned capabilities

- Secure multi-organization access
- Fully verified transactional inventory management
- Reliable quotation-to-order-to-invoice workflows
- Robust payment allocation and receivables
- AI-generated insights grounded in authorized business data
- Approval-based AI actions
- CSV import/export and accounting integrations
- Optional supplier and buyer network

These capabilities will be marked complete as their implementations and tests are verified.

---

## 🧰 Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18 |
| Language | TypeScript |
| Build tooling | Vite |
| Styling | Tailwind CSS |
| Routing | React Router |
| Server state | TanStack Query |
| Forms and validation | React Hook Form, Zod |
| Icons | Lucide React |
| Backend platform | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth integration |
| Database security | PostgreSQL Row-Level Security (RLS) |
| Unit testing | Vitest |
| UI testing | React Testing Library |
| Browser testing | Playwright |

---

## 🏗️ Architecture

ATLAS OS follows a feature-oriented application structure, with shared UI components, API/data-access modules, database migrations, and tests.

```text
atlas-os/
├── public/
├── src/
│   ├── app/                 # Application setup and routing
│   ├── components/          # Shared UI and layout
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── products/
│   │   ├── inventory/
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── quotations/
│   │   ├── orders/
│   │   ├── invoices/
│   │   ├── payments/
│   │   ├── reports/
│   │   ├── team/
│   │   └── ai/
│   ├── lib/                 # API, data, validation and utilities
│   ├── types/               # TypeScript types
│   └── test/                # Test setup
├── supabase/
│   ├── migrations/          # Versioned database schema
├── docs/                    # Architecture, security and setup docs
├── e2e/                     # Intended browser-test location
├── package.json
├── .env.example
└── README.md
```

Some directories and workflows are still being completed. Consult the actual repository state rather than assuming every planned component is available.

---

## 💻 Getting started

### Prerequisites

- Node.js LTS
- npm
- Git
- A code editor such as Visual Studio Code

### 1. Clone the repository

Replace `YOUR_USERNAME` with your GitHub username.

```bash
git clone https://github.com/YOUR_USERNAME/atlas-os.git
cd atlas-os
```

### 2. Install dependencies

```bash
npm ci
```

Run `npm ci` again after pulling changes to the root `package-lock.json`.

### 3. Configure environment variables

Copy the example configuration file.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env.local
```

**macOS/Linux:**

```bash
cp .env.example .env.local
```

The example file currently uses these variable names:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ENABLE_MOCK_FALLBACK=false
```

Use the correct public key type supported by your Supabase project and the application's current configuration. Do not put service-role keys, database passwords, or private AI API keys in frontend-exposed environment variables.

### 4. Open a local preview

On Windows, double-click **`open-atlas.cmd`** in the repository folder. Press **W** for Website, **E** for ERP Tool, **O** for Owner Portal, or **A** to open all three tabs.

| Direct launcher | Opens |
| --- | --- |
| `preview-website.cmd` | Website on port 4321 or the next available preview port |
| `preview-tool.cmd` | [ERP Tool](http://127.0.0.1:5173/) |
| `preview-owner.cmd` | [Owner Portal](http://localhost:5173/owner/) |

The ERP and Owner Portal share one server. The launchers use staging mode when `.env.staging` or `.env.staging.local` exists and development mode otherwise. The Owner Portal requires a configured Supabase project and an enrolled owner account. Keep the server windows open for live reload. After switching branches or pulling new commits, close the old server windows and reopen the launcher.

On macOS or Linux, run `npm run dev:staging` for a configured staging checkout or `npm run dev` for development from the repository root, then open the ERP or Owner Portal link above. For the website, install its dependencies and run `npm --prefix atlas-os-website run dev -- --host 127.0.0.1`. For release builds, see the [website build instructions](atlas-os-website/README.md).

### Industry tool workspaces

The industry download pages link to a selected workspace in the shared Atlas OS web app. For example, the Retail & Wholesale Counters preview opens at `http://127.0.0.1:5173/?tool=retail-wholesale#/`. The existing business category selects the default workspace for signed-in users when the link does not name a tool. Roles and tenancy still determine record access.

Set `PUBLIC_APP_URL` in the website build to the public HTTPS URL of the ERP app. The industry pages then offer browser installation guidance, a browser link to the matching workspace, and an optional `.url` shortcut export. Chromium on Windows may rename shortcut exports to `.download`; use **Install Atlas OS** for browser-supported installation instead. See [online-first PWA setup](docs/ONLINE_FIRST_PWA.md). For a separate web deployment tied to one tool, use the matching Vite mode and publish its output directory. The tool mode takes priority over the URL selector. For example:

```sh
npm run build -- --mode tool-retail-wholesale --outDir dist-tools/retail-wholesale
```

Tool IDs are `electrical`, `electronics`, `hardware`, `retail-wholesale`, `agricultural-inputs`, `ecommerce`, `small-business`, `banner-print-studio`, `ice-cream-stalls`, and `ice-cream-distribution`. Supply the deployment's public Supabase settings in the build environment or the corresponding Vite mode environment file.

### Local development notes

The project includes a local mock-storage implementation for development and demonstration.

Mock data is not a shared database, is not a substitute for authenticated Supabase operations, and must not be used as proof of production security.

Do not enter real customer, payment, or confidential business data into an unverified development environment.

---

## 🗄️ Supabase setup

To configure a separate development backend:

1. Create a Supabase project.
2. Configure the public project URL and supported public key in `.env.local`.
3. Review all SQL migrations before applying them.
4. Apply the migrations in the documented order to a development database.
5. Run database security and integration tests.
6. Verify authentication, organization isolation, and business workflows before using real data.

The repository currently contains these migration files:

```text
supabase/migrations/
├── 001_multi_tenant_base.sql
├── 002_products_customers_suppliers.sql
├── 003_inventory_ledger.sql
├── 004_quotations_and_orders.sql
└── 005_invoices_and_payments.sql
```

**Important:** Do not apply these migrations to a production database without a security review. The existing database policies and critical workflows still require hardening and verification.

For local demos, use fictional data. Never expose privileged credentials in the frontend or commit them to GitHub.

---

## 🧪 Testing

The repository is configured with scripts for several development checks.

```bash
# Run unit tests
npm test

# Watch tests during development
npm run test:watch

# Check TypeScript types
npm run typecheck

# Build the application
npm run build

# Preview the production build
npm run preview
```

Additional scripts are declared for coverage, linting, and Playwright end-to-end testing. Verify their dependencies and configuration before relying on them.

### Quality goals

Before production use, the project must verify:

- Authentication and session handling
- Organization-level data isolation
- Role-based permissions
- Atomic stock changes
- Concurrent order handling
- Correct financial calculations
- Invoice and payment consistency
- Duplicate-request protection
- Audit-event integrity
- End-to-end business workflows
- Production build and deployment configuration

A successful frontend build alone does not establish production readiness.

---

## 🔐 Security principles

Security is a core requirement for ATLAS OS because it handles business and financial records.

The intended security model includes:

- Organization-scoped data access
- PostgreSQL Row-Level Security
- Server-side or database-side permission checks
- Transactional inventory and financial operations
- Protected secrets and environment configuration
- Audit trails for consequential actions
- Human approval for sensitive AI-assisted actions

These are design goals and implementation requirements, not a claim that every control has already passed an independent security review.

**Do not use the current project for real financial or customer data until authentication, RLS policies, database privileges, and transactional workflows have been reviewed and tested.**

---

## 🗺️ Roadmap

> **Follow the active feature plan:** [Atlas OS Master Feature Register](docs/ATLAS_OS_MASTER_FEATURE_REGISTER.md) — the 140 discussed capabilities, status, delivery waves, and market-readiness dependencies. The older checklist below records historic milestones and is not proof of production certification.



### Phase 1 — Core operations
- [x] Initial React/TypeScript application
- [x] Initial feature-oriented UI
- [x] Local mock-storage engine
- [x] Initial PostgreSQL migration set
- [ ] Verified Supabase authentication
- [ ] Hardened multi-tenant security
- [ ] Atomic inventory and order workflows
- [ ] Complete invoice and payment operations

### Phase 2 — Reliability and reporting
- [ ] Consistent financial calculations
- [ ] Verified dashboard metrics
- [ ] Complete end-to-end testing
- [ ] Import/export workflows
- [ ] Production deployment review

### Phase 3 — AI-assisted operations
- [ ] Secure AI provider integration
- [ ] Business summaries grounded in authorized records
- [ ] Low-stock and receivables insights
- [ ] Human-approved workflow actions
- [ ] AI privacy and safety verification

### Phase 4 — Connected distribution
- [ ] Supplier and buyer discovery
- [ ] Procurement coordination
- [ ] Optional business-to-business integrations

Roadmap items will be updated as implementation and verification progress.

---

## 🤝 Contributing

ATLAS OS is under active development.

Before contributing:

1. Open an issue describing the bug or proposed improvement.
2. Keep changes focused and easy to review.
3. Include tests for business logic and security-sensitive behavior.
4. Avoid committing secrets, local environment files, or real business data.
5. Update documentation when changing application behavior.
6. Never weaken authorization or financial validation to make a test pass.

Contribution access and licensing terms will be defined by the repository owner.

---

## 📄 License

This project is currently proprietary and under active development.

No permission to redistribute, sublicense, or use the software commercially is granted unless explicitly provided by the copyright holder.

A `LICENSE` file should be added to the repository to formalize the applicable terms.

---

## 🌐 The bigger picture

ATLAS OS aims to become more than a collection of management screens. The goal is to create a dependable operational foundation for electrical distributors and progressively make everyday business decisions easier through connected data, useful insights, and carefully controlled automation.

**Build the foundation. Validate with real businesses. Scale with confidence.**

### E-commerce and platform administration

- Select **E-commerce / Online Sales** when setting up a workspace to use the violet industry palette and online catalog suggestions. Other workspaces can also open **Sales → E-commerce Orders** for online transactions.
- In **E-commerce Orders**, create a draft with the channel and the original order reference. If you use several stores on one channel, include the store or marketplace name in the reference. Confirm stock using the standard order workflow. Open the confirmed order to record the carrier and tracking reference. Issue the invoice and record the payment in the existing billing and payments screens.
- Cloud workspace users can submit a support report and follow its status in **Support**. Website support enquiries submitted through the verified contact form enter the same inbox.

### Private operations build

The ERP and private operations console have separate release builds. Use `npm run build` for the ERP and `npm run build:owner` for the private console. Serve the latter on a private origin and set the Supabase URL and publishable key for its build in `.env.owner.local`. The local ERP development server can open both entry points.

The console requires an explicit database seat and a verified authenticator. After applying the database migration, provision the intended Supabase Auth UUID in `atlas_private.owner_console_accounts` using a trusted administrator. Seat numbers are limited to 1, 2 and 3. The existing `platform_reviewers` grant is additionally required for business verification decisions. Use individual accounts.

Purchases are manually reconciled records. Subscription access changes are separate and audited. Website intake uses the existing Turnstile and rate limits. Optional AI summaries require the `owner-report-summary` Edge Function and its server-side `OWNER_CONSOLE_ORIGINS`, `OWNER_SUMMARY_MODEL`, and `OWNER_SUMMARY_OPENAI_KEY` settings. Dashboard alerts work without an AI provider and refresh while the console is open.

### Specialty operations

- **Banner & Print Studio** keeps mixed-unit quotes, artwork revision references, staged jobs, received amounts and balances together. Open print jobs by due date shows the production queue to prioritize.
- **Ice Cream Stalls** records the staff member and opening and closing cash for each named stall and business day. Stock receipts and sales track packaged pieces and estimated scoops separately, and the till compares closing cash with opening cash plus cash sales.
- **Ice Cream Distribution** tracks bulk case receipts, batch expiry, freezer stock, outlet commitments, partial dispatch and returns or credit allowances. Committed and dispatched cases over 7 days tracks throughput; Open case commitments shows backlog by order and SKU.

The specialty records are operational records. Use the existing invoicing and payment tools for GST invoices, credit notes and accounting entries. Demo changes are browser-local. Apply the industry-workspaces migration to the target cloud database before using live specialty operations.
