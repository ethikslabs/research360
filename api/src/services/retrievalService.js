import { pool } from '../db/client.js'
import { embedText } from './embeddingService.js'

const COMPLEXITY_K = { simple: 3, detailed: 5, deep: 15 }
const MIN_RELEVANCE = 0.15

export async function retrieve({ query, tenantId, complexity = 'detailed', filters = {}, layers, run_id }) {
  const k = COMPLEXITY_K[complexity] || 10
  const queryEmbedding = await embedText(query)
  const vector = `[${queryEmbedding.join(',')}]`

  const conditions = ['c.tenant_id = $2', 'c.embedding IS NOT NULL']
  const params = [vector, tenantId]
  let i = 3

  if (filters.source_type) {
    conditions.push('d.source_type = $' + i++)
    params.push(filters.source_type)
  }
  if (filters.document_id) {
    conditions.push('c.document_id = $' + i++)
    params.push(filters.document_id)
  }
  if (layers?.length) {
    conditions.push("c.provenance->>'layer' = ANY($" + i++ + '::text[])')
    params.push(layers)
  }

  const sql = `
    SELECT
      c.id             AS chunk_id,
      c.chunk_text,
      c.chunk_index,
      c.provenance,
      c.metadata,
      c.source_tier,
      c.jurisdiction,
      c.framework_tags,
      c.vendor_tags,
      c.last_validated,
      c.canonical_url AS canonical_uri,
      1 - (c.embedding <=> $1::vector) AS relevance_score,
      d.id             AS document_id,
      d.title          AS document_title,
      d.source_type,
      d.source_url
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY relevance_score DESC
    LIMIT ${k}
  `

  const res = await pool.query(sql, params)
  const rows = res.rows.filter(r => r.relevance_score >= MIN_RELEVANCE)

  // Inject run-scoped reasoning usages into provenance when run_id provided.
  // Provenance at rest always has reasoning: { run_id: null, usages: [] }.
  // This assembles the reasoning block at query time — never stored on the chunk.
  if (run_id && rows.length) {
    const chunkIds = rows.map(r => r.chunk_id)
    const usagesRes = await pool.query(
      `SELECT chunk_id, step, step_index, confidence, used_at
       FROM chunk_reasoning_usages
       WHERE run_id = $1 AND chunk_id = ANY($2::uuid[])
       ORDER BY chunk_id, step_index`,
      [run_id, chunkIds]
    )

    const usagesByChunk = {}
    for (const u of usagesRes.rows) {
      if (!usagesByChunk[u.chunk_id]) usagesByChunk[u.chunk_id] = []
      usagesByChunk[u.chunk_id].push({
        step:        u.step,
        step_index:  u.step_index,
        confidence:  u.confidence,
        used_at:     u.used_at,
      })
    }

    for (const row of rows) {
      // Req 8.4: scope reasoning to this run — even if no usages found
      const usages = usagesByChunk[row.chunk_id] || []
      row.provenance = { ...row.provenance, reasoning: { run_id, usages } }
    }
  }

  return rows
}
