import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfigStatus {
  configured: boolean;
  urlPreview?: string;
  keyType?: 'publishable' | 'anon';
  message: string;
  error?: string;
}

export interface SupabaseVerificationResult {
  clientInitialized: boolean;
  authEndpointReachable: boolean;
  status: 'configured_and_reachable' | 'auth_error' | 'network_error' | 'unconfigured';
  message: string;
  latencyMs?: number;
  projectUrl?: string;
  authSessionPresent: boolean;
  details?: string;
  databaseTablesVerified: false; // Explicit: Auth endpoint ping does not verify database tables or RLS policies
}

/**
 * Detects whether a key is a privileged Supabase secret or service-role key.
 * Checks both prefix conventions and JWT payload claims without third-party dependencies.
 * Complete keys and credentials are never logged or exposed.
 */
export function isSecretOrServiceRoleKey(rawKey: string): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;
  const key = rawKey.trim();

  // Check prefix or explicit service-role indicators
  if (
    key.startsWith('sb_secret_') ||
    key.toLowerCase().includes('service_role') ||
    key.toLowerCase().includes('supabase_admin')
  ) {
    return true;
  }

  // Check JWT format (header.payload.signature)
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const padLength = (4 - (base64.length % 4)) % 4;
      const padded = base64 + '='.repeat(padLength);

      let jsonStr = '';
      if (typeof atob === 'function') {
        jsonStr = atob(padded);
      } else if (typeof Buffer !== 'undefined') {
        jsonStr = Buffer.from(padded, 'base64').toString('utf-8');
      }

      if (jsonStr) {
        const payload = JSON.parse(jsonStr);
        if (
          payload &&
          typeof payload === 'object' &&
          (payload.role === 'service_role' ||
            payload.role === 'supabase_admin' ||
            payload.iss === 'supabase-admin')
        ) {
          return true;
        }
      }
    } catch {
      // If decoding fails, it's not a standard parseable JWT payload with these claims
    }
  }

  return false;
}

/**
 * Validates the Supabase URL and Publishable/Anon key from environment variables.
 * Ensures the URL is a valid HTTPS endpoint, rejects placeholder text, and explicitly
 * rejects dangerous service-role or secret keys.
 */
export function validateSupabaseConfig(overrideUrl?: string, overrideKey?: string): {
  valid: boolean;
  url?: string;
  key?: string;
  keyType?: 'publishable' | 'anon';
  error?: string;
} {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
    '';
  const envKey =
    (typeof import.meta !== 'undefined' &&
      (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== 'undefined' &&
      (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY || process.env?.VITE_SUPABASE_ANON_KEY)) ||
    '';

  const url = (overrideUrl !== undefined ? overrideUrl : envUrl).trim();
  const key = (overrideKey !== undefined ? overrideKey : envKey).trim();

  if (!url && !key) {
    return {
      valid: false,
      error:
        'Supabase URL and Publishable Key are not set in environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).',
    };
  }

  if (!url) {
    return {
      valid: false,
      error: 'VITE_SUPABASE_URL is missing.',
    };
  }

  // Validate URL structure
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      return {
        valid: false,
        error: `Supabase URL must use the HTTPS protocol (received: ${parsedUrl.protocol}).`,
      };
    }
    if (url.includes('placeholder') || url.includes('your-project')) {
      return {
        valid: false,
        error:
          'VITE_SUPABASE_URL contains placeholder text. Please provide your real project URL.',
      };
    }
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format for VITE_SUPABASE_URL. Expected a valid HTTPS URL (e.g., https://<project-ref>.supabase.co).',
    };
  }

  if (!key) {
    return {
      valid: false,
      error: 'Supabase key is missing. Set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    };
  }

  // CRITICAL SECURITY CHECK: Explicitly reject service-role or secret keys
  if (isSecretOrServiceRoleKey(key)) {
    return {
      valid: false,
      error:
        'CRITICAL SECURITY ERROR: A Supabase service-role or secret key was detected in browser-exposed environment variables. Service-role keys bypass all Row Level Security and MUST NEVER be exposed in client-side code. Please replace this with your client-safe publishable key (starting with "sb_publishable_") or public anon key in .env.local.',
    };
  }

  if (
    key === 'YOUR_PUBLISHABLE_KEY' ||
    key === 'YOUR_ANON_KEY' ||
    key.includes('placeholder') ||
    key.length < 20
  ) {
    return {
      valid: false,
      error:
        'VITE_SUPABASE_PUBLISHABLE_KEY contains placeholder text or is too short. Please replace it with your real publishable key (starting with "sb_publishable_").',
    };
  }

  const keyType: 'publishable' | 'anon' = key.startsWith('sb_publishable_')
    ? 'publishable'
    : 'anon';

  return {
    valid: true,
    url,
    key,
    keyType,
  };
}

