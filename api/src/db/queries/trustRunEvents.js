import { pool } from '../client.js'

/** v1 event_type enum — extensible by migration only. */
export const VALID_EVENT_TYPES = [
  'stale_flagged',
  'refresh_triggered',
  'refresh_completed',
  'dispute_opened',
  'dispute_closed',
]

export async function insertEvent(event) {
  if (!VALID_EVENT_TYPES.includes(event.event_type)) {
    throw new Error(
      `Invalid event_type "${event.event_type}". Must be one of: ${VALID_EVENT_TYPES.join(', ')}`
    )
  }

  const res = await pool.query(
    `INSERT INTO trust_run_events (run_id, event_type, payload)
     VALUES ($1, $2, $3::jsonb)
     RETURNING *`,
    [event.run_id, event.event_type, JSON.stringify(event.payload ?? null)]
  )
  return res.rows[0]
}

// Returns events in chronological order — required for audit replay.
export async function findEventsByRunId(runId) {
  const res = await pool.query(
    'SELECT * FROM trust_run_events WHERE run_id = $1 ORDER BY event_at ASC',
    [runId]
  )
  return res.rows
}
