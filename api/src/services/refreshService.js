// Refresh Service v1
//
// Handles source re-fetch, re-chunking, re-embedding, and supersession linkage.
//
// v1 lineage constraint: superseded_by_chunk_id and previous_chunk_id assume 1:1
// replacement. When a refresh produces multiple new chunks (fan-out), only the first
// old chunk → first new chunk link is written. A source-level lineage table will
// be introduced in a later iteration.

import { pool } from '../db/client.js'
import { chunk } from './chunkService.js'
import { embedTexts } from './embeddingService.js'
import { download, upload } from './s3Service.js'
import { markStale, markSuperseded } from '../db/queries/chunks.js'
import { insertEvent } from '../db/queries/trustRunEvents.js'
import { config } from '../config/env.js'

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function refresh({ tenantId, chunkIds, sourceUris, canonicalUris, reason, companyId, runId }) {
  const chunks = await findChunksForRefresh({ tenantId, chunkIds, sourceUris, canonicalUris })
  if (!chunks.length) return { refreshed: [], message: 'No matching chunks found' }

  // Group old chunks by source URI so each unique source is re-fetched once
  const bySource = groupBySource(chunks)

  const results = []
  for (const sourceChunks of Object.values(bySource)) {
    const outcome = await refreshSource(sourceChunks, { tenantId, reason, companyId, runId })
    results.push(...outcome)
  }

  return { refreshed: results }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope validation
// ─────────────────────────────────────────────────────────────────────────────

function validateScope(chunk, { companyId }) {
  const layer = chunk.provenance?.layer
  if (layer === 'L2' && !companyId) {
    return { valid: false, reason: `L2 chunk ${chunk.id} requires companyId for refresh` }
  }
  if ((layer === 'L3' || layer === 'L5') && !chunk.source_uri && !chunk.canonical_uri) {
    return { valid: false, reason: `L3/L5 chunk ${chunk.id} requires a source URI for refresh` }
  }
  if (layer === 'L1' && !chunk.raw_snapshot_uri) {
    return { valid: false, reason: `L1 chunk ${chunk.id} requires a raw snapshot to refresh — re-submit the file to re-ingest` }
  }
  return { valid: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core refresh — one unique source at a time
// ─────────────────────────────────────────────────────────────────────────────

async function refreshSource(sourceChunks, { tenantId, reason, companyId, runId }) {
  const representative = sourceChunks[0]
  const oldChunkIds = sourceChunks.map(c => c.id)
  const layer = representative.provenance?.layer
  const staleIfFetchFails = representative.provenance?.source?.freshness_policy?.stale_if_fetch_fails ?? false

  const scopeCheck = validateScope(representative, { companyId })
  if (!scopeCheck.valid) {
    return oldChunkIds.map(id => ({ old_chunk_id: id, status: 'skipped', reason: scopeCheck.reason }))
  }

  let fetchResult
  try {
    fetchResult = await refetchContent(representative, tenantId)
  } catch (err) {
    // Re-fetch failed
    if (staleIfFetchFails) await markStale(oldChunkIds)
    if (runId) {
      await insertEvent({
        run_id: runId,
        event_type: 'refresh_triggered',
        payload: { old_chunk_ids: oldChunkIds, reason, error: err.message },
      })
    }
    return oldChunkIds.map(id => ({ old_chunk_id: id, status: 'fetch_failed', error: err.message }))
  }

  const { text, extraction_confidence, extraction_method, retrievedAt } = fetchResult

  // Re-chunk and re-embed
  const newChunks = chunk(text)
  if (!newChunks.length) {
    return oldChunkIds.map(id => ({ old_chunk_id: id, status: 'skipped', reason: 'No content after re-chunk' }))
  }

  const embeddings = await embedTexts(newChunks.map(c => c.chunk_text))

  // Upload new snapshot (L3/L5 only — L1 retains existing snapshot)
  let newRawSnapshotUri = representative.raw_snapshot_uri
  if (layer === 'L3' || layer === 'L5') {
    const snapshotKey = await upload(tenantId, representative.document_id, 'snapshot', Buffer.from(text), 'text/plain')
    newRawSnapshotUri = `s3://${config.S3_BUCKET}/${snapshotKey}`
  }

  // Build provenance rows for new chunks
  const provenanceRow = buildRefreshedChunkRow(representative.provenance, {
    retrievedAt,
    newRawSnapshotUri,
    extraction_confidence,
    extraction_method,
  })

  const rows = newChunks.map((c, i) => ({
    tenantId,
    documentId:   representative.document_id,
    chunkIndex:   c.chunk_index,
    chunkText:    c.chunk_text,
    chunkHash:    c.chunk_hash,
    tokenCount:   c.token_count,
    embedding:    embeddings[i],
    ...provenanceRow,
  }))

  const inserted = await insertRefreshedChunks(rows)

  if (!inserted.length) {
    // All hashes matched existing chunks — content unchanged
    return oldChunkIds.map(id => ({ old_chunk_id: id, status: 'unchanged' }))
  }

  // v1 lineage: link first old chunk → first new chunk only
  if (inserted.length > 1) {
    console.warn(JSON.stringify({ stage: 'refresh', warning: V1_LINEAGE_WARNING, old_count: oldChunkIds.length, new_count: inserted.length }))
  }
  const firstNewChunkId = inserted[0].id
  // v1: all old chunks superseded by first new chunk
  for (const oldId of oldChunkIds) {
    await markSuperseded(oldId, firstNewChunkId)
  }

  if (runId) {
    await insertEvent({
      run_id: runId,
      event_type: 'refresh_completed',
      payload: {
        old_chunk_ids:  oldChunkIds,
        new_chunk_id:   firstNewChunkId,
        source_uri:     representative.source_uri,
        reason,
      },
    })
  }

  return oldChunkIds.map((id, i) => ({
    old_chunk_id: id,
    new_chunk_id: i === 0 ? firstNewChunkId : null, // v1: only first chunk linked
    status: 'refreshed',
    provenance: provenanceRow.provenance,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-fetch content from source
// ─────────────────────────────────────────────────────────────────────────────

async function refetchContent(chunk, tenantId) {
  const layer = chunk.provenance?.layer
  const retrievedAt = new Date().toISOString()

  if (layer === 'L1') {
    // Static document — re-process from existing extracted text (not raw PDF binary).
    // New file submission is handled by the ingest route, not the refresh endpoint.
    const uri = chunk.raw_snapshot_uri // s3://bucket/tenantId/documentId/original
    const key = uri.replace(`s3://${config.S3_BUCKET}/`, '')
    const parts = key.split('/')
    const docTenantId = parts[0]
    const documentId  = parts[1]
    const buffer = await download(docTenantId, documentId, 'extracted')
    return {
      text: buffer.toString('utf8'),
      extraction_confidence: chunk.provenance?.extraction?.confidence ?? 0.90,
      extraction_method:     chunk.provenance?.extraction?.method ?? 'unstructured_io',
      retrievedAt,
    }
  }

  // L3/L5 — re-fetch from URI
  const uri = chunk.canonical_uri || chunk.source_uri
  const response = await fetch(uri, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'research360-refresh/1.0' },
  })
  if (!response.ok) throw new Error(`Re-fetch failed: HTTP ${response.status} ${response.statusText}`)

  const text = await response.text()
  return { text, extraction_confidence: 0.80, extraction_method: 'playwright', retrievedAt }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance rebuilder — copies existing envelope, updates refresh-specific fields.
// Does not go through buildChunkRow/resolveSourceClass since layer is already known.
// ─────────────────────────────────────────────────────────────────────────────

function buildRefreshedChunkRow(existingProvenance, { retrievedAt, newRawSnapshotUri, extraction_confidence, extraction_method }) {
  const prov = {
    ...existingProvenance,
    extraction: {
      ...existingProvenance.extraction,
      confidence:  extraction_confidence,
      method:      extraction_method,
      ingested_at: new Date().toISOString(),
    },
    source: {
      ...existingProvenance.source,
      retrieved_at:     retrievedAt,
      raw_snapshot_uri: newRawSnapshotUri ?? existingProvenance.source?.raw_snapshot_uri ?? null,
    },
    status: {
      is_stale:               false,
      stale_since:            null,
      is_superseded:          false,
      superseded_at:          null,
      superseded_by_chunk_id: null,
    },
    reasoning: { run_id: null, usages: [] },
  }

  return {
    provenance:            prov,
    source_type:           prov.source_type,
    source_subtype:        prov.source_subtype,
    extraction_confidence: prov.extraction.confidence,
    snapshot_policy:       prov.snapshot_policy,
    is_stale:              false,
    is_superseded:         false,
    source_retrieved_at:   prov.source.retrieved_at,
    source_uri:            prov.source.uri,
    canonical_uri:         prov.source.canonical_uri,
    raw_snapshot_uri:      prov.source.raw_snapshot_uri,
    ingested_by:           prov.extraction.ingested_by,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert refreshed chunks with embeddings, return inserted IDs.
// Uses RETURNING — ON CONFLICT DO NOTHING rows are not returned (unchanged content).
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_COLS = 19 // insertBatch columns + embedding

async function insertRefreshedChunks(chunks) {
  if (!chunks.length) return []

  const values = chunks.map((_, i) => {
    const b = i * REFRESH_COLS
    return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6},` +
           ` $${b+7}::jsonb, $${b+8}, $${b+9}, $${b+10}, $${b+11}, $${b+12},` +
           ` $${b+13}, $${b+14}, $${b+15}, $${b+16}, $${b+17}, $${b+18}, $${b+19}::vector)`
  }).join(', ')

  const params = chunks.flatMap(c => [
    c.tenantId,
    c.documentId,
    c.chunkIndex,
    c.chunkText,
    c.chunkHash,
    c.tokenCount          ?? null,
    JSON.stringify(c.provenance ?? {}),
    c.source_type         ?? null,
    c.source_subtype      ?? null,
    c.extraction_confidence ?? null,
    c.ingested_by         ?? null,
    c.source_retrieved_at ?? null,
    c.source_uri          ?? null,
    c.canonical_uri       ?? null,
    c.raw_snapshot_uri    ?? null,
    c.snapshot_policy     ?? 'static',
    c.is_stale            ?? false,
    c.is_superseded       ?? false,
    c.embedding ? `[${c.embedding.join(',')}]` : null,
  ])

  const res = await pool.query(
    `INSERT INTO chunks (
       tenant_id, document_id, chunk_index, chunk_text, chunk_hash, token_count,
       provenance, source_type, source_subtype, extraction_confidence, ingested_by,
       source_retrieved_at, source_uri, canonical_url, raw_snapshot_uri,
       snapshot_policy, is_stale, is_superseded, embedding
     )
     VALUES ${values}
     ON CONFLICT (chunk_hash) DO NOTHING
     RETURNING id, chunk_hash`,
    params
  )
  return res.rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function findChunksForRefresh({ tenantId, chunkIds, sourceUris, canonicalUris }) {
  const conditions = ['c.tenant_id = $1']
  const params = [tenantId]
  let i = 2

  const orConditions = []
  if (chunkIds?.length) {
    orConditions.push(`c.id = ANY($${i++}::uuid[])`)
    params.push(chunkIds)
  }
  if (sourceUris?.length) {
    orConditions.push(`c.source_uri = ANY($${i++}::text[])`)
    params.push(sourceUris)
  }
  if (canonicalUris?.length) {
    orConditions.push(`c.canonical_url = ANY($${i++}::text[])`)
    params.push(canonicalUris)
  }

  if (!orConditions.length) return []
  conditions.push(`(${orConditions.join(' OR ')})`)

  const res = await pool.query(
    `SELECT id, document_id, chunk_text, chunk_hash, token_count,
            provenance, source_uri, canonical_url AS canonical_uri, raw_snapshot_uri,
            snapshot_policy, is_superseded
     FROM chunks c
     WHERE ${conditions.join(' AND ')}`,
    params
  )
  return res.rows
}

function groupBySource(chunks) {
  const groups = {}
  for (const c of chunks) {
    const key = c.canonical_uri || c.source_uri || c.id
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  }
  return groups
}

const V1_LINEAGE_WARNING = 'refresh produced multiple new chunks — v1 only links first chunk in supersession chain; source-level lineage table will be added in a later iteration'