/**
 * Returns whether Supabase is configured with valid environment variables.
 */
export const isSupabaseConfigured = (): boolean => {
  return validateSupabaseConfig().valid;
};

// Singleton client initialization
let clientInstance: SupabaseClient | null = null;

const initialConfig = validateSupabaseConfig();
if (initialConfig.valid && initialConfig.url && initialConfig.key) {
  clientInstance = createClient(initialConfig.url, initialConfig.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Shared singleton Supabase client instance.
 * Null if environment variables are not configured or invalid.
 */
export const supabase: SupabaseClient | null = clientInstance;

/**
 * Retrieves the singleton Supabase client or throws a clear, actionable error if not configured.
 * This prevents silent degradation or fallbacks to fake Supabase clients.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    const validation = validateSupabaseConfig();
    throw new Error(
      `Cannot obtain Supabase client: ${validation.error || 'Configuration missing'}. ` +
        'Please configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your local .env.local file.'
    );
  }
  return clientInstance;
}

/**
 * Returns formatted status summary of Supabase configuration.
 * Preserved for backwards compatibility with UI components.
 */
export const getSupabaseStatus = (): SupabaseConfigStatus => {
  const validation = validateSupabaseConfig();

  if (validation.valid) {
    return {
      configured: true,
      urlPreview: validation.url,
      keyType: validation.keyType,
      message: `Connected to Supabase project (${validation.keyType === 'publishable' ? 'Publishable Key' : 'Anon Key'}).`,
    };
  }

  return {
    configured: false,
    message:
      'Supabase environment variables not configured in .env.local. ATLAS OS is running with the deterministic in-memory & local-storage business engine with complete tenant isolation and audit trails.',
    error: validation.error,
  };
};

/**
 * Safe connection verification method.
 * Makes a minimal request to the Supabase Auth endpoint (supabase.auth.getSession()).
 * Reports success or useful error without exposing credentials.
 * Handles network errors gracefully.
 * Does not require a logged-in user and does not alter database state.
 *
 * NOTE: This verifies client initialization and Auth endpoint reachability.
 * It does NOT claim that database tables, schemas, or RLS policies have been verified.
 */
export async function verifySupabaseConnection(): Promise<SupabaseVerificationResult> {
  const validation = validateSupabaseConfig();

  if (!validation.valid || !validation.url) {
    return {
      clientInitialized: false,
      authEndpointReachable: false,
      status: 'unconfigured',
      message: validation.error || 'Supabase is not configured in .env.local.',
      authSessionPresent: false,
      databaseTablesVerified: false,
    };
  }

  const client = clientInstance;
  if (!client) {
    return {
      clientInitialized: false,
      authEndpointReachable: false,
      status: 'unconfigured',
      message: 'Supabase client instance is null despite passing configuration validation.',
      authSessionPresent: false,
      databaseTablesVerified: false,
    };
  }

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    const { data, error } = await client.auth.getSession();
    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.round(endTime - startTime);

    if (error) {
      return {
        clientInitialized: true,
        authEndpointReachable: false,
        status: 'auth_error',
        message: `Supabase Auth endpoint returned an error: ${error.message}`,
        latencyMs,
        projectUrl: validation.url,
        authSessionPresent: false,
        details: error.status ? `HTTP status: ${error.status}` : undefined,
        databaseTablesVerified: false,
      };
    }

    return {
      clientInitialized: true,
      authEndpointReachable: true,
      status: 'configured_and_reachable',
      message:
        'Supabase client initialized successfully and Auth endpoint is reachable. (Database tables and RLS policies are not verified by this check).',
      latencyMs,
      projectUrl: validation.url,
      authSessionPresent: Boolean(data?.session),
      databaseTablesVerified: false,
    };
  } catch (err: unknown) {
    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = Math.round(endTime - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      clientInitialized: true,
      authEndpointReachable: false,
      status: 'network_error',
      message: `Network error while reaching Supabase Auth endpoint: ${errorMessage}`,
      latencyMs,
      projectUrl: validation.url,
      authSessionPresent: false,
      databaseTablesVerified: false,
    };
  }
}
