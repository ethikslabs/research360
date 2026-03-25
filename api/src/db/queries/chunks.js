import { pool } from '../client.js'

const COLS_PER_ROW = 18

export async function insertBatch(chunks) {
  if (!chunks.length) return

  const values = chunks.map((_, i) => {
    const b = i * COLS_PER_ROW
    return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6},` +
           ` $${b+7}::jsonb, $${b+8}, $${b+9}, $${b+10}, $${b+11}, $${b+12},` +
           ` $${b+13}, $${b+14}, $${b+15}, $${b+16}, $${b+17}, $${b+18})`
  }).join(', ')

  const params = chunks.flatMap(c => [
    c.tenantId,
    c.documentId,
    c.chunkIndex,
    c.chunkText,
    c.chunkHash,
    c.tokenCount ?? null,
    JSON.stringify(c.provenance ?? {}),
    c.source_type             ?? null,
    c.source_subtype          ?? null,
    c.extraction_confidence   ?? null,
    c.ingested_by             ?? null,
    c.source_retrieved_at     ?? null,
    c.source_uri              ?? null,
    c.canonical_uri           ?? null,
    c.raw_snapshot_uri        ?? null,
    c.snapshot_policy         ?? 'static',
    c.is_stale                ?? false,
    c.is_superseded           ?? false,
  ])

  await pool.query(
    `INSERT INTO chunks (
       tenant_id, document_id, chunk_index, chunk_text, chunk_hash, token_count,
       provenance, source_type, source_subtype, extraction_confidence, ingested_by,
       source_retrieved_at, source_uri, canonical_url, raw_snapshot_uri,
       snapshot_policy, is_stale, is_superseded
     )
     VALUES ${values}
     ON CONFLICT (chunk_hash) DO NOTHING`,
    params
  )
}

export async function findProvenanceByChunkId(chunkId, tenantId) {
  const res = await pool.query(
    'SELECT provenance FROM chunks WHERE id = $1 AND tenant_id = $2',
    [chunkId, tenantId]
  )
  return res.rows[0]?.provenance ?? null
}

export async function markStale(chunkIds, staleSince) {
  if (!chunkIds.length) return
  const placeholders = chunkIds.map((_, i) => `$${i + 2}`).join(', ')
  await pool.query(
    `UPDATE chunks SET is_stale = true, stale_since = $1
     WHERE id IN (${placeholders}) AND is_stale = false`,
    [staleSince ?? new Date().toISOString(), ...chunkIds]
  )
}

export async function markSuperseded(oldChunkId, newChunkId) {
  await pool.query(
    `UPDATE chunks SET is_superseded = true, superseded_at = NOW(), superseded_by_chunk_id = $1
     WHERE id = $2`,
    [newChunkId, oldChunkId]
  )
  await pool.query(
    'UPDATE chunks SET previous_chunk_id = $1 WHERE id = $2',
    [oldChunkId, newChunkId]
  )
}

// Returns chunks whose TTL has expired but are not yet marked stale.
// ttl_hours is stored in provenance JSONB — extracted at query time.
export async function findStaleEligible() {
  const res = await pool.query(
    `SELECT id, provenance, source_retrieved_at
     FROM chunks
     WHERE is_stale = false
       AND snapshot_policy = 'auto_refresh'
       AND source_retrieved_at IS NOT NULL
       AND (provenance -> 'source' -> 'freshness_policy' ->> 'ttl_hours') IS NOT NULL
       AND source_retrieved_at + (
             (provenance -> 'source' -> 'freshness_policy' ->> 'ttl_hours')::float
             * INTERVAL '1 hour'
           ) < NOW()`
  )
  return res.rows
}

export async function findByDocumentId(documentId) {
  const res = await pool.query(
    'SELECT * FROM chunks WHERE document_id = $1 ORDER BY chunk_index',
    [documentId]
  )
  return res.rows
}

export async function findNullEmbeddings(documentId) {
  const res = await pool.query(
    'SELECT id, chunk_text, chunk_hash FROM chunks WHERE document_id = $1 AND embedding IS NULL ORDER BY chunk_index',
    [documentId]
  )
  return res.rows
}

export async function updateEmbedding(id, embedding) {
  await pool.query(
    'UPDATE chunks SET embedding = $1 WHERE id = $2',
    [`[${embedding.join(',')}]`, id]
  )
}

export async function deleteByDocumentId(documentId) {
  await pool.query('DELETE FROM chunks WHERE document_id = $1', [documentId])
}

export async function countByDocumentId(documentId) {
  const res = await pool.query(
    'SELECT COUNT(*)::int AS count FROM chunks WHERE document_id = $1',
    [documentId]
  )
  return res.rows[0].count
}
