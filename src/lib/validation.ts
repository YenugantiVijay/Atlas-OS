import { z } from 'zod';

export const organizationSchema = z.object({
  name: z.string().min(2, 'Business name must be at least 2 characters').max(100),
  legalName: z.string().max(100).optional(),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid Indian GSTIN format')
    .optional()
    .or(z.literal('')),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format').optional().or(z.literal('')),
  phone: z.string().min(10, 'Valid phone number is required').max(20),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  addressLine1: z.string().min(3, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid 6-digit Indian PIN code').optional().or(z.literal('')),
  currency: z.string().default('INR'),
});

export const productSchema = z.object({
  sku: z.string().min(2, 'SKU is required').max(50),
  name: z.string().min(3, 'Product name is required').max(150),
  brand: z.string().max(80).optional(),
  category: z.string().min(2, 'Category is required'),
  description: z.string().optional(),
  uom: z.enum(['Nos', 'Coils', 'Meters', 'Boxes', 'Bundles', 'Sets', 'Rolls']),
  purchaseCost: z.number().min(0, 'Purchase cost must be non-negative'),
  sellingPrice: z.number().min(0, 'Selling price must be non-negative'),
  taxRate: z.number().min(0).max(40, 'Tax rate must be between 0% and 40%'),
  hsnCode: z.string().regex(/^[0-9]{2,8}$/, 'HSN code must be 2 to 8 digits').optional().or(z.literal('')),
  reorderThreshold: z.number().int().min(0, 'Threshold must be non-negative'),
  openingStock: z.number().int().min(0).optional(),
});

export const customerSchema = z.object({
  name: z.string().min(2, 'Customer name is required').max(100),
  companyName: z.string().max(100).optional(),
  phone: z.string().min(10, 'Valid phone number required').max(20),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  billingAddress: z.string().min(5, 'Billing address is required'),
  deliveryAddress: z.string().optional(),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid Indian GSTIN format')
    .optional()
    .or(z.literal('')),
  creditLimit: z.number().min(0, 'Credit limit must be non-negative'),
  creditDays: z.number().int().min(0).max(180, 'Credit days must be between 0 and 180'),
});

export const supplierSchema = z.object({
  name: z.string().min(2, 'Supplier name is required').max(100),
  companyName: z.string().max(100).optional(),
  contactPerson: z.string().max(100).optional(),
  phone: z.string().min(10, 'Valid phone number required').max(20),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  address: z.string().min(5, 'Address is required'),
  gstin: z.string().optional().or(z.literal('')),
  paymentTerms: z.string().optional(),
});

export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string(),
  productSku: z.string(),
  uom: z.enum(['Nos', 'Coils', 'Meters', 'Boxes', 'Bundles', 'Sets', 'Rolls']),
  quantity: z.number().int().positive('Quantity must be greater than 0'),
  unitPrice: z.number().min(0, 'Unit price cannot be negative'),
  discountPercent: z.number().min(0).max(100),
  taxRate: z.number().min(0),
});

export const quotationFormSchema = z.object({
  customerId: z.string().min(1, 'Please select a customer'),
  validUntil: z.string().min(1, 'Validity date is required'),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'At least one line item is required'),
});

export const salesOrderFormSchema = z.object({
  customerId: z.string().min(1, 'Please select a customer'),
  orderDate: z.string().min(1, 'Order date is required'),
  quotationId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'At least one line item is required'),
});

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1, 'Please select a product'),
  quantityChange: z.number().int().refine((val) => val !== 0, 'Adjustment quantity cannot be zero'),
  notes: z.string().min(3, 'A reason for adjustment is required for audit trail'),
});

export const paymentRecordSchema = z.object({
  customerId: z.string().min(1, 'Please select a customer'),
  invoiceId: z.string().optional(),
  amount: z.number().positive('Payment amount must be greater than 0'),
  paymentMethod: z.enum(['CASH', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'BANK_TRANSFER']),
  referenceNumber: z.string().optional(),
  paymentDate: z.string().min(1, 'Payment date is required'),
  notes: z.string().optional(),
});
