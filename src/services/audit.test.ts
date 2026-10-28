import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  auditService,
  sanitizeAuditDetails,
  sanitizeErrorMessage,
} from './audit.service';
import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('Audit Logging & Database Error Handling', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sanitization & Safe Diagnostics', () => {
    it('redacts sensitive fields like passwords, tokens, API keys, and PAN', () => {
      const sensitiveDetails = {
        user_email: 'admin@example.com',
        password: 'SuperSecretPassword123!',
        auth_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        api_key: 'sbp_1234567890abcdef',
        pan: 'ABCDE1234F',
        credit_card: '4111111111111234',
        cvv: '123',
        normal_field: 'safe_value',
      };

      const sanitized = sanitizeAuditDetails(sensitiveDetails);
      expect(sanitized.user_email).toBe('admin@example.com');
      expect(sanitized.normal_field).toBe('safe_value');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.auth_token).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.pan).toBe('[REDACTED]');
      expect(sanitized.credit_card).toBe('[REDACTED]');
      expect(sanitized.cvv).toBe('[REDACTED]');
    });

    it('sanitizes nested objects recursively', () => {
      const nested = {
        action: 'UPDATE_USER',
        metadata: {
          session: {
            token: 'secret-token-value',
          },
          role: 'admin',
        },
      };

      const sanitized = sanitizeAuditDetails(nested);
      expect((sanitized.metadata as any).role).toBe('admin');
      expect((sanitized.metadata as any).session.token).toBe('[REDACTED]');
    });

    it('truncates excessively long strings in audit details', () => {
      const longString = 'x'.repeat(700);
      const details = { comment: longString };
      const sanitized = sanitizeAuditDetails(details);
      expect((sanitized.comment as string).length).toBeLessThan(550);
      expect(sanitized.comment as string).toContain('...[TRUNCATED]');
    });

    it('sanitizes error messages removing connection strings and bearer tokens', () => {
      const rawError =
        'Database connection failed at postgresql://postgres:mypassword@db.supabase.co:5432 with Bearer eyJhbGciOi...';
      const safe = sanitizeErrorMessage(rawError);
      expect(safe).not.toContain('mypassword');
      expect(safe).toContain('postgresql://[REDACTED]');
      expect(safe).toContain('Bearer [REDACTED]');
    });
  });

  describe('auditService.logEvent Error Handling & Policies', () => {
    it('returns success on valid remote audit event insert', async () => {
      const insertMock = vi.fn().mockResolvedValueOnce({ error: null });
      (supabase!.from as any).mockReturnValueOnce({
        insert: insertMock,
      });

      const res = await auditService.logEvent(
        orgId,
        'TEST_ACTION',
        'TEST_ENTITY',
        'entity-001',
        { note: 'routine log' },
        false
      );

      expect(res.success).toBe(true);
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          action: 'TEST_ACTION',
          entity_type: 'TEST_ENTITY',
        })
      );
    });

    it('does not report success when Supabase returns an error', async () => {
      const insertMock = vi.fn().mockResolvedValueOnce({
        error: { message: 'new row violates row-level security policy' },
      });
      (supabase!.from as any).mockReturnValueOnce({
        insert: insertMock,
      });

      const res = await auditService.logEvent(
        orgId,
        'ROUTINE_EVENT',
        'PRODUCT',
        'prod-001',
        { sku: 'SKU-001' },
        false,
        { critical: false }
      );

      // Must explicitly report false; not silently succeed
      expect(res.success).toBe(false);
      expect(res.error).toContain('row-level security');
    });

    it('blocks the parent operation by throwing when a critical audit fails (RLS rejection)', async () => {
      const insertMock = vi.fn().mockResolvedValueOnce({
        error: { message: 'new row violates row-level security policy for table audit_events' },
      });
      (supabase!.from as any).mockReturnValueOnce({
        insert: insertMock,
      });

      // Critical action: role change or security modification
      await expect(
        auditService.logEvent(
          orgId,
          'CHANGE_ROLE',
          'MEMBERSHIP',
          'mem-001',
          { oldRole: 'viewer', newRole: 'admin' },
          false,
          { critical: true }
        )
      ).rejects.toThrow(/Critical audit log failed/);
    });

    it('blocks the parent operation when Supabase throws an unexpected network error on critical audit', async () => {
      const insertMock = vi.fn().mockRejectedValueOnce(new Error('Network connection terminated'));
      (supabase!.from as any).mockReturnValueOnce({
        insert: insertMock,
      });

      await expect(
        auditService.logEvent(
          orgId,
          'DELETE_SALES_ORDER',
          'SALES_ORDER',
          'ord-001',
          {},
          false,
          { critical: true }
        )
      ).rejects.toThrow(/Critical audit log failed: Network connection terminated/);
    });

    it('non-critical audit failure does not throw or crash user flow', async () => {
      const insertMock = vi.fn().mockRejectedValueOnce(new Error('Transient connection timeout'));
      (supabase!.from as any).mockReturnValueOnce({
        insert: insertMock,
      });

      const res = await auditService.logEvent(
        orgId,
        'VIEW_DASHBOARD',
        'METRICS',
        undefined,
        {},
        false,
        { critical: false }
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Transient connection timeout');
    });
  });

  describe('auditService.getAuditEvents Error Handling', () => {
    it('throws sanitized error on remote query failure instead of silently falling back to mock data', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: 'relation "audit_events" does not exist' },
        }),
      };
      (supabase!.from as any).mockReturnValueOnce(mockQuery);

      await expect(auditService.getAuditEvents(orgId, false)).rejects.toThrow(
        /Failed to load audit events/
      );
    });

    it('falls back to local storage only when isMockAuth is true', async () => {
      const spy = vi.spyOn(storage, 'getAuditEvents').mockReturnValueOnce([]);
      const events = await auditService.getAuditEvents(orgId, true);
      expect(spy).toHaveBeenCalledWith(orgId);
      expect(events).toEqual([]);
    });
  });
});
