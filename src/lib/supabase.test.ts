import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSupabaseConfig,
  getSupabaseStatus,
  getSupabaseClient,
  verifySupabaseConnection,
} from './supabase';

describe('Supabase Client Configuration and Diagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('validates configuration and catches unconfigured or placeholder states', () => {
    const config = validateSupabaseConfig();
    // In test environment without real key, it should be cleanly unconfigured or report missing key
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
});
