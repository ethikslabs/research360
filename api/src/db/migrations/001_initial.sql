CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL DEFAULT 'ethikslabs',
  title        TEXT,
  source_type  TEXT NOT NULL,
  source_url   TEXT,
  file_name    TEXT,
  file_type    TEXT,
  s3_key       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL DEFAULT 'ethikslabs',
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  chunk_hash    TEXT NOT NULL,
  token_count   INTEGER,
  embedding     vector(3072),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL DEFAULT 'ethikslabs',
  title        TEXT,
  history      JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Vector index skipped for local dev (pgvector 2000 dim limit)
-- Add HNSW index on RDS with pgvector 0.7+:
-- CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_tenant_doc_idx
  ON chunks (tenant_id, document_id);

CREATE UNIQUE INDEX IF NOT EXISTS chunks_hash_idx
  ON chunks (chunk_hash);
