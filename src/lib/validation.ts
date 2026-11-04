import { z } from 'zod';

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface ValidationResult<T = string> {
  valid: boolean;
  error?: string;
  value?: T;
  derivedPan?: string;
  effectivePan?: string;
}

/**
 * Validates standard Indian PAN (Permanent Account Number).
 * 10 characters: 5 uppercase letters + 4 digits + 1 uppercase letter.
 */
export function validatePan(
  pan?: string | null,
  options?: { allowException?: boolean; required?: boolean }
): ValidationResult<string> {
  const trimmed = pan ? pan.trim().toUpperCase() : '';

  if (!trimmed) {
    if (options?.required && !options?.allowException) {
      return { valid: false, error: 'PAN is required for business operations.' };
    }
    return { valid: true, value: '' };
  }

  if (!PAN_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Invalid PAN format. Expected 10 alphanumeric characters (e.g. ABCDE1234F).',
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Validates standard Indian GSTIN (Goods and Services Tax Identification Number).
 * 15 characters: 2-digit state code + 10-char PAN + 1 entity code + 'Z' + 1 checksum char.
 */
export function validateGstin(
  gstin?: string | null,
  options?: { required?: boolean }
): ValidationResult<string> {
  const trimmed = gstin ? gstin.trim().toUpperCase() : '';

  if (!trimmed) {
    if (options?.required) {
      return { valid: false, error: 'GSTIN is required.' };
    }
    return { valid: true, value: '' };
  }

  if (!GSTIN_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Invalid GSTIN format. Expected 15 characters (e.g. 29ABCDE1234F1Z5).',
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Extracts 10-character PAN from 15-character Indian GSTIN (characters 3 through 12).
 */
export function extractPanFromGstin(gstin?: string | null): string | null {
  if (!gstin) return null;
  const trimmed = gstin.trim().toUpperCase();
  if (trimmed.length >= 12) {
    const extracted = trimmed.slice(2, 12);
    if (PAN_REGEX.test(extracted)) {
      return extracted;
    }
  }
  return null;
}

/**
 * Shared validator for Indian business tax identifiers.
 * Cross-validates PAN against GSTIN and prevents silent overrides.
 */
export function validateBusinessTaxIdentifiers(params: {
  gstin?: string | null;
  pan?: string | null;
  requirePan?: boolean;
  allowException?: boolean;
}): ValidationResult<{ gstin?: string; pan?: string }> {
  const trimmedGstin = params.gstin ? params.gstin.trim().toUpperCase() : '';
  const trimmedPan = params.pan ? params.pan.trim().toUpperCase() : '';

  // 1. Validate GSTIN format if provided
  if (trimmedGstin) {
    const gstinRes = validateGstin(trimmedGstin);
    if (!gstinRes.valid) {
      return { valid: false, error: gstinRes.error };
    }
  }

  const derivedPan = extractPanFromGstin(trimmedGstin) || undefined;

  // 2. Validate PAN format if provided
  if (trimmedPan) {
    const panRes = validatePan(trimmedPan, {
      required: params.requirePan,
      allowException: params.allowException,
    });
    if (!panRes.valid) {
      return { valid: false, error: panRes.error };
    }
  }

  // 3. Cross-validate if BOTH GSTIN and PAN are provided
  if (trimmedGstin && trimmedPan) {
    if (derivedPan && trimmedPan !== derivedPan) {
      return {
        valid: false,
        error: `PAN does not match the PAN embedded within the GSTIN (${derivedPan}). Please verify your credentials.`,
        derivedPan,
      };
    }
  }

  const effectivePan = trimmedPan || derivedPan || '';

  // 4. If PAN is required but missing after deriving
  if (params.requirePan && !params.allowException && !effectivePan) {
    return {
      valid: false,
      error: 'Valid PAN is required for business registration.',
    };
  }

  return {
    valid: true,
    derivedPan,
    effectivePan: effectivePan || undefined,
    value: {
      gstin: trimmedGstin || undefined,
      pan: effectivePan || undefined,
    },
  };
}

/**
 * Redacts business PAN for secure logging and display.
 * Retains only the last 4 characters, e.g. "ABCDE1234F" -> "XXXXX1234F".
 */
export function maskPan(pan?: string | null): string {
  if (!pan) return '';
  const trimmed = pan.trim().toUpperCase();
  if (PAN_REGEX.test(trimmed)) {
    return 'XXXXX' + trimmed.slice(5);
  }
  return '••••••••••';
}

export const organizationSchema = z
  .object({
    name: z.string().min(2, 'Business name must be at least 2 characters').max(100),
    legalName: z.string().max(100).optional(),
    gstin: z
      .string()
      .regex(GSTIN_REGEX, 'Invalid Indian GSTIN format')
      .optional()
      .or(z.literal('')),
    pan: z
      .string()
      .regex(PAN_REGEX, 'Invalid PAN format')
      .optional()
      .or(z.literal('')),
    phone: z.string().min(10, 'Valid phone number is required').max(20),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    addressLine1: z.string().min(3, 'Address is required'),
    city: z.string().min(2, 'City is required'),
    state: z.string().min(2, 'State is required'),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, 'Invalid 6-digit Indian PIN code')
      .optional()
      .or(z.literal('')),
    currency: z.string().default('INR'),
  })
  .superRefine((data, ctx) => {
    if (data.gstin && data.pan) {
      const gstinUpper = data.gstin.trim().toUpperCase();
      const panUpper = data.pan.trim().toUpperCase();
      if (gstinUpper.length >= 12 && panUpper.length === 10) {
        const embeddedPan = gstinUpper.slice(2, 12);
        if (embeddedPan !== panUpper) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `PAN (${panUpper}) does not match the PAN embedded within the GSTIN (${embeddedPan}).`,
            path: ['pan'],
          });
        }
      }
    }
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
    .regex(GSTIN_REGEX, 'Invalid Indian GSTIN format')
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
