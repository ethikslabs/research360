// Provenance Engine v1.0
// Single source of truth for all provenance data written to or read from chunks.
// See brief-research360-provenance-LOCKED.md for design authority.

// ─────────────────────────────────────────────────────────────────────────────
// Source taxonomy — fixed enums, extensible by migration only
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SOURCE_TYPES = new Set(['file', 'web', 'api', 'audio'])

const VALID_SUBTYPES_BY_TYPE = {
  file:  new Set(['pdf', 'docx']),
  web:   new Set(['html', 'rss']),
  api:   new Set(['json_api', 'xml_api']),
  audio: new Set(['podcast', 'youtube']),
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer resolution
// Derives provenance source_type, source_subtype, and layer from document meta.
// source_tier is only relevant for url documents from the discovery agent.
// ─────────────────────────────────────────────────────────────────────────────

function resolveSourceClass(meta) {
  const { source_type: docType, file_type: fileType, source_tier, company_id, session_id } = meta

  // 1. Discovery-sourced URLs: tier determines layer
  if (docType === 'url' && source_tier != null) {
    let layer = 'L3'
    if (source_tier === 1) layer = 'L1'
    else if (source_tier === 2) layer = 'L2'
    return { source_type: 'web', source_subtype: 'html', layer }
  }

  // 2. Company-scoped or session-scoped → L2
  if (company_id || session_id) {
    const resolved = resolveTypeAndSubtype(docType, fileType)
    return { ...resolved, layer: 'L2' }
  }

  // 3. API sources → L5
  if (docType === 'api') {
    const subtype = fileType === 'xml_api' ? 'xml_api' : 'json_api'
    return { source_type: 'api', source_subtype: subtype, layer: 'L5' }
  }

  // 4. Direct uploads (document, youtube, audio, url without tier) → L1
  switch (docType) {
    case 'document':
      return { source_type: 'file', source_subtype: fileType === 'docx' ? 'docx' : 'pdf', layer: 'L1' }
    case 'url':
      return { source_type: 'web', source_subtype: 'html', layer: 'L3' }
    case 'youtube':
      return { source_type: 'audio', source_subtype: 'youtube', layer: 'L1' }
    case 'audio':
      return { source_type: 'audio', source_subtype: 'podcast', layer: 'L1' }
    default:
      return { source_type: 'file', source_subtype: fileType === 'docx' ? 'docx' : 'pdf', layer: 'L1' }
  }
}

// Helper: resolve provenance source_type and source_subtype from document meta
function resolveTypeAndSubtype(docType, fileType) {
  switch (docType) {
    case 'document':
      return { source_type: 'file', source_subtype: fileType === 'docx' ? 'docx' : 'pdf' }
    case 'url':
      return { source_type: 'web', source_subtype: 'html' }
    case 'youtube':
      return { source_type: 'audio', source_subtype: 'youtube' }
    case 'audio':
      return { source_type: 'audio', source_subtype: 'podcast' }
    case 'api': {
      const subtype = fileType === 'xml_api' ? 'xml_api' : 'json_api'
      return { source_type: 'api', source_subtype: subtype }
    }
    default:
      return { source_type: 'file', source_subtype: fileType === 'docx' ? 'docx' : 'pdf' }
  }
}

// Per-layer snapshot and freshness policy.
// L3/L5 ttl_hours are per-source defaults; callers may override via meta.ttl_hours.
const LAYER_POLICY = {
  L1: { snapshot_policy: 'static',            ttl_hours: null, stale_if_fetch_fails: false },
  L2: { snapshot_policy: 'refresh_on_request', ttl_hours: null, stale_if_fetch_fails: false },
  L3: { snapshot_policy: 'auto_refresh',       ttl_hours: 24,   stale_if_fetch_fails: true  },
  L5: { snapshot_policy: 'auto_refresh',       ttl_hours: null, stale_if_fetch_fails: true  },
}

// ─────────────────────────────────────────────────────────────────────────────
// buildProvenanceObject — canonical JSONB envelope
// ─────────────────────────────────────────────────────────────────────────────

export function buildProvenanceObject(meta) {
  const {
    source_url,
    canonical_uri,
    canonical_url,   // accepted for backwards compat with discovery agent payloads
    raw_snapshot_uri = null,
    title            = null,
    version          = null,
    extraction_confidence,
    extraction_method = 'pdf_parse',
    ingested_at,
    ingested_by       = 'ingestion-bot-v1',
    retrieved_at,
    ttl_hours,         // optional per-source override
    file_type,         // original file type from document meta
  } = meta

  const now = new Date().toISOString()
  const { source_type, source_subtype, layer } = resolveSourceClass(meta)
  const policy = LAYER_POLICY[layer]

  // PPTX handling: stored as file/pdf with conversion note (v1 — no pptx subtype yet)
  const extra_metadata = file_type === 'pptx' ? { converted_from: 'pptx' } : undefined

  const obj = {
    schema_version:  '1.0',
    source_type,
    source_subtype,
    layer,
    snapshot_policy: policy.snapshot_policy,
    extraction: {
      confidence:  extraction_confidence ?? 0.75,
      method:      extraction_method,
      ingested_at: ingested_at ?? now,
      ingested_by,
    },
    source: {
      uri:             source_url ?? null,
      canonical_uri:   canonical_uri ?? canonical_url ?? source_url ?? null,
      raw_snapshot_uri,
      title,
      retrieved_at:    retrieved_at ?? ingested_at ?? now,
      version,
      freshness_policy: {
        ttl_hours:            ttl_hours !== undefined ? ttl_hours : policy.ttl_hours,
        stale_if_fetch_fails: policy.stale_if_fetch_fails,
      },
    },
    status: {
      is_stale:               false,
      stale_since:            null,
      is_superseded:          false,
      superseded_at:          null,
      superseded_by_chunk_id: null,
    },
    reasoning: {
      run_id: null,
      usages: [],
    },
  }

  if (extra_metadata) obj.extra_metadata = extra_metadata

  return obj
}

// ─────────────────────────────────────────────────────────────────────────────
// buildChunkRow — single write codepath for JSONB envelope + indexed columns
// The ONLY function that produces provenance data for insertBatch.
// Never set the indexed columns independently.
// ─────────────────────────────────────────────────────────────────────────────

export function buildChunkRow(meta) {
  const provenance = buildProvenanceObject(meta)
  return {
    provenance,
    source_type:           provenance.source_type,
    source_subtype:        provenance.source_subtype,
    extraction_confidence: provenance.extraction.confidence,
    snapshot_policy:       provenance.snapshot_policy,
    is_stale:              provenance.status.is_stale,
    is_superseded:         provenance.status.is_superseded,
    source_retrieved_at:   provenance.source.retrieved_at,
    source_uri:            provenance.source.uri,
    canonical_uri:         provenance.source.canonical_uri,
    raw_snapshot_uri:      provenance.source.raw_snapshot_uri,
    ingested_by:           provenance.extraction.ingested_by,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// shapeByDepth — allowlist model for product response construction
// Built additively — never by stripping from the full internal object.
// chunk_id is a DB column returned by the query route, not stored in provenance.
// ─────────────────────────────────────────────────────────────────────────────

export function shapeByDepth(provenance, depth = 'summary') {
  if (!provenance) return null

  const extraction = provenance.extraction ?? {}
  const source     = provenance.source ?? {}
  const status     = provenance.status ?? {}

  // summary — minimum fields for product display (e.g. Proof360, Trust360 citations)
  const summary = {
    schema_version: provenance.schema_version,
    extraction: {
      confidence_band: mapConfidenceBand(extraction.confidence),
    },
    source: {
      title:        source.title        ?? null,
      uri:          source.uri          ?? null,
      retrieved_at: source.retrieved_at ?? null,
    },
    status: {
      is_stale:      status.is_stale      ?? false,
      is_superseded: status.is_superseded ?? false,
    },
  }

  if (depth === 'summary') return summary

  // internal — adds taxonomy, canonical URI, method, full status, snapshot policy
  const internal = {
    schema_version:  summary.schema_version,
    source_type:     provenance.source_type,
    source_subtype:  provenance.source_subtype,
    snapshot_policy: provenance.snapshot_policy,
    extraction: {
      confidence_band: summary.extraction.confidence_band,
      confidence:      extraction.confidence,
      method:          extraction.method,
      ingested_at:     extraction.ingested_at,
    },
    source: {
      title:            source.title            ?? null,
      uri:              source.uri              ?? null,
      retrieved_at:     source.retrieved_at     ?? null,
      canonical_uri:    source.canonical_uri    ?? null,
      version:          source.version          ?? null,
      freshness_policy: source.freshness_policy ?? null,
    },
    status: { ...status },
  }

  if (depth === 'internal') return internal

  // full_internal — adds layer, ingested_by, raw_snapshot_uri, reasoning
  return {
    ...internal,
    layer: provenance.layer,
    extraction: {
      ...internal.extraction,
      ingested_by: extraction.ingested_by,
    },
    source: {
      ...internal.source,
      raw_snapshot_uri: source.raw_snapshot_uri ?? null,
    },
    reasoning: provenance.reasoning ?? { run_id: null, usages: [] },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mapConfidenceBand — deterministic, defined once, applied identically by all products
// Boundary conditions: 0.90 → Strong, 0.70 → Moderate, below → Check original
// ─────────────────────────────────────────────────────────────────────────────

export function mapConfidenceBand(confidence) {
  if (confidence == null) return 'Check original'
  if (confidence >= 0.90)  return 'Strong'
  if (confidence >= 0.70)  return 'Moderate'
  return 'Check original'
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSourceTaxonomy — validates the final provenance source_type + source_subtype
// Operates on the provenance transport class values (file/web/api/audio),
// not the documents table source_type values (document/url/youtube).
// ─────────────────────────────────────────────────────────────────────────────

export { resolveSourceClass, LAYER_POLICY, VALID_SOURCE_TYPES, VALID_SUBTYPES_BY_TYPE }

export function validateSourceTaxonomy(sourceType, sourceSubtype) {
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    return {
      valid: false,
      error: `Invalid source_type "${sourceType}". Valid values: ${[...VALID_SOURCE_TYPES].join(', ')}`,
    }
  }
  const validSubtypes = VALID_SUBTYPES_BY_TYPE[sourceType]
  if (!validSubtypes.has(sourceSubtype)) {
    return {
      valid: false,
      error: `Invalid source_subtype "${sourceSubtype}" for source_type "${sourceType}". Valid values: ${[...validSubtypes].join(', ')}`,
    }
  }
  return { valid: true }
}
