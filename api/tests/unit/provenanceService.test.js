import { describe, it, expect } from 'vitest'
import {
  buildProvenanceObject,
  buildChunkRow,
  resolveSourceClass,
  LAYER_POLICY,
  mapConfidenceBand,
  validateSourceTaxonomy,
  shapeByDepth,
} from '../../src/services/provenanceService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.1: Verify buildProvenanceObject, buildChunkRow, resolveSourceClass
// Requirements: 2.1–2.10, 4.1–4.5, 7.1
// ─────────────────────────────────────────────────────────────────────────────

describe('buildProvenanceObject', () => {
  const baseMeta = {
    source_type: 'document',
    file_type: 'pdf',
    source_url: 'https://example.com/doc.pdf',
    extraction_confidence: 0.95,
    extraction_method: 'unstructured_io',
    ingested_at: '2026-03-14T09:43:00Z',
    retrieved_at: '2026-03-14T09:41:22Z',
    title: 'SOC 2 Type II',
    raw_snapshot_uri: 's3://bucket/snapshot',
  }

  it('produces schema_version "1.0"', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.schema_version).toBe('1.0')
  })

  it('produces correct extraction block', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.extraction.confidence).toBe(0.95)
    expect(prov.extraction.method).toBe('unstructured_io')
    expect(prov.extraction.ingested_at).toBe('2026-03-14T09:43:00Z')
    expect(prov.extraction.ingested_by).toBe('ingestion-bot-v1')
  })

  it('produces correct source block', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.source.uri).toBe('https://example.com/doc.pdf')
    expect(prov.source.title).toBe('SOC 2 Type II')
    expect(prov.source.retrieved_at).toBe('2026-03-14T09:41:22Z')
    expect(prov.source.raw_snapshot_uri).toBe('s3://bucket/snapshot')
  })

  it('always sets reasoning to { run_id: null, usages: [] }', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.reasoning).toEqual({ run_id: null, usages: [] })
    expect(Array.isArray(prov.reasoning.usages)).toBe(true)
  })

  it('always sets status to initial state at construction', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.status).toEqual({
      is_stale: false,
      stale_since: null,
      is_superseded: false,
      superseded_at: null,
      superseded_by_chunk_id: null,
    })
  })

  it('defaults extraction_confidence to 0.75 when not provided', () => {
    const meta = { ...baseMeta, extraction_confidence: undefined }
    const prov = buildProvenanceObject(meta)
    expect(prov.extraction.confidence).toBe(0.75)
  })

  it('defaults extraction_method to pdf_parse when not provided', () => {
    const meta = { ...baseMeta, extraction_method: undefined }
    const prov = buildProvenanceObject(meta)
    expect(prov.extraction.method).toBe('pdf_parse')
  })

  it('accepts canonical_url for backwards compat with discovery agent', () => {
    const meta = { ...baseMeta, canonical_uri: undefined, canonical_url: 'https://canonical.example.com' }
    const prov = buildProvenanceObject(meta)
    expect(prov.source.canonical_uri).toBe('https://canonical.example.com')
  })

  it('prefers canonical_uri over canonical_url', () => {
    const meta = { ...baseMeta, canonical_uri: 'https://uri.example.com', canonical_url: 'https://url.example.com' }
    const prov = buildProvenanceObject(meta)
    expect(prov.source.canonical_uri).toBe('https://uri.example.com')
  })

  it('adds extra_metadata.converted_from for PPTX files', () => {
    const meta = { ...baseMeta, file_type: 'pptx' }
    const prov = buildProvenanceObject(meta)
    expect(prov.extra_metadata).toEqual({ converted_from: 'pptx' })
    // PPTX stored as file/pdf
    expect(prov.source_type).toBe('file')
    expect(prov.source_subtype).toBe('pdf')
  })

  it('does not add extra_metadata for non-PPTX files', () => {
    const prov = buildProvenanceObject(baseMeta)
    expect(prov.extra_metadata).toBeUndefined()
  })

  it('respects per-source ttl_hours override', () => {
    const meta = { ...baseMeta, source_type: 'url', source_tier: 3, ttl_hours: 48 }
    const prov = buildProvenanceObject(meta)
    expect(prov.source.freshness_policy.ttl_hours).toBe(48)
  })

  it('uses layer default ttl_hours when not overridden', () => {
    const meta = { ...baseMeta, source_type: 'url', source_tier: 3 }
    const prov = buildProvenanceObject(meta)
    expect(prov.source.freshness_policy.ttl_hours).toBe(24) // L3 default
  })
})

