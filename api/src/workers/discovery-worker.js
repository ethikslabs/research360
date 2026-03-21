import Anthropic from '@anthropic-ai/sdk'
import { Worker } from 'bullmq'
import { randomUUID } from 'crypto'
import { redis } from '../queue/client.js'
import { pool } from '../db/client.js'
import { config } from '../config/env.js'
import { VENDORS } from '../config/vendors.js'
import { GAP_CATEGORIES } from '../config/gaps.js'
import { buildCoverageSummary } from '../services/coverage-summary.js'
import { pollFeeds } from '../services/feed-poller.js'
import { validateManifest } from '../services/manifest-validator.js'
import { canonicalizeUrl, sourceDomain, isDuplicate } from '../services/canonicalize.js'

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildPrompt(coverageSummary, vendorCatalog, feedItems) {
  return `You are the Research360 Discovery Agent for Proof360, a trust intelligence platform for Australian founders and SMEs.

Your job is to identify what the corpus is missing that would materially improve vendor recommendations across these gap categories: security, compliance, governance, identity, cloud infrastructure, and operational maturity.

CONFIDENCE DEFINITION:
confidence = your confidence that ingesting this URL will materially improve Research360 corpus quality for Proof360 vendor recommendations. Score on utility to the corpus, not general importance.

You will receive:
1. corpus_summary — current corpus coverage (what exists, how fresh, what is thin)
2. vendor_catalog — vendors currently in the Proof360 recommendation engine
3. feed_items — recent items from monitored sources (last ${config.HORIZON_LOOKBACK_HOURS} hours)

<corpus_summary>
${JSON.stringify(coverageSummary, null, 2)}
</corpus_summary>

<vendor_catalog>
${JSON.stringify(vendorCatalog, null, 2)}
</vendor_catalog>

<feed_items>
${JSON.stringify(feedItems.slice(0, 20), null, 2)}
</feed_items>

Your task across three modes:

GAP DETECTION (max ${config.DISCOVERY_MAX_GAP} candidates):
- Identify frameworks or compliance areas with thin coverage (see thin_areas)
- Identify jurisdictions under-represented relative to AU-first mandate
- Generate candidate URLs for authoritative sources on those gaps

VENDOR STALENESS (max ${config.DISCOVERY_MAX_STALENESS} candidates):
- For each vendor in stale_vendors, find their current trust/security page
- Prioritise vendors with highest gap_category relevance in Proof360

HORIZON SCAN (max ${config.DISCOVERY_MAX_HORIZON} candidates):
- From feed_items, identify emerging threats or frameworks not yet in corpus
- Only surface items where the same topic appears in 2+ feed sources
- Candidate URL should be the primary source page, not the feed item itself

RULES:
- Prioritise AU jurisdiction sources
- Prioritise Tier 1 (authoritative framework/gov) over Tier 2 (vendor) over Tier 3
- Maximum ${config.DISCOVERY_MAX_CANDIDATES} candidates total across all modes
- Do not surface URLs likely to be paywalled
- Justification must be one sentence anchored to corpus utility

Respond ONLY with a valid JSON array. No preamble. No markdown. No explanation.

Schema per candidate:
{
  "url": string,
  "source_type": "url" | "document" | "api_feed",
  "source_tier": 1 | 2 | 3,
  "source_domain": string,
  "jurisdiction": "AU" | "US" | "EU" | "GLOBAL",
  "framework_tags": string[],
  "vendor_tags": string[],
  "discovery_mode": "gap_detection" | "vendor_staleness" | "horizon_scan",
  "justification": string,
  "confidence": number
}`
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function createRun() {
  const runId = randomUUID()
  await pool.query(
    `INSERT INTO discovery_runs (run_id) VALUES ($1)`,
    [runId]
  )
  return runId
}

async function finalizeRun(runId, metrics) {
  await pool.query(
    `UPDATE discovery_runs SET
       completed_at               = NOW(),
       status                     = $2,
       candidates_generated       = $3,
       candidates_inserted        = $4,
       candidates_auto_ingested   = $5,
       candidates_pending_review  = $6,
       candidates_rejected_dedupe = $7,
       feed_sources_polled        = $8,
       feed_source_failures       = $9,
       claude_latency_ms          = $10,
       total_run_duration_ms      = $11,
       error_message              = $12
     WHERE run_id = $1`,
    [
      runId,
      metrics.error ? 'failed' : 'completed',
      metrics.candidates_generated,
      metrics.candidates_inserted,
      metrics.candidates_auto_ingested,
      metrics.candidates_pending_review,
      metrics.candidates_rejected_dedupe,
      metrics.feed_sources_polled,
      metrics.feed_source_failures,
      metrics.claude_latency_ms,
      metrics.total_run_duration_ms,
      metrics.error || null,
    ]
  )
}

async function insertCandidate(runId, candidate, canonical, autoIngest) {
  const res = await pool.query(
    `INSERT INTO discovery_candidates (
       run_id, url, canonical_url, source_domain, source_feed,
       source_type, source_tier, jurisdiction, framework_tags, vendor_tags,
       discovery_mode, justification, confidence, auto_ingest, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING candidate_id`,
    [
      runId,
      candidate.url,
      canonical,
      candidate.source_domain,
      null,
      candidate.source_type,
      candidate.source_tier,
      candidate.jurisdiction,
      candidate.framework_tags,
      candidate.vendor_tags,
      candidate.discovery_mode,
      candidate.justification,
      candidate.confidence,
      autoIngest,
      autoIngest ? 'approved' : 'pending',
    ]
  )
  return res.rows[0].candidate_id
}

async function autoIngestCandidate(candidateId, url) {
  try {
    const res = await fetch(`http://localhost:${config.PORT}/research360/ingest/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title: null, tenant_id: 'ethikslabs' }),
    })
    if (!res.ok) throw new Error(`Ingest API returned ${res.status}`)
    const body = await res.json()
    await pool.query(
      `UPDATE discovery_candidates SET ingest_job_id = $1, actioned_at = NOW() WHERE candidate_id = $2`,
      [body.document_id, candidateId]
    )
    return true
  } catch (err) {
    console.log(JSON.stringify({ stage: 'auto_ingest', candidate_id: candidateId, error: err.message }))
    return false
  }
}

// ── Main discovery run ────────────────────────────────────────────────────────

async function runDiscovery() {
  const startMs = Date.now()
  const runId = await createRun()

  const metrics = {
    candidates_generated: 0,
    candidates_inserted: 0,
    candidates_auto_ingested: 0,
    candidates_pending_review: 0,
    candidates_rejected_dedupe: 0,
    feed_sources_polled: 0,
    feed_source_failures: 0,
    claude_latency_ms: 0,
    total_run_duration_ms: 0,
    error: null,
  }

  try {
    console.log(JSON.stringify({ stage: 'discovery_start', run_id: runId, timestamp: new Date().toISOString() }))

    // 1. Gather context in parallel
    const [coverageSummary, { items: feedItems, polled, failures }] = await Promise.all([
      buildCoverageSummary(),
      pollFeeds(VENDORS),
    ])

    metrics.feed_sources_polled = polled
    metrics.feed_source_failures = failures

    // 2. Call Claude
    const prompt = buildPrompt(coverageSummary, GAP_CATEGORIES, feedItems)
    const claudeStart = Date.now()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    metrics.claude_latency_ms = Date.now() - claudeStart
    const rawJson = message.content[0]?.text || '[]'

    // 3. Validate manifest
    const { ok, candidates, rejected, error: parseError } = validateManifest(rawJson)

    if (!ok) {
      metrics.error = `Manifest validation failed: ${parseError}`
      await finalizeRun(runId, { ...metrics, total_run_duration_ms: Date.now() - startMs })
      return
    }

    // 4. Enforce hard candidate budget (Claude may exceed it despite instructions)
    const cappedCandidates = candidates.slice(0, config.DISCOVERY_MAX_CANDIDATES)

    console.log(JSON.stringify({
      stage: 'discovery_claude_complete',
      run_id: runId,
      candidates_raw: candidates.length,
      candidates_capped: cappedCandidates.length,
      rejected_schema: rejected.length,
    }))

    metrics.candidates_generated = cappedCandidates.length

    // 5. Dedupe + insert
    // Note: autoIngestCandidate uses localhost HTTP — safe because BullMQ jobs
    // only process AFTER app.listen() completes in start(), so the server
    // is always up when a job runs.
    for (const candidate of cappedCandidates) {
      let canonical
      try {
        canonical = canonicalizeUrl(candidate.url)
      } catch {
        metrics.candidates_rejected_dedupe++
        continue
      }

      const domain = sourceDomain(canonical)
      const dup = await isDuplicate(canonical, candidate.vendor_tags, candidate.framework_tags, domain)
      if (dup) {
        metrics.candidates_rejected_dedupe++
        continue
      }

      const autoIngest = candidate.confidence >= config.AUTO_INGEST_THRESHOLD
      const aboveReview = candidate.confidence >= config.REVIEW_THRESHOLD

      if (!aboveReview) {
        metrics.candidates_rejected_dedupe++
        continue
      }

      const candidateId = await insertCandidate(runId, candidate, canonical, autoIngest)
      metrics.candidates_inserted++

      if (autoIngest) {
        const ingested = await autoIngestCandidate(candidateId, canonical)
        if (ingested) {
          metrics.candidates_auto_ingested++
          await pool.query(
            `UPDATE discovery_candidates SET status = 'ingested' WHERE candidate_id = $1`,
            [candidateId]
          )
        } else {
          // Auto-ingest failed — revert to pending so humans can review
          metrics.candidates_pending_review++
          await pool.query(
            `UPDATE discovery_candidates SET status = 'pending', auto_ingest = FALSE WHERE candidate_id = $1`,
            [candidateId]
          )
        }
      } else {
        metrics.candidates_pending_review++
      }
    }

  } catch (err) {
    metrics.error = err.message
    console.log(JSON.stringify({ stage: 'discovery_error', run_id: runId, error: err.message }))
  }

  metrics.total_run_duration_ms = Date.now() - startMs
  await finalizeRun(runId, metrics)

  console.log(JSON.stringify({ stage: 'discovery_complete', run_id: runId, ...metrics }))
}

// ── BullMQ worker ─────────────────────────────────────────────────────────────

export function startDiscoveryWorker() {
  const worker = new Worker('discovery', async (job) => {
    await runDiscovery()
  }, {
    connection: redis,
    concurrency: 1,
  })

  worker.on('failed', (job, err) => {
    console.log(JSON.stringify({ stage: 'discovery_worker_failed', error: err.message }))
  })

  return worker
}
