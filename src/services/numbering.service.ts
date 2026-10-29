import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

export type DocumentType = 'QUOTATION' | 'SALES_ORDER' | 'INVOICE' | 'RECEIPT';

/**
 * Checks if a Supabase/PostgreSQL error represents a unique constraint violation.
 * PostgreSQL error code 23505 = unique_violation.
 */
export function isUniqueViolation(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  const details = String(error.details || '').toLowerCase();

  return (
    code === '23505' ||
    msg.includes('duplicate key') ||
    msg.includes('unique constraint') ||
    msg.includes('already exists') ||
    details.includes('already exists')
  );
}

/**
 * Calculates the Indian Financial Year (FY) string (e.g. '25-26', '26-27') from a date or year.
 * Under Indian GST (Rule 46), the fiscal year begins on April 1 and ends on March 31.
 * - Dates between Jan 1 and Mar 31 fall in FY (year-1)-(year) (e.g. Feb 2026 -> '25-26')
 * - Dates between Apr 1 and Dec 31 fall in FY (year)-(year+1) (e.g. Oct 2026 -> '26-27')
 */
export function getIndianFinancialYear(dateOrYear?: Date | string | number): string {
  if (dateOrYear instanceof Date) {
    const month = dateOrYear.getMonth(); // 0 to 11
    const year = dateOrYear.getFullYear();
    const startYear = month < 3 ? year - 1 : year;
    const endYear = startYear + 1;
    return `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  }

  if (typeof dateOrYear === 'string') {
    if (/^\d{2}-\d{2}$/.test(dateOrYear)) {
      return dateOrYear;
    }
    const parsed = new Date(dateOrYear);
    if (!isNaN(parsed.getTime())) {
      return getIndianFinancialYear(parsed);
    }
  }

  if (typeof dateOrYear === 'number') {
    // If a 4-digit calendar year is provided:
    // When date is current calendar year, base it on current date's financial quarter
    const now = new Date();
    if (dateOrYear === now.getFullYear()) {
      return getIndianFinancialYear(now);
    }
    // When an explicit earlier/later calendar year is provided without month,
    // default to financial year starting in that year (e.g. 2025 -> '25-26')
    const startYear = dateOrYear;
    const endYear = startYear + 1;
    return `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  }

  return getIndianFinancialYear(new Date());
}

/**
 * Formats an Indian GST-compliant invoice number under Rule 46.
 * Format: ATL/YY-YY/NNNN (e.g. ATL/25-26/0001, ATL/26-27/0042)
 * Preserves numbers >= 10000 without truncation (e.g. ATL/25-26/10000 is 14 chars, well under the 16 char GST statutory limit).
 */
export function formatInvoiceNumber(fy: string, seq: number): string {
  const numPart = seq < 10000 ? String(seq).padStart(4, '0') : String(seq);
  return `ATL/${fy}/${numPart}`;
}

/**
 * Formats a canonical document number, preserving full value without truncation beyond 9999.
 * Format: PREFIX-YYYY-NNNN (e.g. QT-2026-0001, RCP-2026-10005)
 */
export function formatSequentialNumber(prefix: string, year: number, seq: number): string {
  const numPart = seq < 10000 ? String(seq).padStart(4, '0') : String(seq);
  return `${prefix}-${year}-${numPart}`;
}

/**
 * Allocates a robust, database-backed sequential document number for an organization.
 * Format:
 * - Quotation: QT-YYYY-NNNN
 * - Sales Order: SO-YYYY-NNNN
 * - Tax Invoice: ATL/YY-YY/NNNN (Indian GST Rule 46 compliant)
 * - Payment Receipt: RCP-YYYY-NNNN
 * 
 * 1. Demo Mode: Explicitly delegates to local storage allocator.
 * 2. Primary Cloud Strategy: Database RPC allocate_document_number using row locking on document_sequences.
 * 3. Fallback Cloud Strategy: Database max-sequence query scoped by organization and financial year/calendar year.
 * 4. Error Guard: Never silently falls back to localStorage in cloud mode if Supabase is unconfigured.
 */
