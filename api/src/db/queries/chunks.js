import { pool } from '../client.js'

export async function insertBatch(chunks) {
  if (!chunks.length) return
  const values = chunks.map((_, i) => {
    const base = i * 6
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
  }).join(', ')

  const params = chunks.flatMap(c => [
    c.tenantId, c.documentId, c.chunkIndex, c.chunkText, c.chunkHash, c.tokenCount ?? null,
  ])

  await pool.query(
    `INSERT INTO chunks (tenant_id, document_id, chunk_index, chunk_text, chunk_hash, token_count)
     VALUES ${values}
     ON CONFLICT (chunk_hash) DO NOTHING`,
    params
  )
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
