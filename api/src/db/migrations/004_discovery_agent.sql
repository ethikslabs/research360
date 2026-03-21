-- Discovery candidates
CREATE TABLE IF NOT EXISTS discovery_candidates (
  candidate_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL,
  url                   TEXT NOT NULL,
  canonical_url         TEXT NOT NULL,
  source_domain         TEXT,
  source_feed           TEXT,
  source_type           VARCHAR(20) NOT NULL,
  source_tier           INTEGER CHECK (source_tier IN (1, 2, 3)),
  jurisdiction          VARCHAR(10) NOT NULL DEFAULT 'GLOBAL',
  framework_tags        TEXT[] DEFAULT '{}',
  vendor_tags           TEXT[] DEFAULT '{}',
  discovery_mode        VARCHAR(30) NOT NULL,
  justification         TEXT NOT NULL,
  confidence            NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  auto_ingest           BOOLEAN DEFAULT FALSE,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  review_reason         TEXT,
  error_message         TEXT,
  content_fingerprint   TEXT,
  ingest_job_id         UUID NULL,
  generated_at          TIMESTAMPTZ DEFAULT NOW(),
  actioned_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status       ON discovery_candidates(status);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_run_id       ON discovery_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_canonical_url ON discovery_candidates(canonical_url);

-- Discovery run metrics
CREATE TABLE IF NOT EXISTS discovery_runs (
  run_id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                   TIMESTAMPTZ DEFAULT NOW(),
  completed_at                 TIMESTAMPTZ,
  candidates_generated         INTEGER DEFAULT 0,
  candidates_inserted          INTEGER DEFAULT 0,
  candidates_auto_ingested     INTEGER DEFAULT 0,
  candidates_pending_review    INTEGER DEFAULT 0,
  candidates_rejected_dedupe   INTEGER DEFAULT 0,
  feed_sources_polled          INTEGER DEFAULT 0,
  feed_source_failures         INTEGER DEFAULT 0,
  claude_latency_ms            INTEGER,
  total_run_duration_ms        INTEGER,
  error_message                TEXT,
  status                       VARCHAR(20) DEFAULT 'running'
);

-- Extend chunks with discovery metadata (idempotent DO blocks)
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN source_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN canonical_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN source_tier INTEGER CHECK (source_tier IN (1, 2, 3)); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN jurisdiction VARCHAR(10) DEFAULT 'GLOBAL'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN framework_tags TEXT[] DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN vendor_tags TEXT[] DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN last_validated TIMESTAMPTZ DEFAULT NOW(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chunks ADD COLUMN discovery_candidate_id UUID REFERENCES discovery_candidates(candidate_id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_chunks_canonical_url  ON chunks(canonical_url);
CREATE INDEX IF NOT EXISTS idx_chunks_last_validated ON chunks(last_validated);