export async function allocateDocumentNumber(
  orgId: string,
  docType: DocumentType,
  yearOrDate: number | string | Date = new Date(),
  isMockAuth: boolean = false
): Promise<string> {
  // 1. Strict input validation
  if (!orgId) {
    throw new Error('organization_id cannot be null or empty.');
  }
  if (!docType) {
    throw new Error('document_type cannot be null or empty.');
  }

  let effectiveYear: number;
  if (typeof yearOrDate === 'number') {
    effectiveYear = yearOrDate;
  } else if (yearOrDate instanceof Date) {
    effectiveYear = yearOrDate.getFullYear();
  } else if (typeof yearOrDate === 'string') {
    const parsed = new Date(yearOrDate);
    effectiveYear = !isNaN(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
  } else {
    effectiveYear = new Date().getFullYear();
  }

  if (!effectiveYear || effectiveYear < 2000 || effectiveYear > 2100) {
    throw new Error(`Invalid year: ${effectiveYear}. Must be between 2000 and 2100.`);
  }

  // 2. Explicit demo mode uses local storage
  if (isMockAuth) {
    return storage.allocateDocumentNumber(orgId, docType, yearOrDate);
  }

  // 3. Security: In cloud mode, RECEIPT numbers cannot be reserved directly by clients.
  // They are allocated atomically inside record_payment_and_allocate RPC.
  if (docType === 'RECEIPT') {
    throw new Error(
      'Access denied: RECEIPT numbers cannot be allocated directly in cloud mode. They are allocated atomically by record_payment_and_allocate().'
    );
  }

  // 4. Cloud mode requires initialized client
  if (!supabase) {
    throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
  }

  const prefix =
    docType === 'QUOTATION' ? 'QT' :
    docType === 'SALES_ORDER' ? 'SO' :
    docType === 'INVOICE' ? 'ATL' : 'RCP';

  const fy = getIndianFinancialYear(yearOrDate);

  // 1. Primary Strategy: Remote atomic sequence RPC with row-level locking
  try {
    const { data, error } = await supabase.rpc('allocate_document_number', {
      p_org_id: orgId,
      p_doc_type: docType,
      p_year: effectiveYear,
    });

    if (!error && typeof data === 'string') {
      if (docType === 'INVOICE') {
        if (data.startsWith('ATL/') || data.startsWith(`INV-${effectiveYear}-`)) {
          return data;
        }
      } else if (data.startsWith(`${prefix}-${effectiveYear}-`)) {
        return data;
      }
    }
  } catch {
    // Fall through to fallback query strategy
  }

  // 2. Fallback Strategy: Query existing records in table for this organization
  try {
    const tableName =
      docType === 'QUOTATION' ? 'quotations' :
      docType === 'SALES_ORDER' ? 'sales_orders' :
      docType === 'INVOICE' ? 'invoices' : 'payments';
    const colName =
      docType === 'QUOTATION' ? 'quotation_number' :
      docType === 'SALES_ORDER' ? 'order_number' :
      docType === 'INVOICE' ? 'invoice_number' : 'payment_number';

    const likePrefix = docType === 'INVOICE' ? `ATL/${fy}/%` : `${prefix}-${effectiveYear}-%`;

    const { data: rows, error: selectErr } = await supabase
      .from(tableName)
      .select(colName)
      .eq('organization_id', orgId)
      .like(colName, likePrefix)
      .order(colName, { ascending: false })
      .limit(20);

    if (!selectErr && rows && rows.length > 0) {
      let maxSeq = 0;
      const pattern = docType === 'INVOICE'
        ? new RegExp(`^ATL[/\\\\]${fy}[/\\\\](\\d+)$`)
        : new RegExp(`^${prefix}-${effectiveYear}-(\\d+)$`);
      for (const r of rows) {
        const numStr = (r as any)[colName];
        const match = typeof numStr === 'string' ? numStr.match(pattern) : null;
        if (match) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxSeq) {
            maxSeq = val;
          }
        }
      }
      return docType === 'INVOICE'
        ? formatInvoiceNumber(fy, maxSeq + 1)
        : formatSequentialNumber(prefix, effectiveYear, maxSeq + 1);
    }
  } catch {
    // Fall through to default
  }

  // 3. Initial sequence for fresh organizations
  return docType === 'INVOICE'
    ? formatInvoiceNumber(fy, 1)
    : formatSequentialNumber(prefix, effectiveYear, 1);
}

/**
 * Executes a document creation operation with automatic retries on unique number collisions.
 * Database uniqueness constraints act as the final defense; this handler intercepts 23505
 * collisions, re-allocates a fresh document number, and retries gracefully.
 */
export async function withDocumentNumberRetry<T>(
  orgId: string,
  docType: DocumentType,
  insertFn: (docNumber: string) => Promise<{ data: T | null; error: any }>,
  maxAttempts: number = 5,
  yearOrDate?: number | string | Date
): Promise<T> {
  let attempts = 0;
  let lastError: any = null;

  while (attempts < maxAttempts) {
    attempts++;
    const docNumber = await allocateDocumentNumber(orgId, docType, yearOrDate);
    const { data, error } = await insertFn(docNumber);

    if (!error && data) {
      return data;
    }

    if (error && isUniqueViolation(error)) {
      lastError = error;
      // Exponential backoff with jitter to resolve high-concurrency contention
      const backoffMs = Math.min(200, 25 * Math.pow(2, attempts - 1) + Math.random() * 20);
      await new Promise((res) => setTimeout(res, backoffMs));
      continue;
    }

    // Non-collision errors fail immediately
    throw new Error(`Failed to create ${docType.toLowerCase()}: ${error?.message || 'Unknown database error'}`);
  }

  throw new Error(
    `Failed to allocate a unique ${docType.toLowerCase()} number after ${maxAttempts} attempts: ${lastError?.message || 'Unique constraint conflict'}`
  );
}
