import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockQuery = vi.fn()
vi.mock('../../src/db/client.js', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}))

const mockChunk = vi.fn()
vi.mock('../../src/services/chunkService.js', () => ({
  chunk: (...args) => mockChunk(...args),
}))

const mockEmbedTexts = vi.fn()
vi.mock('../../src/services/embeddingService.js', () => ({
  embedTexts: (...args) => mockEmbedTexts(...args),
}))

const mockDownload = vi.fn()
const mockUpload = vi.fn()
vi.mock('../../src/services/s3Service.js', () => ({
  download: (...args) => mockDownload(...args),
  upload: (...args) => mockUpload(...args),
}))

const mockMarkStale = vi.fn()
const mockMarkSuperseded = vi.fn()
vi.mock('../../src/db/queries/chunks.js', () => ({
  markStale: (...args) => mockMarkStale(...args),
  markSuperseded: (...args) => mockMarkSuperseded(...args),
}))

const mockInsertEvent = vi.fn()
vi.mock('../../src/db/queries/trustRunEvents.js', () => ({
  insertEvent: (...args) => mockInsertEvent(...args),
}))

vi.mock('../../src/config/env.js', () => ({
  config: { S3_BUCKET: 'test-bucket' },
}))

const { refresh } = await import('../../src/services/refreshService.js')

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeChunkRow(overrides = {}) {
  return {
    id: 'old-chunk-1',
    document_id: 'doc-1',
    chunk_text: 'old text',
    chunk_hash: 'hash-old',
    token_count: 10,
    source_uri: 'https://example.com/page',
    canonical_uri: 'https://example.com/page',
    raw_snapshot_uri: 's3://test-bucket/ethikslabs/doc-1/original',
    snapshot_policy: 'auto_refresh',
    is_superseded: false,
    provenance: {
      schema_version: '1.0',
      source_type: 'web',
      source_subtype: 'html',
      layer: 'L3',
      snapshot_policy: 'auto_refresh',
      extraction: {
        confidence: 0.85,
        method: 'playwright',
        ingested_at: '2026-03-14T09:43:00Z',
        ingested_by: 'ingestion-bot-v1',
      },
      source: {
        uri: 'https://example.com/page',
        canonical_uri: 'https://example.com/page',
        raw_snapshot_uri: 's3://test-bucket/ethikslabs/doc-1/snapshot',
        title: 'Test Page',
        retrieved_at: '2026-03-14T09:41:22Z',
        version: null,
        freshness_policy: { ttl_hours: 24, stale_if_fetch_fails: true },
      },
      status: {
        is_stale: false,
        stale_since: null,
        is_superseded: false,
        superseded_at: null,
        superseded_by_chunk_id: null,
      },
      reasoning: { run_id: null, usages: [] },
    },
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('refreshService.js — Task 10.3: Refresh scope validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  // ── Req 13.3: L1 refresh without snapshot → skipped ───────────────────
  describe('L1 refresh without raw snapshot (Req 13.3)', () => {
    it('returns status "skipped" when L1 chunk has no raw_snapshot_uri', async () => {
      const l1Chunk = makeChunkRow({
        id: 'l1-chunk',
        raw_snapshot_uri: null,
        provenance: {
          ...makeChunkRow().provenance,
          layer: 'L1',
          snapshot_policy: 'static',
          source: {
            ...makeChunkRow().provenance.source,
            raw_snapshot_uri: null,
            freshness_policy: { ttl_hours: null, stale_if_fetch_fails: false },
          },
        },
      })

      // findChunksForRefresh returns the L1 chunk with no snapshot
      mockQuery.mockResolvedValueOnce({ rows: [l1Chunk] })

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['l1-chunk'],
        reason: 'test',
      })

      expect(result.refreshed).toHaveLength(1)
      expect(result.refreshed[0].status).toBe('skipped')
      expect(result.refreshed[0].reason).toMatch(/L1.*snapshot/i)
    })
  })

  // ── Req 13.4: L2 refresh without company_id → skipped ────────────────
  describe('L2 refresh without company_id (Req 13.4)', () => {
    it('returns status "skipped" when L2 chunk refresh has no companyId', async () => {
      const l2Chunk = makeChunkRow({
        id: 'l2-chunk',
        provenance: {
          ...makeChunkRow().provenance,
          layer: 'L2',
          snapshot_policy: 'refresh_on_request',
          source: {
            ...makeChunkRow().provenance.source,
            freshness_policy: { ttl_hours: null, stale_if_fetch_fails: false },
          },
        },
      })

      mockQuery.mockResolvedValueOnce({ rows: [l2Chunk] })

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['l2-chunk'],
        reason: 'test',
        // companyId intentionally omitted
      })

      expect(result.refreshed).toHaveLength(1)
      expect(result.refreshed[0].status).toBe('skipped')
      expect(result.refreshed[0].reason).toMatch(/L2.*companyId/i)
    })
  })

  // ── Req 13.2: L3/L5 refresh without URI → skipped ────────────────────
  describe('L3/L5 refresh without source URI (Req 13.2)', () => {
    it('returns status "skipped" when L3 chunk has no source_uri or canonical_uri', async () => {
      const l3Chunk = makeChunkRow({
        id: 'l3-chunk',
        source_uri: null,
        canonical_uri: null,
        provenance: {
          ...makeChunkRow().provenance,
          layer: 'L3',
          source: {
            ...makeChunkRow().provenance.source,
            uri: null,
            canonical_uri: null,
          },
        },
      })

      mockQuery.mockResolvedValueOnce({ rows: [l3Chunk] })

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['l3-chunk'],
        reason: 'test',
      })

      expect(result.refreshed).toHaveLength(1)
      expect(result.refreshed[0].status).toBe('skipped')
      expect(result.refreshed[0].reason).toMatch(/L3.*URI/i)
    })

    it('returns status "skipped" when L5 chunk has no source_uri or canonical_uri', async () => {
      const l5Chunk = makeChunkRow({
        id: 'l5-chunk',
        source_uri: null,
        canonical_uri: null,
        provenance: {
          ...makeChunkRow().provenance,
          layer: 'L5',
          source_type: 'api',
          source_subtype: 'json_api',
          source: {
            ...makeChunkRow().provenance.source,
            uri: null,
            canonical_uri: null,
          },
        },
      })

      mockQuery.mockResolvedValueOnce({ rows: [l5Chunk] })

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['l5-chunk'],
        reason: 'test',
      })

      expect(result.refreshed).toHaveLength(1)
      expect(result.refreshed[0].status).toBe('skipped')
      expect(result.refreshed[0].reason).toMatch(/L3\/L5.*URI|L5.*URI/i)
    })
  })

  // ── Req 6.4: Fan-out refresh → only first chunk linked (v1 constraint) ─
  describe('Fan-out refresh — v1 lineage constraint (Req 6.4)', () => {
    it('calls markSuperseded only once linking old chunk to first new chunk', async () => {
      const l3Chunk = makeChunkRow({ id: 'old-1' })

      // findChunksForRefresh
      mockQuery.mockResolvedValueOnce({ rows: [l3Chunk] })

      // Mock global fetch for re-fetch (L3 uses HTTP fetch)
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('New content that is long enough to produce multiple chunks when processed by the chunking service'),
      })

      // chunk() returns multiple new chunks (fan-out)
      mockChunk.mockReturnValueOnce([
        { chunk_text: 'chunk A', chunk_index: 0, chunk_hash: 'hash-a', token_count: 5 },
        { chunk_text: 'chunk B', chunk_index: 1, chunk_hash: 'hash-b', token_count: 5 },
        { chunk_text: 'chunk C', chunk_index: 2, chunk_hash: 'hash-c', token_count: 5 },
      ])

      // embedTexts returns embeddings for 3 chunks
      mockEmbedTexts.mockResolvedValueOnce([[0.1], [0.2], [0.3]])

      // Upload new snapshot for L3
      mockUpload.mockResolvedValueOnce('ethikslabs/doc-1/snapshot')

      // insertRefreshedChunks — returns 3 inserted rows
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'new-1', chunk_hash: 'hash-a' },
          { id: 'new-2', chunk_hash: 'hash-b' },
          { id: 'new-3', chunk_hash: 'hash-c' },
        ],
      })

      // markSuperseded calls (2 pool.query calls inside markSuperseded)
      mockMarkSuperseded.mockResolvedValueOnce(undefined)

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['old-1'],
        reason: 'test fan-out',
      })

      // markSuperseded called exactly once — linking old-1 → new-1 only
      expect(mockMarkSuperseded).toHaveBeenCalledTimes(1)
      expect(mockMarkSuperseded).toHaveBeenCalledWith('old-1', 'new-1')

      // Result should show new_chunk_id only for the first entry
      const refreshed = result.refreshed
      expect(refreshed).toHaveLength(1)
      expect(refreshed[0].old_chunk_id).toBe('old-1')
      expect(refreshed[0].new_chunk_id).toBe('new-1')
      expect(refreshed[0].status).toBe('refreshed')

      // Restore global fetch
      globalThis.fetch = originalFetch
    })

    it('supersedes ALL old chunks when source has multiple old chunks', async () => {
      // Two old chunks sharing the same canonical_uri (same source)
      const old1 = makeChunkRow({ id: 'old-1', canonical_uri: 'https://example.com/page' })
      const old2 = makeChunkRow({ id: 'old-2', canonical_uri: 'https://example.com/page' })

      // findChunksForRefresh returns both old chunks
      mockQuery.mockResolvedValueOnce({ rows: [old1, old2] })

      const originalFetch2 = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Updated content'),
      })

      mockChunk.mockReturnValueOnce([
        { chunk_text: 'new chunk', chunk_index: 0, chunk_hash: 'hash-new', token_count: 5 },
      ])
      mockEmbedTexts.mockResolvedValueOnce([[0.1]])
      mockUpload.mockResolvedValueOnce('ethikslabs/doc-1/snapshot')

      // insertRefreshedChunks returns 1 new chunk
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'new-1', chunk_hash: 'hash-new' }],
      })

      mockMarkSuperseded.mockResolvedValue(undefined)

      const result = await refresh({
        tenantId: 'ethikslabs',
        chunkIds: ['old-1', 'old-2'],
        reason: 'test multi-chunk supersession',
      })

      // markSuperseded called for BOTH old chunks
      expect(mockMarkSuperseded).toHaveBeenCalledTimes(2)
      expect(mockMarkSuperseded).toHaveBeenCalledWith('old-1', 'new-1')
      expect(mockMarkSuperseded).toHaveBeenCalledWith('old-2', 'new-1')

      expect(result.refreshed).toHaveLength(2)
      expect(result.refreshed.every(r => r.status === 'refreshed')).toBe(true)

      globalThis.fetch = originalFetch2
    })
  })
})
