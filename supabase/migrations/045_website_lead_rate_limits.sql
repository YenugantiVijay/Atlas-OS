-- PR #51: server-only rate limiter for public Atlas OS marketing enquiries.
-- No visitor name, email, phone, message, or plaintext IP is stored.
-- The Edge Function uses a secret-keyed SHA-256 digest of its rate-limit subject.
CREATE TABLE IF NOT EXISTS public.website_lead_rate_limits (
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 100),
  PRIMARY KEY (subject_hash, window_start)
);

ALTER TABLE public.website_lead_rate_limits ENABLE ROW LEVEL SECURITY;

-- Supabase defaults may grant public access to new tables. Explicitly deny it.
REVOKE ALL ON TABLE public.website_lead_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.website_lead_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_website_lead_rate_limit(
  p_subject_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  IF p_subject_hash IS NULL OR p_subject_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate limit subject' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.website_lead_rate_limits (subject_hash, window_start, attempts)
  VALUES (p_subject_hash, date_trunc('hour', clock_timestamp()), 1)
  ON CONFLICT (subject_hash, window_start)
  DO UPDATE SET attempts = public.website_lead_rate_limits.attempts + 1
  WHERE public.website_lead_rate_limits.attempts < 5
  RETURNING attempts INTO v_attempts;

  RETURN v_attempts IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_website_lead_rate_limit(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_website_lead_rate_limit(TEXT)
  TO service_role;

COMMENT ON TABLE public.website_lead_rate_limits IS
  'Service-only throttling counters for public website enquiries; keyed by secret-salted hashes, no PII.';
COMMENT ON FUNCTION public.consume_website_lead_rate_limit(TEXT) IS
  'Service-role-only atomic rate limiter, up to 5 requests per subject/hour. Public browser callers denied.';
