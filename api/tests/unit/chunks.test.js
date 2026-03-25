import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the pool before importing the module under test
const mockQuery = vi.fn()
vi.mock('../../src/db/client.js', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}))

const {
  insertBatch,
  findProvenanceByChunkId,
  markStale,
  markSuperseded,
  findStaleEligible,
  findByDocumentId,
} = await import('../../src/db/queries/chunks.js')

describe('chunks.js extended queries — Task 1.4', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  // ── Required exports exist ────────────────────────────────────────────
  describe('required function exports', () => {
    it('exports insertBatch', () => {
      expect(typeof insertBatch).toBe('function')
    })
    it('exports findProvenanceByChunkId', () => {
      expect(typeof findProvenanceByChunkId).toBe('function')
    })
    it('exports markStale', () => {
      expect(typeof markStale).toBe('function')
    })
    it('exports markSuperseded', () => {
      expect(typeof markSuperseded).toBe('function')
    })
    it('exports findStaleEligible', () => {
      expect(typeof findStaleEligible).toBe('function')
    })
    it('exports findByDocumentId', () => {
      expect(typeof findByDocumentId).toBe('function')
    })
  })

  // ── insertBatch: 18 columns, provenance JSONB, atomic ─────────────────
  describe('insertBatch', () => {
    it('writes all 18 columns including provenance JSONB atomically', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const chunk = {
        tenantId: 'ethikslabs',
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Some text',
        chunkHash: 'hash-abc',
        tokenCount: 42,
        provenance: { schema_version: '1.0', source_type: 'file' },
        source_type: 'file',
        source_subtype: 'pdf',
        extraction_confidence: 0.95,
        ingested_by: 'ingestion-bot-v1',
        source_retrieved_at: '2026-03-14T09:41:22Z',
        source_uri: 'https://example.com/doc.pdf',
        canonical_uri: 'https://example.com/doc',
        raw_snapshot_uri: 's3://bucket/snapshot',
        snapshot_policy: 'static',
        is_stale: false,
        is_superseded: false,
      }

      await insertBatch([chunk])

      expect(mockQuery).toHaveBeenCalledTimes(1)
      const [sql, params] = mockQuery.mock.calls[0]

      // SQL must reference all 18 column names
      expect(sql).toMatch(/tenant_id/)
      expect(sql).toMatch(/document_id/)
      expect(sql).toMatch(/chunk_index/)
      expect(sql).toMatch(/chunk_text/)
      expect(sql).toMatch(/chunk_hash/)
      expect(sql).toMatch(/token_count/)
      expect(sql).toMatch(/provenance/)
      expect(sql).toMatch(/source_type/)
      expect(sql).toMatch(/source_subtype/)
      expect(sql).toMatch(/extraction_confidence/)
      expect(sql).toMatch(/ingested_by/)
      expect(sql).toMatch(/source_retrieved_at/)
      expect(sql).toMatch(/source_uri/)
      // The actual DB column is canonical_url (from migration 004)
      expect(sql).toMatch(/canonical_url/)
      expect(sql).toMatch(/raw_snapshot_uri/)
      expect(sql).toMatch(/snapshot_policy/)
      expect(sql).toMatch(/is_stale/)
      expect(sql).toMatch(/is_superseded/)

      // Exactly 18 params per chunk
      expect(params).toHaveLength(18)

      // Provenance is serialised as JSON string
      expect(params[6]).toBe(JSON.stringify(chunk.provenance))

      // Verify all values are passed in order
      expect(params[0]).toBe('ethikslabs')
      expect(params[1]).toBe('doc-1')
      expect(params[2]).toBe(0)
      expect(params[7]).toBe('file')
      expect(params[8]).toBe('pdf')
      expect(params[9]).toBe(0.95)
      expect(params[13]).toBe('https://example.com/doc')
    })

    it('does nothing for empty array', async () => {
      await insertBatch([])
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('handles multiple chunks with correct param count', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const chunks = [
        { tenantId: 't1', documentId: 'd1', chunkIndex: 0, chunkText: 'a', chunkHash: 'h1' },
        { tenantId: 't1', documentId: 'd1', chunkIndex: 1, chunkText: 'b', chunkHash: 'h2' },
      ]

      await insertBatch(chunks)
      const params = mockQuery.mock.calls[0][1]
      // 2 chunks × 18 columns = 36 params
      expect(params).toHaveLength(36)
    })
  })

  // ── findProvenanceByChunkId ─────────────────────────────────────────
  describe('findProvenanceByChunkId', () => {
    it('returns provenance JSONB for existing chunk', async () => {
      const prov = { schema_version: '1.0', source_type: 'file' }
      mockQuery.mockResolvedValueOnce({ rows: [{ provenance: prov }] })

      const result = await findProvenanceByChunkId('chunk-1', 'ethikslabs')
      expect(result).toEqual(prov)
      expect(mockQuery.mock.calls[0][1]).toEqual(['chunk-1', 'ethikslabs'])
    })

    it('returns null when chunk does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await findProvenanceByChunkId('missing', 'ethikslabs')
      expect(result).toBeNull()
    })

    it('returns null when tenant_id does not match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await findProvenanceByChunkId('chunk-1', 'wrong-tenant')
      expect(result).toBeNull()
      expect(mockQuery.mock.calls[0][1]).toEqual(['chunk-1', 'wrong-tenant'])
    })
  })

  // ── markStale ─────────────────────────────────────────────────────────
  describe('markStale', () => {
    it('sets is_stale=true and stale_since on specified chunks', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const staleSince = '2026-03-14T10:00:00Z'

      await markStale(['c1', 'c2'], staleSince)

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toMatch(/UPDATE chunks SET is_stale = true/)
      expect(sql).toMatch(/stale_since/)
      expect(params[0]).toBe(staleSince)
      expect(params).toContain('c1')
      expect(params).toContain('c2')
    })

    it('only updates chunks not already stale', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await markStale(['c1'], '2026-01-01T00:00:00Z')
      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/is_stale = false/)
    })

    it('does nothing for empty array', async () => {
      await markStale([])
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  // ── markSuperseded: bidirectional linkage ──────────────────────────────
  describe('markSuperseded', () => {
    it('writes bidirectional linkage: superseded_by on old, previous on new', async () => {
      mockQuery.mockResolvedValue({ rows: [] })

      await markSuperseded('old-chunk', 'new-chunk')

      // Two queries: one for old chunk, one for new chunk
      expect(mockQuery).toHaveBeenCalledTimes(2)

      // First query: set superseded_by_chunk_id on old chunk
      const [sql1, params1] = mockQuery.mock.calls[0]
      expect(sql1).toMatch(/superseded_by_chunk_id/)
      expect(sql1).toMatch(/is_superseded = true/)
      expect(sql1).toMatch(/superseded_at/)
      expect(params1).toEqual(['new-chunk', 'old-chunk'])

      // Second query: set previous_chunk_id on new chunk
      const [sql2, params2] = mockQuery.mock.calls[1]
      expect(sql2).toMatch(/previous_chunk_id/)
      expect(params2).toEqual(['old-chunk', 'new-chunk'])
    })
  })

  // ── findStaleEligible ─────────────────────────────────────────────────
  describe('findStaleEligible', () => {
    it('queries for auto_refresh chunks with expired TTL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] })

      const result = await findStaleEligible()

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/is_stale = false/)
      expect(sql).toMatch(/snapshot_policy = 'auto_refresh'/)
      expect(sql).toMatch(/ttl_hours/)
      expect(sql).toMatch(/source_retrieved_at IS NOT NULL/)
      expect(result).toEqual([{ id: 'c1' }])
    })
  })

  // ── findByDocumentId ──────────────────────────────────────────────────
  describe('findByDocumentId', () => {
    it('returns all chunks for a document ordered by chunk_index', async () => {
      const rows = [
        { id: 'c1', chunk_index: 0 },
        { id: 'c2', chunk_index: 1 },
      ]
      mockQuery.mockResolvedValueOnce({ rows })

      const result = await findByDocumentId('doc-1')

      expect(result).toEqual(rows)
      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/document_id/)
      expect(sql).toMatch(/ORDER BY chunk_index/)
      expect(mockQuery.mock.calls[0][1]).toEqual(['doc-1'])
    })
  })
})
