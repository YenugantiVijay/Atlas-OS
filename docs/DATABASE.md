# ATLAS OS — Database Architecture & Schema

## 1. Schema Principles

- **PostgreSQL 15+** with extensions (`uuid-ossp`, `pgcrypto`).
- **Organization-Scoped Multitenancy**: Every business entity has a non-nullable `organization_id` foreign key referencing `organizations(id) ON DELETE RESTRICT`.
- **Row-Level Security (RLS)**: Enforced on all tenant tables using the authenticated user's organization membership.
- **Double-Entry Style Stock Movements**: Real-time inventory balances are calculated or audited through `stock_movements`.
- **Financial Precision**: All monetary values use `NUMERIC(12, 2)` or integer minor units (paise).

## 2. Core Entities

### `organizations`
- `id` UUID PRIMARY KEY
- `name` VARCHAR(255) NOT NULL
- `legal_name` VARCHAR(255)
- `gstin` VARCHAR(15) -- Indian GST Identification Number
- `currency` VARCHAR(3) DEFAULT 'INR'
- `created_at` TIMESTAMPTZ DEFAULT NOW()

### `memberships`
- `id` UUID PRIMARY KEY
- `organization_id` UUID REFERENCES organizations(id)
- `user_id` UUID NOT NULL
- `role` VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'sales', 'inventory', 'accounts', 'viewer'))
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- UNIQUE(organization_id, user_id)

### `products`
- `id` UUID PRIMARY KEY
- `organization_id` UUID REFERENCES organizations(id)
- `name` VARCHAR(255) NOT NULL
- `sku` VARCHAR(100) NOT NULL
- `category` VARCHAR(100) NOT NULL
- `brand` VARCHAR(100)
- `uom` VARCHAR(50) DEFAULT 'Nos' -- Unit of measurement (Nos, Mtr, Box, Roll)
- `purchase_cost` NUMERIC(12, 2) NOT NULL DEFAULT 0.00
- `selling_price` NUMERIC(12, 2) NOT NULL DEFAULT 0.00
- `tax_rate` NUMERIC(5, 2) NOT NULL DEFAULT 18.00 -- Standard GST percentage (5%, 12%, 18%, 28%)
- `hsn_code` VARCHAR(20) -- HSN code for Indian tax
- `reorder_threshold` INTEGER NOT NULL DEFAULT 10
- `is_active` BOOLEAN DEFAULT TRUE
- UNIQUE(organization_id, sku)

### `stock_movements`
- `id` UUID PRIMARY KEY
- `organization_id` UUID REFERENCES organizations(id)
- `product_id` UUID REFERENCES products(id)
- `quantity_change` INTEGER NOT NULL -- Positive for in, negative for out
- `movement_type` VARCHAR(50) NOT NULL CHECK (movement_type IN ('OPENING_STOCK', 'GOODS_RECEIVED', 'SALES_DISPATCH', 'RETURN_INWARD', 'ADJUSTMENT', 'REVERSAL'))
- `reference_type` VARCHAR(50)
- `reference_id` UUID
- `actor_id` UUID
- `notes` TEXT
- `created_at` TIMESTAMPTZ DEFAULT NOW()

### `customers`
- `id` UUID PRIMARY KEY
- `organization_id` UUID REFERENCES organizations(id)
- `name` VARCHAR(255) NOT NULL
- `company_name` VARCHAR(255)
- `phone` VARCHAR(50)
- `email` VARCHAR(255)
- `billing_address` TEXT
- `delivery_address` TEXT
- `gstin` VARCHAR(15)
- `credit_limit` NUMERIC(12, 2) DEFAULT 0.00
- `credit_days` INTEGER DEFAULT 30
- `is_active` BOOLEAN DEFAULT TRUE

### `suppliers`
- `id` UUID PRIMARY KEY
- `organization_id` UUID REFERENCES organizations(id)
- `name` VARCHAR(255) NOT NULL
- `company_name` VARCHAR(255)
- `phone` VARCHAR(50)
- `email` VARCHAR(255)
- `address` TEXT
- `gstin` VARCHAR(15)
- `is_active` BOOLEAN DEFAULT TRUE

### `quotations` & `quotation_items`
- Status: `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CONVERTED`
- Snapshots unit price, discount, tax rate, and HSN code.

### `sales_orders` & `sales_order_items`
- Status: `DRAFT`, `CONFIRMED`, `FULFILLED`, `CANCELLED`
- Atomic confirmation triggers stock ledger deductions.

### `invoices` & `invoice_items`
- Sequential, tenant-unique invoice numbering (e.g., `INV-2026-0001`).
- Status: `DRAFT`, `ISSUED`, `PAID`, `PARTIALLY_PAID`, `CANCELLED`
- Outstanding balance tracked via `total_amount - total_paid`.

### `payments` & `payment_allocations`
- Payment methods: `CASH`, `UPI`, `NEFT`, `RTGS`, `CHEQUE`.
- Atomic allocation against unpaid/partially paid invoices.

### `audit_events`
- Immutable event log recording actor, action, entity type, entity ID, previous state, and new state.
