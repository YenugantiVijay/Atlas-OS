CREATE TABLE IF NOT EXISTS github_state (
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 repo TEXT NOT NULL DEFAULT 'YenugantiVijay/Atlas-OS',
 main_sha TEXT NOT NULL DEFAULT '',
 dev_sha TEXT NOT NULL DEFAULT '',
 pull_requests JSONB NOT NULL DEFAULT '[]'::jsonb,
 ci_runs JSONB NOT NULL DEFAULT '[]'::jsonb,
 last_synced_at TIMESTAMPTZ,
 last_error TEXT NOT NULL DEFAULT '',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)