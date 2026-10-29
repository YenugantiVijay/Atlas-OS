import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { AuditEvent } from '@/types';

export function mapDbAuditEvent(row: any): AuditEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorId: row.actor_id || undefined,
    actorEmail: row.actor_email || undefined,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id || undefined,
    details: row.details || {},
    createdAt: row.created_at,
  };
}

export interface AuditLogOptions {
  /** If true, audit failure throws and blocks the parent operation */
  critical?: boolean;
  /** Explicitly throw on error even if not critical */
  throwOnError?: boolean;
}

/**
 * Sanitizes audit details before database persistence or console output.
 * Redacts credentials, secrets, auth tokens, PAN, and card numbers.
 * Truncates excessively long strings to prevent log injection.
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== 'object') return {};
  const sensitivePattern = /password|token|secret|auth|api[-_]?key|credit[-_]?card|cvv|pan|aadhaar|ssn/i;
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(details)) {
    if (sensitivePattern.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof val === 'string' && val.length > 500) {
      sanitized[key] = val.slice(0, 500) + '...[TRUNCATED]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitized[key] = sanitizeAuditDetails(val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

/**
 * Sanitizes error messages to prevent exposing database URLs or sensitive auth headers.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return 'Unknown database error';
  return message
    .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/apikey=[a-zA-Z0-9_\-\.]+/gi, 'apikey=[REDACTED]');
}

export const auditService = {
  async getAuditEvents(orgId: string, isMockAuth: boolean = false): Promise<AuditEvent[]> {
    if (isMockAuth) {
      return storage.getAuditEvents(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase
      .from('audit_events')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      const safeErr = sanitizeErrorMessage(error.message);
      console.error('Failed to load remote audit events:', safeErr);
      throw new Error(`Failed to load audit events: ${safeErr}`);
    }

    return (data || []).map(mapDbAuditEvent);
  },

  async logEvent(
    orgId: string,
    action: string,
    entityType: string,
    entityId?: string,
    details?: Record<string, unknown>,
    isMockAuth: boolean = false,
    options: AuditLogOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    const isCritical = options.critical ?? false;
    const shouldThrow = isCritical || (options.throwOnError ?? false);
    const sanitized = sanitizeAuditDetails(details);

    if (isMockAuth) {
      try {
        storage.logAuditEvent(orgId, action, entityType, entityId, sanitized);
        return { success: true };
      } catch (err: any) {
        const safeErr = sanitizeErrorMessage(err?.message || 'Storage audit write failed');
        if (shouldThrow) {
          throw new Error(`Critical audit failure: ${safeErr}`);
        }
        console.warn('Non-critical storage audit log failed:', safeErr);
        return { success: false, error: safeErr };
      }
    }

    if (!supabase) {
      const errMsg = 'Cloud backend is not configured: Supabase client is uninitialized.';
      if (shouldThrow) {
        throw new Error(`Critical audit failure: ${errMsg}`);
      }
      return { success: false, error: errMsg };
    }

    try {
      const { error } = await supabase.from('audit_events').insert({
        organization_id: orgId,
        action,
        entity_type: entityType,
        entity_id: entityId || null,
        details: sanitized,
      });

      if (error) {
        const safeErr = sanitizeErrorMessage(error.message);
        if (shouldThrow) {
          throw new Error(`Critical audit log failed: ${safeErr}`);
        }
        console.warn('Non-critical remote audit log failed:', safeErr);
        return { success: false, error: safeErr };
      }

      return { success: true };
    } catch (err: any) {
      const safeErr = sanitizeErrorMessage(err?.message || 'Audit insert error');
      if (shouldThrow) {
        throw new Error(`Critical audit log failed: ${safeErr}`);
      }
      console.warn('Non-critical remote audit log threw:', safeErr);
      return { success: false, error: safeErr };
    }
  },
};
