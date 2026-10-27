export type Role = 'owner' | 'admin' | 'sales' | 'inventory' | 'accounts' | 'viewer';

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  currency: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  user?: User;
}

export type UOM = 'Nos' | 'Coils' | 'Meters' | 'Boxes' | 'Bundles' | 'Sets' | 'Rolls';

export interface Product {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  brand?: string;
  category: string;
  description?: string;
  imageUrl?: string;
  uom: UOM;
  purchaseCost: number;
  sellingPrice: number;
  taxRate: number; // e.g. 18 for 18% GST
  hsnCode?: string;
  reorderThreshold: number;
  currentStock?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MovementType =
  | 'OPENING_STOCK'
  | 'GOODS_RECEIVED'
  | 'SALES_DISPATCH'
  | 'RETURN_INWARD'
  | 'ADJUSTMENT'
  | 'REVERSAL';

export interface StockMovement {
  id: string;
  organizationId: string;
  productId: string;
  quantityChange: number;
  movementType: MovementType;
  referenceType?: string;
  referenceId?: string;
  actorId?: string;
  notes?: string;
  createdAt: string;
  product?: Product;
}

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  companyName?: string;
  phone?: string;
  email?: string;
  billingAddress?: string;
  deliveryAddress?: string;
  gstin?: string;
  pan?: string;
  creditLimit: number;
  creditDays: number;
  avatarUrl?: string;
  isActive: boolean;
  currentReceivable?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  companyName?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  paymentTerms?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface QuotationItem {
  id: string;
  quotationId: string;
  productId: string;
  productName: string;
  productSku: string;
  uom: UOM;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface Quotation {
  id: string;
  organizationId: string;
  quotationNumber: string;
  customerId: string;
  status: QuotationStatus;
  validUntil: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  items?: QuotationItem[];
}

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';

export interface SalesOrderItem {
  id: string;
  salesOrderId: string;
  productId: string;
  productName: string;
  productSku: string;
  uom: UOM;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface SalesOrder {
  id: string;
  organizationId: string;
  orderNumber: string;
  customerId: string;
  quotationId?: string;
  status: OrderStatus;
  orderDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  createdBy?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  items?: SalesOrderItem[];
}

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId?: string;
  productName: string;
  productSku: string;
  hsnCode?: string;
  uom: UOM;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  customerId: string;
  salesOrderId?: string;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  totalPaid: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  customer?: Customer;
  items?: InvoiceItem[];
}

export type PaymentMethod = 'CASH' | 'UPI' | 'NEFT' | 'RTGS' | 'CHEQUE' | 'BANK_TRANSFER';

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  amountAllocated: number;
  createdAt: string;
  invoice?: Invoice;
}

export interface Payment {
  id: string;
  organizationId: string;
  paymentNumber: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  paymentDate: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  customer?: Customer;
  allocations?: PaymentAllocation[];
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardMetrics {
  todaySales: number;
  ordersCount: number;
  totalReceivables: number;
  overdueInvoicesCount: number;
  lowStockItemsCount: number;
  totalStockValue: number;
  recentOrders: SalesOrder[];
  recentPayments: Payment[];
  lowStockProducts: Product[];
}

export interface ProposedAction {
  id: string;
  title: string;
  description: string;
  actionType: 'CREATE_QUOTATION' | 'REORDER_STOCK' | 'FOLLOWUP_RECEIVABLES';
  payload: Record<string, unknown>;
  requiresApproval: boolean;
}
