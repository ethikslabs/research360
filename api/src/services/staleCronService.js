import { findStaleEligible, markStale } from '../db/queries/chunks.js'

// Scans for chunks whose TTL has expired and marks them stale.
// Intended to be called on a schedule (e.g., hourly cron via BullMQ).
// Event writing to trust_run_events requires a run_id and is not performed here —
// stale_flagged events are written by Trust360 at run-read time when it detects
// a cited chunk has been marked stale since the run completed.

export async function runStaleScan() {
  const eligible = await findStaleEligible()
  if (!eligible.length) return { marked: 0 }

  const ids = eligible.map(c => c.id)
  const staleSince = new Date().toISOString()
  await markStale(ids, staleSince)

  console.log(JSON.stringify({ stage: 'stale_scan', marked_stale: ids.length, timestamp: staleSince }))
  return { marked: ids.length, chunk_ids: ids }
}
