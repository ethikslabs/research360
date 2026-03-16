import { pool } from '../db/client.js'
import { embedText } from './embeddingService.js'

const COMPLEXITY_K = { simple: 3, detailed: 5, deep: 15 }
const MIN_RELEVANCE = 0.15

export async function retrieve({ query, tenantId, complexity = 'detailed', filters = {} }) {
  const k = COMPLEXITY_K[complexity] || 10
  const queryEmbedding = await embedText(query)
  const vector = `[${queryEmbedding.join(',')}]`

  const conditions = ['c.tenant_id = $2', 'c.embedding IS NOT NULL']
  const params = [vector, tenantId]
  let i = 3

  if (filters.source_type) {
    conditions.push(`d.source_type = $${i++}`)
    params.push(filters.source_type)
  }
  if (filters.document_id) {
    conditions.push(`c.document_id = $${i++}`)
    params.push(filters.document_id)
  }

  const sql = `
    SELECT
      c.id           AS chunk_id,
      c.chunk_text,
      c.chunk_index,
      c.metadata,
      1 - (c.embedding <=> $1::vector) AS relevance_score,
      d.id           AS document_id,
      d.title        AS document_title,
      d.source_type,
      d.source_url
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY relevance_score DESC
    LIMIT ${k}
  `

  const res = await pool.query(sql, params)
  return res.rows.filter(r => r.relevance_score >= MIN_RELEVANCE)
}
