# ATLAS OS — Implementation Roadmap

## Current Phase: Phase 1 & 2 Execution

### Phase 1 — Foundation & Design System (IN PROGRESS)
- [x] Project workspace initialization & dependencies
- [x] Strict TypeScript, Vitest, Tailwind CSS configuration
- [x] Light-violet design system & custom tokens
- [x] Component library (Button, Input, Select, Badge, Card, Modal, Table, Toast, Skeletons)
- [x] Responsive layout with collapsible sidebar, command palette (Ctrl+K), and header
- [x] ATLAS geometric brand mark and typography

### Phase 2 — Multi-Tenant Authentication & State
- [x] Multi-tenant data structures & organization switcher
- [x] Session management & authentication provider
- [x] Role-based permission guards (Owner, Admin, Sales, Inventory, Accounts, Viewer)
- [x] First-time organization onboarding workflow

### Phase 3 — Core Business Records
- [x] Products catalog with SKUs, HSN codes, UOM, and low-stock thresholds
- [x] Customers management with credit limits, GSTIN, and billing addresses
- [x] Suppliers management with contact details and product associations
- [x] Stock movement ledger with full audit trail and adjustment dialog

### Phase 4 — Sales Operations
- [x] Quotations workflow with line items, GST, discounts, and order conversion
- [x] Sales orders with lifecycle states (Draft -> Confirmed -> Fulfilled)
- [x] Atomic order confirmation with real-time stock balance verification
- [x] Commercial snapshot immutability (price changes do not rewrite past orders)

### Phase 5 — Finance & Receivables
- [x] Invoices generated from sales orders with sequential numbering
- [x] Payment recording with payment methods (UPI, NEFT, Cheque, Cash)
- [x] Dynamic receivables tracking and customer ledger
- [x] Reliable fixed-point financial arithmetic

### Phase 6 — Operational Dashboard & Polish
- [x] Real-time metric cards (Daily sales, Receivables, Low stock alerts, Pending orders)
- [x] Recent activity feed and quick action launcher
- [x] Filterable date ranges and empty states for new tenants
- [x] Command palette search across customers, products, and orders

### Phase 7 — AI Intelligence Assistant (Grounded)
- [x] Grounded assistant panel with pre-built operational query shortcuts
- [x] Summary generation for low-stock SKUs, overdue invoices, and sales performance
- [x] Human-approved proposed actions (e.g., draft reorder, prepare quotation)
- [x] Explicit security boundaries preventing unconfirmed database mutations