describe('buildChunkRow — single codepath drift prevention', () => {
  const baseMeta = {
    source_type: 'document',
    file_type: 'pdf',
    source_url: 'https://example.com/doc.pdf',
    extraction_confidence: 0.92,
    extraction_method: 'unstructured_io',
    ingested_at: '2026-03-14T09:43:00Z',
    retrieved_at: '2026-03-14T09:41:22Z',
    raw_snapshot_uri: 's3://bucket/snapshot',
  }

  it('derives all indexed columns from the canonical JSONB', () => {
    const row = buildChunkRow(baseMeta)
    const prov = row.provenance

    expect(row.source_type).toBe(prov.source_type)
    expect(row.source_subtype).toBe(prov.source_subtype)
    expect(row.extraction_confidence).toBe(prov.extraction.confidence)
    expect(row.snapshot_policy).toBe(prov.snapshot_policy)
    expect(row.is_stale).toBe(prov.status.is_stale)
    expect(row.is_superseded).toBe(prov.status.is_superseded)
    expect(row.source_retrieved_at).toBe(prov.source.retrieved_at)
    expect(row.source_uri).toBe(prov.source.uri)
    expect(row.canonical_uri).toBe(prov.source.canonical_uri)
    expect(row.raw_snapshot_uri).toBe(prov.source.raw_snapshot_uri)
    expect(row.ingested_by).toBe(prov.extraction.ingested_by)
  })

  it('includes the provenance JSONB object itself', () => {
    const row = buildChunkRow(baseMeta)
    expect(row.provenance).toBeDefined()
    expect(row.provenance.schema_version).toBe('1.0')
  })
})

describe('resolveSourceClass — taxonomy mapping', () => {
  it('maps document → file/pdf, L1', () => {
    const result = resolveSourceClass({ source_type: 'document', file_type: 'pdf' })
    expect(result).toEqual({ source_type: 'file', source_subtype: 'pdf', layer: 'L1' })
  })

  it('maps document/docx → file/docx, L1', () => {
    const result = resolveSourceClass({ source_type: 'document', file_type: 'docx' })
    expect(result).toEqual({ source_type: 'file', source_subtype: 'docx', layer: 'L1' })
  })

  it('maps url → web/html, L3 (no tier)', () => {
    const result = resolveSourceClass({ source_type: 'url' })
    expect(result).toEqual({ source_type: 'web', source_subtype: 'html', layer: 'L3' })
  })

  it('maps youtube → audio/youtube, L1', () => {
    const result = resolveSourceClass({ source_type: 'youtube' })
    expect(result).toEqual({ source_type: 'audio', source_subtype: 'youtube', layer: 'L1' })
  })

  it('maps api → api/json_api, L5', () => {
    const result = resolveSourceClass({ source_type: 'api' })
    expect(result).toEqual({ source_type: 'api', source_subtype: 'json_api', layer: 'L5' })
  })

  it('maps api/xml_api → api/xml_api, L5', () => {
    const result = resolveSourceClass({ source_type: 'api', file_type: 'xml_api' })
    expect(result).toEqual({ source_type: 'api', source_subtype: 'xml_api', layer: 'L5' })
  })
})

