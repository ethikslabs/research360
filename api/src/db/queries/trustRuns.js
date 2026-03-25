import { pool } from '../client.js'

// INSERT only — no update or delete functions.
// Immutability is enforced at DB level via prevent_trust_runs_mutation trigger.

export async function insertRun(run) {
  const res = await pool.query(
    `INSERT INTO trust_runs
       (company_id, corpus_snapshot, chunks_retrieved, reasoning_steps, gaps_identified, vendor_resolutions, trust_scores)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
     RETURNING *`,
    [
      run.company_id            ?? null,
      JSON.stringify(run.corpus_snapshot    ?? null),
      JSON.stringify(run.chunks_retrieved   ?? null),
      JSON.stringify(run.reasoning_steps    ?? null),
      JSON.stringify(run.gaps_identified    ?? null),
      JSON.stringify(run.vendor_resolutions ?? null),
      JSON.stringify(run.trust_scores       ?? null),
    ]
  )
  return res.rows[0]
}

export async function findRunById(runId) {
  const res = await pool.query('SELECT * FROM trust_runs WHERE run_id = $1', [runId])
  return res.rows[0] ?? null
}

// Returns run metadata + provenance JSONB for every chunk cited in the run.
// chunks_retrieved is expected to contain an array of chunk UUIDs, or a map
// keyed by chunk UUID. Both shapes are handled.
export async function findRunProvenance(runId) {
  const run = await findRunById(runId)
  if (!run) return null

  let chunkIds = []
  if (Array.isArray(run.chunks_retrieved)) {
    chunkIds = run.chunks_retrieved
  } else if (run.chunks_retrieved && typeof run.chunks_retrieved === 'object') {
    chunkIds = Object.keys(run.chunks_retrieved)
  }

  const sources = chunkIds.length
    ? (await pool.query(
        'SELECT id AS chunk_id, chunk_text, provenance FROM chunks WHERE id = ANY($1::uuid[])',
        [chunkIds]
      )).rows
    : []

  return { run_id: runId, run_at: run.run_at, sources }
}
