import { createClient } from '@supabase/supabase-js';
import { validateSupabaseConfig } from './supabase';

const config = validateSupabaseConfig();
export const ownerSupabase = config.valid && config.url && config.key
  ? createClient(config.url, config.key, {
      auth: {
        storageKey: 'atlas-owner-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function getOwnerSupabase() {
  if (!ownerSupabase) throw new Error('Connect this private build to Supabase first.');
  return ownerSupabase;
}
