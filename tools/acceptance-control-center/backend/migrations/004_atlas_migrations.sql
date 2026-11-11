CREATE TABLE IF NOT EXISTS atlas_migration_checks (
 version INTEGER PRIMARY KEY CHECK (version BETWEEN 1 AND 48),
 name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('verified','failed','blocked','unknown')),
 verified_at TIMESTAMPTZ,
 evidence_url TEXT NOT NULL DEFAULT '',
 observed_from TEXT NOT NULL DEFAULT 'snapshot'
)