describe('resolveSourceClass — layer assignment', () => {
  it('L1 for direct document uploads', () => {
    const result = resolveSourceClass({ source_type: 'document', file_type: 'pdf' })
    expect(result.layer).toBe('L1')
  })

  it('L2 for company-scoped documents', () => {
    const result = resolveSourceClass({ source_type: 'document', file_type: 'pdf', company_id: 'acme' })
    expect(result.layer).toBe('L2')
  })

  it('L2 for session-scoped documents', () => {
    const result = resolveSourceClass({ source_type: 'document', file_type: 'pdf', session_id: 'sess-123' })
    expect(result.layer).toBe('L2')
  })

  it('L3 for web/discovery tier 3', () => {
    const result = resolveSourceClass({ source_type: 'url', source_tier: 3 })
    expect(result.layer).toBe('L3')
  })

  it('L5 for API sources', () => {
    const result = resolveSourceClass({ source_type: 'api' })
    expect(result.layer).toBe('L5')
  })

  it('discovery tier 1 → L1', () => {
    const result = resolveSourceClass({ source_type: 'url', source_tier: 1 })
    expect(result.layer).toBe('L1')
  })

  it('discovery tier 2 → L2', () => {
    const result = resolveSourceClass({ source_type: 'url', source_tier: 2 })
    expect(result.layer).toBe('L2')
  })

  it('youtube direct upload → L1', () => {
    const result = resolveSourceClass({ source_type: 'youtube' })
    expect(result.layer).toBe('L1')
  })

  it('audio (podcast) direct upload → L1', () => {
    const result = resolveSourceClass({ source_type: 'audio' })
    expect(result.layer).toBe('L1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.3: Verify validateSourceTaxonomy
// Requirements: 3.1, 3.2, 3.3
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSourceTaxonomy — valid pairs', () => {
  const validPairs = [
    ['file', 'pdf'],
    ['file', 'docx'],
    ['web', 'html'],
    ['web', 'rss'],
    ['api', 'json_api'],
    ['api', 'xml_api'],
    ['audio', 'podcast'],
    ['audio', 'youtube'],
  ]

  it.each(validPairs)('returns { valid: true } for (%s, %s)', (type, subtype) => {
    const result = validateSourceTaxonomy(type, subtype)
    expect(result).toEqual({ valid: true })
  })
})

describe('validateSourceTaxonomy — invalid source_type', () => {
  it('rejects unknown source_type with error message', () => {
    const result = validateSourceTaxonomy('video', 'mp4')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid source_type')
    expect(result.error).toContain('video')
  })

  it('rejects empty string source_type', () => {
    const result = validateSourceTaxonomy('', 'pdf')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid source_type')
  })
})

describe('validateSourceTaxonomy — valid source_type but invalid subtype', () => {
  it('rejects mismatched subtype for file (html is web, not file)', () => {
    const result = validateSourceTaxonomy('file', 'html')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid source_subtype')
    expect(result.error).toContain('html')
  })

  it('rejects mismatched subtype for web (pdf is file, not web)', () => {
    const result = validateSourceTaxonomy('web', 'pdf')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid source_subtype')
  })

  it('rejects unknown subtype for a valid source_type', () => {
    const result = validateSourceTaxonomy('audio', 'mp3')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid source_subtype')
    expect(result.error).toContain('mp3')
  })
})

describe('layer-to-policy mapping', () => {
  it('L1 → static, null TTL, stale_if_fetch_fails false', () => {
    const meta = { source_type: 'document', file_type: 'pdf' }
    const prov = buildProvenanceObject(meta)
    expect(prov.snapshot_policy).toBe('static')
    expect(prov.source.freshness_policy.ttl_hours).toBeNull()
    expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(false)
  })

  it('L2 → refresh_on_request', () => {
    const meta = { source_type: 'document', file_type: 'pdf', company_id: 'acme' }
    const prov = buildProvenanceObject(meta)
    expect(prov.snapshot_policy).toBe('refresh_on_request')
  })

  it('L3 → auto_refresh, stale_if_fetch_fails true', () => {
    const meta = { source_type: 'url', source_tier: 3 }
    const prov = buildProvenanceObject(meta)
    expect(prov.snapshot_policy).toBe('auto_refresh')
    expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(true)
  })

  it('L5 → auto_refresh, stale_if_fetch_fails true', () => {
    const meta = { source_type: 'api' }
    const prov = buildProvenanceObject(meta)
    expect(prov.snapshot_policy).toBe('auto_refresh')
    expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.5: Verify shapeByDepth allowlist response shaping
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
// ─────────────────────────────────────────────────────────────────────────────

// Full provenance object as produced by buildProvenanceObject — used as input to shapeByDepth
const fullProvenance = {
  schema_version: '1.0',
  source_type: 'file',
  source_subtype: 'pdf',
  layer: 'L1',
  snapshot_policy: 'static',
  extraction: {
    confidence: 0.95,
    method: 'unstructured_io',
    ingested_at: '2026-03-14T09:43:00Z',
    ingested_by: 'ingestion-bot-v1',
  },
  source: {
    uri: 'https://example.com/doc.pdf',
    canonical_uri: 'https://example.com/canonical/doc.pdf',
    raw_snapshot_uri: 's3://bucket/snapshots/doc',
    title: 'SOC 2 Type II',
    retrieved_at: '2026-03-14T09:41:22Z',
    version: '2.1',
    freshness_policy: {
      ttl_hours: null,
      stale_if_fetch_fails: false,
    },
  },
  status: {
    is_stale: false,
    stale_since: null,
    is_superseded: false,
    superseded_at: null,
    superseded_by_chunk_id: null,
  },
  reasoning: {
    run_id: 'run-abc-123',
    usages: [
      { step: 'gap_analysis', step_index: 0, confidence: 0.88, used_at: '2026-03-14T10:00:00Z' },
    ],
  },
}

describe('shapeByDepth — summary depth (Req 9.1)', () => {
  const shaped = shapeByDepth(fullProvenance, 'summary')

  it('returns schema_version', () => {
    expect(shaped.schema_version).toBe('1.0')
  })

  it('returns source.title, source.uri, source.retrieved_at', () => {
    expect(shaped.source.title).toBe('SOC 2 Type II')
    expect(shaped.source.uri).toBe('https://example.com/doc.pdf')
    expect(shaped.source.retrieved_at).toBe('2026-03-14T09:41:22Z')
  })

  it('returns extraction.confidence_band mapped from confidence', () => {
    expect(shaped.extraction.confidence_band).toBe('Strong') // 0.95 >= 0.90
  })

  it('returns status.is_stale and status.is_superseded', () => {
    expect(shaped.status.is_stale).toBe(false)
    expect(shaped.status.is_superseded).toBe(false)
  })

  it('does NOT contain source.canonical_uri', () => {
    expect(shaped.source.canonical_uri).toBeUndefined()
  })

  it('does NOT contain source.version', () => {
    expect(shaped.source.version).toBeUndefined()
  })

  it('does NOT contain source.freshness_policy', () => {
    expect(shaped.source.freshness_policy).toBeUndefined()
  })

  it('does NOT contain source.raw_snapshot_uri', () => {
    expect(shaped.source.raw_snapshot_uri).toBeUndefined()
  })

  it('does NOT contain layer (Req 9.5)', () => {
    expect(shaped.layer).toBeUndefined()
  })

  it('does NOT contain extraction.confidence (raw numeric)', () => {
    expect(shaped.extraction.confidence).toBeUndefined()
  })

  it('does NOT contain extraction.method', () => {
    expect(shaped.extraction.method).toBeUndefined()
  })

  it('does NOT contain extraction.ingested_at', () => {
    expect(shaped.extraction.ingested_at).toBeUndefined()
  })

  it('does NOT contain extraction.ingested_by', () => {
    expect(shaped.extraction.ingested_by).toBeUndefined()
  })

  it('does NOT contain reasoning', () => {
    expect(shaped.reasoning).toBeUndefined()
  })

  it('does NOT contain source_type', () => {
    expect(shaped.source_type).toBeUndefined()
  })

  it('does NOT contain source_subtype', () => {
    expect(shaped.source_subtype).toBeUndefined()
  })

  it('does NOT contain snapshot_policy', () => {
    expect(shaped.snapshot_policy).toBeUndefined()
  })

  it('does NOT contain chunk_id (never in provenance JSONB)', () => {
    expect(shaped.chunk_id).toBeUndefined()
  })

  it('status only has is_stale and is_superseded (not full status)', () => {
    expect(Object.keys(shaped.status).sort()).toEqual(['is_stale', 'is_superseded'])
  })
})

describe('shapeByDepth — internal depth (Req 9.2)', () => {
  const shaped = shapeByDepth(fullProvenance, 'internal')

  // All summary fields present
  it('includes schema_version', () => {
    expect(shaped.schema_version).toBe('1.0')
  })

  it('includes source.title, source.uri, source.retrieved_at from summary', () => {
    expect(shaped.source.title).toBe('SOC 2 Type II')
    expect(shaped.source.uri).toBe('https://example.com/doc.pdf')
    expect(shaped.source.retrieved_at).toBe('2026-03-14T09:41:22Z')
  })

  it('includes extraction.confidence_band from summary', () => {
    expect(shaped.extraction.confidence_band).toBe('Strong')
  })

  // Additional internal fields
  it('adds source_type', () => {
    expect(shaped.source_type).toBe('file')
  })

  it('adds source_subtype', () => {
    expect(shaped.source_subtype).toBe('pdf')
  })

  it('adds snapshot_policy', () => {
    expect(shaped.snapshot_policy).toBe('static')
  })

  it('adds extraction.confidence (raw numeric)', () => {
    expect(shaped.extraction.confidence).toBe(0.95)
  })

  it('adds extraction.method', () => {
    expect(shaped.extraction.method).toBe('unstructured_io')
  })

  it('adds extraction.ingested_at', () => {
    expect(shaped.extraction.ingested_at).toBe('2026-03-14T09:43:00Z')
  })

  it('adds source.canonical_uri', () => {
    expect(shaped.source.canonical_uri).toBe('https://example.com/canonical/doc.pdf')
  })

  it('adds source.version', () => {
    expect(shaped.source.version).toBe('2.1')
  })

  it('adds source.freshness_policy', () => {
    expect(shaped.source.freshness_policy).toEqual({
      ttl_hours: null,
      stale_if_fetch_fails: false,
    })
  })

  it('includes full status object', () => {
    expect(shaped.status).toEqual({
      is_stale: false,
      stale_since: null,
      is_superseded: false,
      superseded_at: null,
      superseded_by_chunk_id: null,
    })
  })

  // Fields that should NOT be present at internal depth
  it('does NOT contain layer (Req 9.5)', () => {
    expect(shaped.layer).toBeUndefined()
  })

  it('does NOT contain extraction.ingested_by', () => {
    expect(shaped.extraction.ingested_by).toBeUndefined()
  })

  it('does NOT contain source.raw_snapshot_uri', () => {
    expect(shaped.source.raw_snapshot_uri).toBeUndefined()
  })

  it('does NOT contain reasoning', () => {
    expect(shaped.reasoning).toBeUndefined()
  })

  it('does NOT contain chunk_id', () => {
    expect(shaped.chunk_id).toBeUndefined()
  })
})

describe('shapeByDepth — full_internal depth (Req 9.3)', () => {
  const shaped = shapeByDepth(fullProvenance, 'full_internal')

  // All internal fields present
  it('includes schema_version', () => {
    expect(shaped.schema_version).toBe('1.0')
  })

  it('includes source_type and source_subtype', () => {
    expect(shaped.source_type).toBe('file')
    expect(shaped.source_subtype).toBe('pdf')
  })

  it('includes snapshot_policy', () => {
    expect(shaped.snapshot_policy).toBe('static')
  })

  it('includes extraction.confidence_band and extraction.confidence', () => {
    expect(shaped.extraction.confidence_band).toBe('Strong')
    expect(shaped.extraction.confidence).toBe(0.95)
  })

  it('includes extraction.method and extraction.ingested_at', () => {
    expect(shaped.extraction.method).toBe('unstructured_io')
    expect(shaped.extraction.ingested_at).toBe('2026-03-14T09:43:00Z')
  })

  it('includes source.canonical_uri, source.version, source.freshness_policy', () => {
    expect(shaped.source.canonical_uri).toBe('https://example.com/canonical/doc.pdf')
    expect(shaped.source.version).toBe('2.1')
    expect(shaped.source.freshness_policy).toEqual({
      ttl_hours: null,
      stale_if_fetch_fails: false,
    })
  })

  it('includes full status', () => {
    expect(shaped.status).toEqual({
      is_stale: false,
      stale_since: null,
      is_superseded: false,
      superseded_at: null,
      superseded_by_chunk_id: null,
    })
  })

  // Additional full_internal fields
  it('adds layer', () => {
    expect(shaped.layer).toBe('L1')
  })

  it('adds extraction.ingested_by', () => {
    expect(shaped.extraction.ingested_by).toBe('ingestion-bot-v1')
  })

  it('adds source.raw_snapshot_uri', () => {
    expect(shaped.source.raw_snapshot_uri).toBe('s3://bucket/snapshots/doc')
  })

  it('adds reasoning with run_id and usages', () => {
    expect(shaped.reasoning.run_id).toBe('run-abc-123')
    expect(shaped.reasoning.usages).toHaveLength(1)
    expect(shaped.reasoning.usages[0].step).toBe('gap_analysis')
  })

  // chunk_id is NOT in provenance JSONB — added by query route
  it('does NOT contain chunk_id (added by query route, not provenance)', () => {
    expect(shaped.chunk_id).toBeUndefined()
  })
})

describe('shapeByDepth — additive construction (Req 9.4)', () => {
  it('summary is built from allowlist, not by stripping from full object', () => {
    const shaped = shapeByDepth(fullProvenance, 'summary')
    // Verify the exact set of top-level keys — no extra fields leaked
    const topKeys = Object.keys(shaped).sort()
    expect(topKeys).toEqual(['extraction', 'schema_version', 'source', 'status'])
  })

  it('internal is built from allowlist, not by stripping from full object', () => {
    const shaped = shapeByDepth(fullProvenance, 'internal')
    const topKeys = Object.keys(shaped).sort()
    expect(topKeys).toEqual([
      'extraction', 'schema_version', 'snapshot_policy',
      'source', 'source_subtype', 'source_type', 'status',
    ])
  })

  it('full_internal includes all internal keys plus layer and reasoning', () => {
    const shaped = shapeByDepth(fullProvenance, 'full_internal')
    const topKeys = Object.keys(shaped).sort()
    expect(topKeys).toEqual([
      'extraction', 'layer', 'reasoning', 'schema_version',
      'snapshot_policy', 'source', 'source_subtype', 'source_type', 'status',
    ])
  })
})

describe('shapeByDepth — edge cases', () => {
  it('returns null for null provenance input', () => {
    expect(shapeByDepth(null, 'summary')).toBeNull()
  })

  it('returns null for undefined provenance input', () => {
    expect(shapeByDepth(undefined, 'summary')).toBeNull()
  })

  it('defaults to summary when depth is not provided', () => {
    const shaped = shapeByDepth(fullProvenance)
    // Should have summary shape — no layer, no reasoning
    expect(shaped.layer).toBeUndefined()
    expect(shaped.reasoning).toBeUndefined()
    expect(shaped.extraction.confidence_band).toBeDefined()
  })

  it('handles provenance with missing optional fields gracefully', () => {
    const sparse = {
      schema_version: '1.0',
      source_type: 'web',
      source_subtype: 'html',
      layer: 'L3',
      snapshot_policy: 'auto_refresh',
      extraction: { confidence: 0.80 },
      source: {},
      status: {},
      reasoning: { run_id: null, usages: [] },
    }
    const shaped = shapeByDepth(sparse, 'summary')
    expect(shaped.source.title).toBeNull()
    expect(shaped.source.uri).toBeNull()
    expect(shaped.source.retrieved_at).toBeNull()
    expect(shaped.status.is_stale).toBe(false)
    expect(shaped.status.is_superseded).toBe(false)
  })

  it('maps confidence to band correctly at summary depth', () => {
    const withLowConf = { ...fullProvenance, extraction: { ...fullProvenance.extraction, confidence: 0.55 } }
    const shaped = shapeByDepth(withLowConf, 'summary')
    expect(shaped.extraction.confidence_band).toBe('Check original')
  })

  it('full_internal defaults reasoning when missing from provenance', () => {
    const noReasoning = { ...fullProvenance, reasoning: undefined }
    const shaped = shapeByDepth(noReasoning, 'full_internal')
    expect(shaped.reasoning).toEqual({ run_id: null, usages: [] })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 10.1: Edge cases for provenance construction
// Requirements: 2.5, 2.10, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3
// ─────────────────────────────────────────────────────────────────────────────

describe('mapConfidenceBand — boundary values (Req 10.1, 10.2, 10.3)', () => {
  it('exactly 0.90 → Strong', () => {
    expect(mapConfidenceBand(0.90)).toBe('Strong')
  })

  it('just below 0.90 → Moderate', () => {
    expect(mapConfidenceBand(0.8999)).toBe('Moderate')
  })

  it('exactly 0.70 → Moderate', () => {
    expect(mapConfidenceBand(0.70)).toBe('Moderate')
  })

  it('just below 0.70 → Check original', () => {
    expect(mapConfidenceBand(0.6999)).toBe('Check original')
  })

  it('null → Check original', () => {
    expect(mapConfidenceBand(null)).toBe('Check original')
  })

  it('undefined → Check original', () => {
    expect(mapConfidenceBand(undefined)).toBe('Check original')
  })

  it('0 → Check original', () => {
    expect(mapConfidenceBand(0)).toBe('Check original')
  })

  it('1.0 → Strong', () => {
    expect(mapConfidenceBand(1.0)).toBe('Strong')
  })
})

describe('buildProvenanceObject — L2 source with no file (Req 2.10)', () => {
  it('L2 company-scoped source with no raw_snapshot_uri defaults to null', () => {
    const meta = {
      source_type: 'document',
      file_type: 'pdf',
      company_id: 'acme',
      source_url: 'https://example.com/report.pdf',
      extraction_confidence: 0.85,
      extraction_method: 'unstructured_io',
      ingested_at: '2026-03-14T09:43:00Z',
      retrieved_at: '2026-03-14T09:41:22Z',
      // raw_snapshot_uri intentionally omitted
    }
    const prov = buildProvenanceObject(meta)
    expect(prov.layer).toBe('L2')
    expect(prov.source.raw_snapshot_uri).toBeNull()
  })

  it('L2 session-scoped source with no raw_snapshot_uri defaults to null', () => {
    const meta = {
      source_type: 'document',
      file_type: 'pdf',
      session_id: 'sess-456',
      source_url: 'https://example.com/report.pdf',
      extraction_confidence: 0.80,
      // raw_snapshot_uri intentionally omitted
    }
    const prov = buildProvenanceObject(meta)
    expect(prov.layer).toBe('L2')
    expect(prov.source.raw_snapshot_uri).toBeNull()
  })
})
