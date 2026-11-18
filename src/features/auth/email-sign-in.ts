import type { SupabaseClient } from '@supabase/supabase-js';

export async function requestSignInCode(client: SupabaseClient, email: string): Promise<{ error?: string }> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false },
  });
  // Keep account existence private when Supabase rejects a sign-in for this address.
  if (!error || ['signup_disabled', 'user_not_found', 'email_not_confirmed'].includes(error.code ?? '')) return {};
  if (error.status === 429) return { error: 'Wait a minute before requesting another email code.' };
  if (error.code === 'otp_disabled') return { error: 'Email code sign-in is unavailable. Use your password.' };
  return { error: 'We couldn’t send a sign-in code. Try again or use your password.' };
}
