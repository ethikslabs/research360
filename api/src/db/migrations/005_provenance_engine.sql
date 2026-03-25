-- 005_provenance_engine.sql
-- Provenance Engine v1.0

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. canonical_url column and idx_chunks_canonical_url index
--    Both already exist from 004_discovery_agent.sql and are left unchanged.
--    The SQL column stays as canonical_url for backward compatibility.
--    Provenance service code, JSONB fields, and API responses use canonical_uri.
--    Queries alias the column: SELECT canonical_url AS canonical_uri where needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add provenance columns to chunks (all idempotent via IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS provenance              JSONB         NOT NULL DEFAULT '{}';
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_type             VARCHAR(20);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_subtype          VARCHAR(30);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS extraction_confidence   FLOAT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS ingested_by             VARCHAR(100);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_retrieved_at     TIMESTAMPTZ;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS source_uri              TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS raw_snapshot_uri        TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS snapshot_policy         VARCHAR(30)   DEFAULT 'static';
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_stale                BOOLEAN       DEFAULT FALSE;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS stale_since             TIMESTAMPTZ;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_superseded           BOOLEAN       DEFAULT FALSE;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS superseded_at           TIMESTAMPTZ;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS superseded_by_chunk_id  UUID REFERENCES chunks(id);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS previous_chunk_id       UUID REFERENCES chunks(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes on chunks (provenance columns)
--    Note: idx_chunks_canonical_url already exists from migration 004.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_chunks_is_stale            ON chunks(is_stale);
CREATE INDEX IF NOT EXISTS idx_chunks_is_superseded       ON chunks(is_superseded);
CREATE INDEX IF NOT EXISTS idx_chunks_source_retrieved_at ON chunks(source_retrieved_at);
CREATE INDEX IF NOT EXISTS idx_chunks_superseded_by       ON chunks(superseded_by_chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunks_snapshot_policy     ON chunks(snapshot_policy);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. trust_runs — append-only run log (v1 JSONB shape)
--    Must be created before chunk_reasoning_usages (FK dependency).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trust_runs (
  run_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         VARCHAR(100),
  run_at             TIMESTAMPTZ DEFAULT NOW(),
  corpus_snapshot    JSONB,
  chunks_retrieved   JSONB,
  reasoning_steps    JSONB,
  gaps_identified    JSONB,
  vendor_resolutions JSONB,
  trust_scores       JSONB
  -- Append-only. Never update or delete rows.
  -- Stale and lifecycle state lives in trust_run_events.
  -- v1 JSONB shape. Child tables added later for analytics.
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. prevent_trust_runs_mutation — DB-level enforcement of append-only invariant
--    Uses single-quoted function body to avoid dollar-quoting (pg client compat).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_trust_runs_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS
'BEGIN
  RAISE EXCEPTION ''trust_runs is append-only. Updates and deletes are not permitted. run_id: %'', OLD.run_id
    USING ERRCODE = ''restrict_violation'';
END;';

DROP TRIGGER IF EXISTS trust_runs_immutable ON trust_runs;
CREATE TRIGGER trust_runs_immutable
  BEFORE UPDATE OR DELETE ON trust_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_trust_runs_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. trust_run_events — lifecycle event log per run
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trust_run_events (
  event_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID        NOT NULL REFERENCES trust_runs(run_id),
  event_type VARCHAR(50) NOT NULL,
  event_at   TIMESTAMPTZ DEFAULT NOW(),
  payload    JSONB
  -- event_type enum (v1):
  --   stale_flagged      chunk cited in this run was refreshed or superseded
  --   refresh_triggered  refresh requested for sources cited in this run
  --   refresh_completed  refresh done, re-run available
  --   dispute_opened     vendor-initiated dispute against this run
  --   dispute_closed     dispute resolved (outcome in payload)
);

CREATE INDEX IF NOT EXISTS idx_trust_run_events_run_id   ON trust_run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_trust_run_events_event_at ON trust_run_events(event_at);
CREATE INDEX IF NOT EXISTS idx_trust_run_events_type     ON trust_run_events(event_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. chunk_reasoning_usages — per-usage reasoning provenance
--    Separate table (not JSONB array) to avoid unbounded growth per chunk.
--    At query time, assembled into reasoning block if run_id provided.
--    The provenance JSONB on chunks always stores reasoning.usages = [].
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chunk_reasoning_usages (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id   UUID    NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  run_id     UUID    NOT NULL REFERENCES trust_runs(run_id),
  step       TEXT    NOT NULL,
  step_index INTEGER NOT NULL,
  confidence FLOAT   NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunk_reasoning_usages_chunk_id ON chunk_reasoning_usages(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_reasoning_usages_run_id   ON chunk_reasoning_usages(run_id);
