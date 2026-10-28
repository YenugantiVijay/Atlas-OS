import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSupabaseConfig,
  getSupabaseStatus,
  getSupabaseClient,
  verifySupabaseConnection,
  isSecretOrServiceRoleKey,
} from './supabase';

describe('Supabase Client Configuration and Diagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates configuration and catches unconfigured or placeholder states', () => {
    const config = validateSupabaseConfig();
    expect(typeof config.valid).toBe('boolean');
    if (!config.valid) {
      expect(config.error).toBeDefined();
    }
  });

  it('returns structured status via getSupabaseStatus', () => {
    const status = getSupabaseStatus();
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('message');
    expect(typeof status.message).toBe('string');
  });

  it('throws an actionable error from getSupabaseClient if unconfigured', () => {
    const status = getSupabaseStatus();
    if (!status.configured) {
      expect(() => getSupabaseClient()).toThrow(/Cannot obtain Supabase client/);
    }
  });

  it('handles verifySupabaseConnection without throwing unhandled exceptions', async () => {
    const result = await verifySupabaseConnection();
    expect(result).toHaveProperty('clientInitialized');
    expect(result).toHaveProperty('authEndpointReachable');
    expect(result).toHaveProperty('databaseTablesVerified', false);
    expect(typeof result.message).toBe('string');
  });

  describe('Security: Frontend Key Safety & Secret Rejection', () => {
    it('detects and rejects keys starting with sb_secret_', () => {
      const secretKey = 'sb_secret_sample_test_key_that_should_never_be_in_frontend';
      expect(isSecretOrServiceRoleKey(secretKey)).toBe(true);

      const validation = validateSupabaseConfig('https://example.supabase.co', secretKey);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/CRITICAL SECURITY ERROR.*service-role.*MUST NEVER be exposed/);
      // Ensure the error message does NOT leak the key itself
      expect(validation.error).not.toContain(secretKey);
    });

    it('detects and rejects JWT tokens containing role: "service_role"', () => {
      // Mock standard JWT header and signature with service_role payload: {"role":"service_role","iss":"supabase"}
      const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const payloadObj = { role: 'service_role', iss: 'supabase', sub: '123' };
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const sig = 'mock_signature_for_testing';
      const jwtServiceRole = `${header}.${payload}.${sig}`;

      expect(isSecretOrServiceRoleKey(jwtServiceRole)).toBe(true);

      const validation = validateSupabaseConfig('https://example.supabase.co', jwtServiceRole);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/CRITICAL SECURITY ERROR/);
      expect(validation.error).not.toContain(jwtServiceRole);
    });

    it('detects and rejects JWT tokens containing role: "supabase_admin"', () => {
      const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const payloadObj = { role: 'supabase_admin', iss: 'supabase' };
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const sig = 'mock_signature_for_testing';
      const jwtAdminRole = `${header}.${payload}.${sig}`;

      expect(isSecretOrServiceRoleKey(jwtAdminRole)).toBe(true);
    });

    it('accepts valid publishable keys starting with sb_publishable_', () => {
      const pubKey = 'sb_publishable_abcdefghijklmnopqrstuvwxyz123456';
      expect(isSecretOrServiceRoleKey(pubKey)).toBe(false);

      const validation = validateSupabaseConfig('https://example.supabase.co', pubKey);
      expect(validation.valid).toBe(true);
      expect(validation.keyType).toBe('publishable');
      expect(validation.url).toBe('https://example.supabase.co');
    });

    it('accepts valid public anon JWT keys', () => {
      const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const payloadObj = { role: 'anon', iss: 'supabase', sub: 'anon-user' };
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const sig = 'mock_signature_for_testing_anon';
      const jwtAnonKey = `${header}.${payload}.${sig}`;

      expect(isSecretOrServiceRoleKey(jwtAnonKey)).toBe(false);

      const validation = validateSupabaseConfig('https://example.supabase.co', jwtAnonKey);
      expect(validation.valid).toBe(true);
      expect(validation.keyType).toBe('anon');
    });

    it('rejects plain insecure HTTP endpoints', () => {
      const pubKey = 'sb_publishable_abcdefghijklmnopqrstuvwxyz123456';
      const validation = validateSupabaseConfig('http://example.supabase.co', pubKey);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/HTTPS protocol/);
    });
  });
});
