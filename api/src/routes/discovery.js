import { pool } from '../db/client.js'
import { config } from '../config/env.js'
import { queues } from '../queue/client.js'

const DEFAULT_TENANT = 'ethikslabs'

export default async function discoveryRoutes(app) {

  // List pending candidates for human review
  app.get('/api/discovery/pending', async (request, reply) => {
    const res = await pool.query(`
      SELECT
        candidate_id, run_id, url, canonical_url, source_domain,
        source_type, source_tier, jurisdiction, framework_tags, vendor_tags,
        discovery_mode, justification, confidence, generated_at
      FROM discovery_candidates
      WHERE status = 'pending'
      ORDER BY confidence DESC, generated_at DESC
    `)
    return reply.send({ candidates: res.rows })
  })

  // List recent discovery run summaries
  app.get('/api/discovery/runs', async (request, reply) => {
    const res = await pool.query(`
      SELECT *
      FROM discovery_runs
      ORDER BY started_at DESC
      LIMIT 20
    `)
    return reply.send({ runs: res.rows })
  })

  // Approve a candidate — immediately queue for ingest
  app.post('/api/discovery/:id/approve', async (request, reply) => {
    const { id } = request.params

    const candidate = await pool.query(
      `SELECT * FROM discovery_candidates WHERE candidate_id = $1 AND status = 'pending'`,
      [id]
    )

    if (candidate.rowCount === 0) {
      return reply.status(404).send({ error: 'Candidate not found or not pending', code: 'NOT_FOUND' })
    }

    const c = candidate.rows[0]

    try {
      const res = await fetch(`http://localhost:${config.PORT}/research360/ingest/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: c.canonical_url, title: null, tenant_id: DEFAULT_TENANT }),
      })

      if (!res.ok) throw new Error(`Ingest API returned ${res.status}`)
      const body = await res.json()

      await pool.query(
        `UPDATE discovery_candidates
         SET status = 'ingested', ingest_job_id = $1, actioned_at = NOW()
         WHERE candidate_id = $2`,
        [body.document_id, id]
      )

      return reply.send({ candidate_id: id, status: 'ingested', document_id: body.document_id })
    } catch (err) {
      return reply.status(500).send({ error: `Ingest failed: ${err.message}`, code: 'INGEST_FAILED' })
    }
  })

  // Reject a candidate
  app.post('/api/discovery/:id/reject', async (request, reply) => {
    const { id } = request.params
    const { reason } = request.body || {}

    if (!reason?.trim()) {
      return reply.status(400).send({ error: 'reason is required', code: 'MISSING_REASON' })
    }

    const res = await pool.query(
      `UPDATE discovery_candidates
       SET status = 'rejected', review_reason = $1, actioned_at = NOW()
       WHERE candidate_id = $2 AND status = 'pending'
       RETURNING candidate_id`,
      [reason, id]
    )

    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'Candidate not found or not pending', code: 'NOT_FOUND' })
    }

    return reply.send({ candidate_id: id, status: 'rejected' })
  })

  // Trigger a manual discovery run
  app.post('/api/discovery/run', async (request, reply) => {
    await queues.discovery.add('manual', { trigger: 'manual' })
    return reply.send({ status: 'queued', message: 'Discovery run queued' })
  })
}
