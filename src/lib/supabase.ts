import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !supabaseUrl.includes('placeholder') &&
    supabaseAnonKey.length > 20
  );
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export const getSupabaseStatus = (): {
  configured: boolean;
  urlPreview?: string;
  message: string;
} => {
  if (isSupabaseConfigured()) {
    return {
      configured: true,
      urlPreview: supabaseUrl,
      message: 'Connected to configured Supabase project backend.',
    };
  }

  return {
    configured: false,
    message:
      'Supabase environment variables not configured in .env.local. ATLAS OS is running with the deterministic in-memory & local-storage business engine with complete tenant isolation and audit trails.',
  };
};
