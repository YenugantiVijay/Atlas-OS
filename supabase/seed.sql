-- ============================================================================
-- ATLAS OS DEVELOPMENT SEED DATA (Indian Electrical-Goods Wholesale)
-- ============================================================================

-- 1. Organizations
INSERT INTO organizations (id, name, legal_name, gstin, phone, email, address_line1, city, state, pincode)
VALUES
('a0000000-0000-0000-0000-000000000001', 'Sri Lakshmi Electrical Distributors', 'Sri Lakshmi Electricals Pvt Ltd', '29ABCDE1234F1Z5', '+91 98450 12345', 'sales@srilakshmielectricals.in', '42, BVK Iyengar Road, Chickpet', 'Bengaluru', 'Karnataka', '560053'),
('b0000000-0000-0000-0000-000000000002', 'Apex Electro Controls', 'Apex Electro Controls LLP', '36AABCA5678H1Z2', '+91 94400 98765', 'accounts@apexelectro.in', '15-4-210, Ranigunj, Secunderabad', 'Hyderabad', 'Telangana', '500003')
ON CONFLICT (id) DO NOTHING;

-- 2. Demo Users & Memberships
-- Using demo UUIDs for seeded admin/staff
INSERT INTO memberships (id, organization_id, user_id, role, is_active)
VALUES
('m0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000001', 'owner', TRUE),
('m0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'u0000000-0000-0000-0000-000000000002', 'owner', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 3. Products for Sri Lakshmi Electrical Distributors
INSERT INTO products (id, organization_id, sku, name, brand, category, uom, purchase_cost, selling_price, tax_rate, hsn_code, reorder_threshold, is_active)
VALUES
('p0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'POL-W-2.5-RD', 'Polycab 2.5 sq mm FR PVC Insulated Copper Wire (90m Red)', 'Polycab', 'Wires & Cables', 'Coils', 1850.00, 2250.00, 18.00, '8544', 20, TRUE),
('p0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'POL-W-1.5-BL', 'Polycab 1.5 sq mm FR PVC Insulated Copper Wire (90m Blue)', 'Polycab', 'Wires & Cables', 'Coils', 1220.00, 1540.00, 18.00, '8544', 25, TRUE),
('p0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'HAV-MCB-DP-32A', 'Havells 32A Double Pole C-Curve MCB (10kA)', 'Havells', 'Switchgear', 'Nos', 480.00, 680.00, 18.00, '8536', 15, TRUE),
('p0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'SCH-SW-10A-1W', 'Schneider Electric Opale 10A 1-Way Modular Switch', 'Schneider', 'Modular Switches', 'Nos', 38.00, 62.00, 18.00, '8536', 100, TRUE),
('p0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'CRM-LED-DL-15W', 'Crompton 15W Round Slim LED Recessed Downlight 6500K', 'Crompton', 'Lighting', 'Nos', 210.00, 340.00, 18.00, '9405', 30, TRUE),
('p0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'LEG-DB-8W-SPN', 'Legrand 8-Way SPN Distribution Board (IP40 Enclosure)', 'Legrand', 'Distribution Boards', 'Nos', 950.00, 1420.00, 18.00, '8537', 8, TRUE),
('p0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'PRE-CND-25-HD', 'Precision 25mm Heavy Duty PVC Conduit Pipe (3m Length)', 'Precision', 'Conduits & Pipes', 'Bundles', 75.00, 110.00, 18.00, '3917', 50, TRUE),
('p0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'ANC-SK-16A-UNV', 'Anchor Roma 16A 6-Pin Universal Combined Socket', 'Anchor', 'Modular Switches', 'Nos', 95.00, 145.00, 18.00, '8536', 40, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 4. Initial Stock Movements (Opening Stock Ledger)
INSERT INTO stock_movements (organization_id, product_id, quantity_change, movement_type, notes)
VALUES
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000001', 85, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000002', 120, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000003', 45, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000004', 350, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000005', 8, 'OPENING_STOCK', 'Initial audit inventory (Below threshold alert demonstration)'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000006', 14, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000007', 'p0000000-0000-0000-0000-000000000007', 200, 'OPENING_STOCK', 'Initial audit inventory'),
('a0000000-0000-0000-0000-000000000001', 'p0000000-0000-0000-0000-000000000008', 90, 'OPENING_STOCK', 'Initial audit inventory');

-- 5. Customers
INSERT INTO customers (id, organization_id, name, company_name, phone, email, billing_address, gstin, credit_limit, credit_days, is_active)
VALUES
('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Ramesh Kumar', 'Bangalore Electro Enterprises', '+91 98860 11223', 'ramesh@blelectro.com', 'Site 48, Peenya Industrial Area 2nd Stage, Bengaluru 560058', '29AAAAA0000A1Z5', 300000.00, 30, TRUE),
('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Venkatesh Rao', 'Venkateshwara Power Systems', '+91 94480 33445', 'venkat@vpowersys.in', 'Plot 12, KIADB Industrial Estate, Hoskote, Bengaluru 562114', '29BBBBB1111B1Z2', 500000.00, 45, TRUE),
('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Suresh Patel', 'Surya Light House & Electricals', '+91 97410 55667', 'suryalights@gmail.com', '88, 10th Cross, Malleshwaram, Bengaluru 560003', '29CCCCC2222C1Z8', 150000.00, 15, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 6. Suppliers
INSERT INTO suppliers (id, organization_id, name, company_name, contact_person, phone, email, address, gstin, is_active)
VALUES
('s0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Polycab Regional Depot', 'Polycab Wires & Cables Ltd', 'Ashok Hegde', '+91 80 2234 5678', 'depot.blr@polycab.com', 'Warehouse Complex, Tumkur Road, Bengaluru 560022', '29AADCP1234D1Z9', TRUE),
('s0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Havells India Central Hub', 'Havells India Super Stockist', 'Deepak Joshi', '+91 80 2345 6789', 'hub.blr@havells.com', 'Ring Road Industrial Layout, Rajajinagar, Bengaluru 560010', '29AAACH4567J1Z3', TRUE)
ON CONFLICT (id) DO NOTHING;
