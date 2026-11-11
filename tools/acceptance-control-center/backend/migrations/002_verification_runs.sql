CREATE TABLE IF NOT EXISTS verification_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 check_id TEXT NOT NULL REFERENCES acceptance_checks(id),
 status TEXT NOT NULL CHECK (status IN ('verified','failed','blocked','unknown')),
 method TEXT NOT NULL,
 environment TEXT NOT NULL,
 commit_sha TEXT NOT NULL DEFAULT '',
 pr_number INTEGER,
 evidence_url TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT 'release owner',
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
)