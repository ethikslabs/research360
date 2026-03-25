-- 006_file_hash.sql
-- SHA-256 hash of raw file bytes for document-level dedup on file uploads.

DO $$ BEGIN
  ALTER TABLE documents ADD COLUMN file_hash VARCHAR(64);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash) WHERE file_hash IS NOT NULL;
