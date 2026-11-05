import { z } from 'zod';

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface ValidationResult<T = string> {
  valid: boolean;
  error?: string;
  value?: T;
  derivedPan?: string;
  effectivePan?: string;
  isException?: boolean;
  exceptionReason?: string;
  exceptionReference?: string;
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

export const PAN_EXCEPTION_REASONS = [
  'GOVERNMENT_EXEMPT_ENTITY',
  'INFORMAL_SECTOR_MICRO_ENTERPRISE',
  'PAN_ISSUANCE_IN_PROGRESS',
] as const;

export type PanExceptionReason = (typeof PAN_EXCEPTION_REASONS)[number];

export interface ValidateTaxOptions {
  gstin?: string | null;
  pan?: string | null;
  requirePan?: boolean;
  allowException?: boolean;
  exceptionReason?: string | null;
  exceptionReference?: string | null;
}

/**
 * Shared validator for Indian business tax identifiers.
 * Enforces business identity policy:
 * - Standard business onboarding requires a valid PAN.
 * - Extracts and cross-validates embedded PAN from GSTIN.
 * - Supports documented exceptions only with backend-auditable reason and reference.
 * - Protects sensitive identifiers by sanitizing error messages.
 */
export function validateBusinessTaxIdentifiers(
  params: ValidateTaxOptions
): ValidationResult<{
  gstin?: string;
  pan?: string;
  isException?: boolean;
  exceptionReason?: string;
  exceptionReference?: string;
}> {
  const requirePan = params.requirePan !== false; // default true for businesses
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
      required: true,
      allowException: false,
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
        error: 'Provided PAN does not match the PAN embedded within the GSTIN. Please verify your credentials.',
        derivedPan,
      };
    }
  }

  const effectivePan = trimmedPan || derivedPan || '';

  // 4. If PAN is missing after deriving
  if (!effectivePan) {
    if (requirePan) {
      if (params.allowException) {
        const reason = params.exceptionReason?.trim();
        const ref = params.exceptionReference?.trim();
        const isValidReason = reason && (PAN_EXCEPTION_REASONS as readonly string[]).includes(reason);

        if (!isValidReason || !ref || ref.length < 3) {
          return {
            valid: false,
            error:
              'Documented statutory exception reason and reference (minimum 3 characters) are required for PAN exemption.',
          };
        }

        return {
          valid: true,
          derivedPan: undefined,
          effectivePan: undefined,
          isException: true,
          exceptionReason: reason,
          exceptionReference: ref,
          value: {
            gstin: trimmedGstin || undefined,
            pan: undefined,
            isException: true,
            exceptionReason: reason,
            exceptionReference: ref,
          },
        };
      }

      return {
        valid: false,
        error: 'Valid Indian PAN is required for business registration.',
      };
    }
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

/**
 * Redacts business GSTIN for secure logging and display.
 * Retains state code and last 4 characters, e.g. "29ABCDE1234F1Z5" -> "29XXXXX1234F1Z5".
 */
export function maskGstin(gstin?: string | null): string {
  if (!gstin) return '';
  const trimmed = gstin.trim().toUpperCase();
  if (GSTIN_REGEX.test(trimmed)) {
    return trimmed.slice(0, 2) + 'XXXXX' + trimmed.slice(7);
  }
  return '•••••••••••••••';
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
            message: 'Provided PAN does not match the PAN embedded within the GSTIN.',
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

export interface NumericValidationResult {
  valid: boolean;
  value?: number;
  error?: string;
}

export interface StrictNumberOptions {
  fieldName: string;
  min?: number;
  max?: number;
  integer?: boolean;
  allowZero?: boolean;
  required?: boolean;
  maxDecimals?: number;
  defaultValue?: number;
}

/**
 * Validates and parses numeric form input without silently converting invalid strings to zero.
 * Distinguishes valid zero, empty input, invalid characters, negative values, NaN, Infinity, and out-of-range values.
 */
export function parseStrictNumber(
  input: string | number | undefined | null,
  options: StrictNumberOptions = { fieldName: 'Value' }
): NumericValidationResult {
  const fieldName = options.fieldName || 'Value';

  if (input === undefined || input === null) {
    if (options.required) {
      return { valid: false, error: `${fieldName} is required.` };
    }
    return { valid: true, value: options.defaultValue };
  }

  const strVal = typeof input === 'number' ? String(input) : String(input).trim();

  if (strVal === '') {
    if (options.required) {
      return { valid: false, error: `${fieldName} is required.` };
    }
    return { valid: true, value: options.defaultValue };
  }

  // Ensure string represents a valid decimal or integer number (allows optional leading + or -)
  if (!/^[+-]?\d+(\.\d+)?$/.test(strVal)) {
    return { valid: false, error: `${fieldName} must be a valid number without invalid characters.` };
  }

  const num = Number(strVal);

  if (!Number.isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a finite number.` };
  }

  if (options.integer && !Number.isInteger(num)) {
    return { valid: false, error: `${fieldName} must be a whole number (no decimals).` };
  }

  if (options.maxDecimals !== undefined && options.maxDecimals >= 0) {
    const parts = strVal.split('.');
    if (parts[1] && parts[1].length > options.maxDecimals) {
      return {
        valid: false,
        error: `${fieldName} cannot exceed ${options.maxDecimals} decimal places.`,
      };
    }
  }

  if (options.allowZero === false && num === 0) {
    return { valid: false, error: `${fieldName} cannot be zero.` };
  }

  if (options.min !== undefined && num < options.min) {
    return { valid: false, error: `${fieldName} cannot be less than ${options.min}.` };
  }

  if (options.max !== undefined && num > options.max) {
    return { valid: false, error: `${fieldName} cannot exceed ${options.max}.` };
  }

  return { valid: true, value: num };
}

export function validateMoneyInput(
  input: string | number | undefined | null,
  fieldName: string,
  options?: { required?: boolean; allowZero?: boolean; min?: number; max?: number }
): NumericValidationResult {
  return parseStrictNumber(input, {
    fieldName,
    required: options?.required !== false,
    allowZero: options?.allowZero !== false,
    min: options?.min !== undefined ? options.min : 0,
    max: options?.max !== undefined ? options.max : 100_000_000,
    maxDecimals: 2,
  });
}

export function validateTaxRateInput(
  input: string | number | undefined | null,
  fieldName: string = 'Tax rate'
): NumericValidationResult {
  return parseStrictNumber(input, {
    fieldName,
    required: true,
    allowZero: true,
    min: 0,
    max: 40,
    maxDecimals: 2,
  });
}

export function validateQuantityInput(
  input: string | number | undefined | null,
  fieldName: string = 'Quantity',
  options?: { min?: number; max?: number; allowZero?: boolean }
): NumericValidationResult {
  return parseStrictNumber(input, {
    fieldName,
    required: true,
    integer: true,
    allowZero: options?.allowZero === true,
    min: options?.min !== undefined ? options.min : 1,
    max: options?.max !== undefined ? options.max : 1_000_000,
  });
}

export function validateCreditDaysInput(
  input: string | number | undefined | null,
  fieldName: string = 'Credit days'
): NumericValidationResult {
  return parseStrictNumber(input, {
    fieldName,
    required: false,
    integer: true,
    allowZero: true,
    defaultValue: 30,
    min: 0,
    max: 180,
  });
}
