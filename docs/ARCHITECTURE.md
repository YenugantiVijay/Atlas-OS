# ATLAS OS — System Architecture

## 1. Architectural Overview

ATLAS OS is designed as a **modular monolith** with clean layer separation, tenant isolation by default, deterministic business transactions, and optional AI assistance grounded in authorized operational data.

```text
[ Browser / React 18 Application Shell ]
  ├── Features (Auth, Dashboard, Products, Inventory, Orders, Quotations, Invoices, Payments, Team, AI)
  ├── State Management (TanStack Query for server state, React Context for session/tenant)
  └── Design System (Light-violet Tailwind CSS token system)
           │
           ▼
[ Client Data Access Layer (src/lib/api) ]
  ├── Storage / Backend Router (Switches seamlessly between Supabase & Local Engine)
  ├── Deterministic Financial Calculations (src/lib/money.ts)
  └── Permission Guard & Policy Checks (src/lib/permissions.ts)
           │
     ┌─────┴────────────────────────────────┐
     ▼                                      ▼
[ Supabase PostgreSQL Backend ]    [ In-Memory / Local Storage Engine ]
  ├── Row Level Security (RLS)       ├── 100% Schema & Constraint Parity
  ├── Transactional Functions (RPC)  ├── Atomic Order Confirmation & Rollback
  ├── Stock Movement Ledger          ├── Stock Balance & Over-selling Guard
  └── Immutable Audit Trail          └── Multi-tenant Organization Isolation
```

## 2. Directory Structure

```text
atlas-os/
├── public/                 # Static assets, favicon, logo SVG
├── src/
│   ├── app/                # Router, global providers, query client
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── query-client.ts
│   ├── components/         # Reusable UI & design system
│   │   ├── ui/             # Buttons, inputs, dialogs, badges, cards, tables
│   │   ├── layout/         # Header, sidebar, command palette, page wrapper
│   │   ├── forms/          # Form fields, search bars, selectors
│   │   └── feedback/       # Alerts, toasts, skeletons, empty states
│   ├── features/           # Feature modules
│   │   ├── auth/           # Login, signup, password reset, session guard
│   │   ├── organizations/  # Multi-tenant onboarding, tenant switcher
│   │   ├── dashboard/      # Operational metrics, activity feed, quick charts
│   │   ├── products/       # Product catalog, SKUs, pricing, categories
│   │   ├── inventory/      # Stock movements, ledger, adjustments, reorder alerts
│   │   ├── customers/      # Customer records, receivables ledger, credit limit
│   │   ├── suppliers/      # Supplier catalog, purchase associations
│   │   ├── quotations/     # Quotation builder, discounts, conversion to order
│   │   ├── orders/         # Sales orders, lifecycle, atomic stock reservation/deduction
│   │   ├── invoices/       # Tax invoice generation, snapshot pricing, GST
│   │   ├── payments/       # Payment records, allocation to invoices, receipts
│   │   ├── receivables/    # Aging buckets, overdue tracking, customer statements
│   │   ├── team/           # Member invitations, roles, permissions
│   │   ├── audit/          # System audit trail and event log
│   │   └── ai/             # Grounded AI assistant with explicit human approval
│   ├── lib/                # Core domain logic
│   │   ├── supabase.ts     # Supabase client instantiation & typed queries
│   │   ├── storage.ts      # Storage adapter interface & local mock engine
│   │   ├── money.ts        # Decimal/integer financial precision math
│   │   ├── permissions.ts  # Role-based access control matrix
│   │   ├── validation.ts   # Zod schemas for all domain entities
│   │   └── errors.ts       # Structured application errors
│   ├── types/              # Domain models and database types
│   ├── styles/             # Global CSS and Tailwind directives
│   └── test/               # Vitest test setup and test utilities
├── supabase/
│   ├── migrations/         # PostgreSQL schema migrations
│   └── seed.sql            # Realistic electrical distributor seed data
├── docs/                   # Architectural & technical documentation
├── e2e/                    # Playwright end-to-end tests
├── package.json
└── vite.config.ts
```

## 3. Trusted Operation Boundaries

1. **Inventory Movements**: Stock cannot be mutated directly through an update query. All balance changes are driven by rows inserted into `stock_movements`.
2. **Atomic Order Confirmation**: Orders transition from `DRAFT` to `CONFIRMED` via a transactional function (`confirm_sales_order`) that verifies available stock under row locks, writes deduction movements, updates the order status, and logs an audit event atomically.
3. **Price Snapshots**: Items in quotations, sales orders, and invoices store snapshot unit prices, tax rates, and descriptions at transaction time. Modifying product catalog prices never mutates historical sales or invoices.
4. **Financial Arithmetic**: Calculations are conducted with fixed decimal math (2 decimal places) avoiding JavaScript binary floating-point inaccuracies.

## 4. AI Architecture & Safety Boundary

The ATLAS AI assistant is bounded by deterministic business logic:
`User Prompt -> Permission Verification -> Intent Classification -> Authorized Query -> Deterministic Calculation -> AI Explanation/Proposed Action -> User Explicit Confirmation -> Trusted Database Operation -> Audit Trail`
The AI model has no direct database write privileges and cannot invent prices, inventory balances, or invoice numbers.
