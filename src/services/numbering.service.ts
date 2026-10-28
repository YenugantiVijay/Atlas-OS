import { supabase } from '@/lib/supabase';

export type DocumentType = 'QUOTATION' | 'SALES_ORDER' | 'INVOICE';

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
 * Allocates a robust, database-backed sequential document number for an organization.
 * Format: QT-YYYY-NNNN, SO-YYYY-NNNN, INV-YYYY-NNNN
 * 
 * 1. Primary Strategy: Database RPC allocate_document_number using row locking on document_sequences.
 * 2. Fallback Strategy: Database max-sequence query scoped by organization and year.
 * 3. Default: Initial sequential number QT-YYYY-0001, etc.
 */
export async function allocateDocumentNumber(
  orgId: string,
  docType: DocumentType,
  year: number = new Date().getFullYear()
): Promise<string> {
  const prefix = docType === 'QUOTATION' ? 'QT' : docType === 'SALES_ORDER' ? 'SO' : 'INV';

  // 1. Primary Strategy: Remote atomic sequence RPC with row-level locking
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('allocate_document_number', {
        p_org_id: orgId,
        p_doc_type: docType,
        p_year: year,
      });

      if (!error && typeof data === 'string' && data.startsWith(`${prefix}-${year}-`)) {
        return data;
      }
      if (error) {
        // Fall through to fallback strategy
      }
    } catch {
      // Fall through to fallback strategy
    }

    // 2. Fallback Strategy: Query existing records in table for this organization
    try {
      const tableName = docType === 'QUOTATION' ? 'quotations' : docType === 'SALES_ORDER' ? 'sales_orders' : 'invoices';
      const colName = docType === 'QUOTATION' ? 'quotation_number' : docType === 'SALES_ORDER' ? 'order_number' : 'invoice_number';

      const { data: rows, error: selectErr } = await supabase
        .from(tableName)
        .select(colName)
        .eq('organization_id', orgId)
        .like(colName, `${prefix}-${year}-%`)
        .order(colName, { ascending: false })
        .limit(20);

      if (!selectErr && rows && rows.length > 0) {
        let maxSeq = 0;
        const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
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
        return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
      }
    } catch {
      // Fall through to default
    }
  }

  // 3. Initial sequence for fresh organizations
  return `${prefix}-${year}-0001`;
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
  maxAttempts: number = 5
): Promise<T> {
  let attempts = 0;
  let lastError: any = null;

  while (attempts < maxAttempts) {
    attempts++;
    const docNumber = await allocateDocumentNumber(orgId, docType);
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
