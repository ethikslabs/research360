-- Migration 007: Multi-scope corpus model
-- Adds corpus_scope (global / tenant / individual) and user_id to support
-- the layered knowledge architecture: global corpus, tenant corpus, individual corpus.
--
-- corpus_scope determines visibility:
--   global     → visible to all tenants (seed docs, compliance frameworks, shared knowledge)
--   tenant     → visible to a single tenant (partner agreements, company policies)
--   individual → visible to a single user within a tenant (personal research, notes)
--
-- user_id identifies the owner for individual-scoped documents.
-- For global/tenant scope, user_id records who uploaded but does not restrict access.

-- 1. Add corpus_scope to documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS corpus_scope VARCHAR(20) NOT NULL DEFAULT 'tenant'
    CHECK (corpus_scope IN ('global', 'tenant', 'individual'));

-- 2. Add user_id to documents (nullable — required only for individual scope)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);

-- 3. Add corpus_scope to chunks (denormalised for fast retrieval filtering)
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS corpus_scope VARCHAR(20) NOT NULL DEFAULT 'tenant'
    CHECK (corpus_scope IN ('global', 'tenant', 'individual'));

-- 4. Add user_id to chunks (denormalised for individual-scope filtering)
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);

-- 5. Indexes for retrieval queries that filter by scope
CREATE INDEX IF NOT EXISTS idx_documents_corpus_scope ON documents (corpus_scope);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_corpus_scope ON chunks (corpus_scope);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON chunks (user_id) WHERE user_id IS NOT NULL;

-- 6. Composite index for the common retrieval pattern:
--    "give me global + this tenant's + this user's chunks"
CREATE INDEX IF NOT EXISTS idx_chunks_scope_tenant_user
  ON chunks (corpus_scope, tenant_id, user_id);

-- 7. Enforce: individual-scoped documents must have a user_id
ALTER TABLE documents
  ADD CONSTRAINT chk_individual_requires_user
    CHECK (corpus_scope != 'individual' OR user_id IS NOT NULL);

ALTER TABLE chunks
  ADD CONSTRAINT chk_chunks_individual_requires_user
    CHECK (corpus_scope != 'individual' OR user_id IS NOT NULL);
