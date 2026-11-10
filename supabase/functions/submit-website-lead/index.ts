import { createLeadHandler } from './lead-handler.mjs';

// Public marketing form endpoint. Authentication is instead enforced through
// Cloudflare Turnstile and a service-only database rate limit.
// supabase/config.toml sets verify_jwt=false for this public function.
Deno.serve(createLeadHandler({
  env: (key: string) => Deno.env.get(key),
  fetchImpl: fetch,
}));
