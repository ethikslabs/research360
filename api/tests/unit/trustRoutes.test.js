import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Fastify from 'fastify'

// ── Mock DB query modules ───────────────────────────────────────────────
const mockInsertRun = vi.fn()
const mockFindRunById = vi.fn()
const mockFindRunProvenance = vi.fn()

vi.mock('../../src/db/queries/trustRuns.js', () => ({
  insertRun: (...args) => mockInsertRun(...args),
  findRunById: (...args) => mockFindRunById(...args),
  findRunProvenance: (...args) => mockFindRunProvenance(...args),
}))

const mockFindEventsByRunId = vi.fn()

vi.mock('../../src/db/queries/trustRunEvents.js', () => ({
  findEventsByRunId: (...args) => mockFindEventsByRunId(...args),
}))

const mockFindProvenanceByChunkId = vi.fn()

vi.mock('../../src/db/queries/chunks.js', () => ({
  findProvenanceByChunkId: (...args) => mockFindProvenanceByChunkId(...args),
}))

// ── Build Fastify app with the routes under test ────────────────────────
const { default: trustRoutes } = await import('../../src/routes/trust.js')
const { default: provenanceRoutes } = await import('../../src/routes/provenance.js')

let app

function buildApp() {
  const server = Fastify({ logger: false })
  server.register(trustRoutes)
  server.register(provenanceRoutes)
  return server
}

beforeEach(async () => {
  mockInsertRun.mockReset()
  mockFindRunById.mockReset()
  mockFindRunProvenance.mockReset()
  mockFindEventsByRunId.mockReset()
  mockFindProvenanceByChunkId.mockReset()

  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  if (app) await app.close()
})

// ═══════════════════════════════════════════════════════════════════════
// Trust Routes — /api/trust/runs/:run_id
// ═══════════════════════════════════════════════════════════════════════

describe('trust routes', () => {
  // ── Immutability: 405 for PUT/PATCH/DELETE (Req 11.2) ─────────────────
  describe('immutability enforcement — PUT/PATCH/DELETE return 405', () => {
    const RUN_ID = '00000000-0000-0000-0000-000000000001'

    it('PUT /api/trust/runs/:run_id returns 405', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/trust/runs/${RUN_ID}`,
        payload: { trust_scores: { overall: 0.5 } },
      })
      expect(res.statusCode).toBe(405)
      const body = res.json()
      expect(body.code).toBe('TRUST_RUN_IMMUTABLE')
    })

    it('PATCH /api/trust/runs/:run_id returns 405', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/trust/runs/${RUN_ID}`,
        payload: { trust_scores: { overall: 0.9 } },
      })
      expect(res.statusCode).toBe(405)
      const body = res.json()
      expect(body.code).toBe('TRUST_RUN_IMMUTABLE')
    })

    it('DELETE /api/trust/runs/:run_id returns 405', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/trust/runs/${RUN_ID}`,
      })
      expect(res.statusCode).toBe(405)
      const body = res.json()
      expect(body.code).toBe('TRUST_RUN_IMMUTABLE')
    })
  })

  // ── INSERT succeeds on trust_runs (Req 11.1) ─────────────────────────
  describe('INSERT succeeds on trust_runs', () => {
    it('insertRun creates a row and returns it (query module level)', async () => {
      const fakeRow = {
        run_id: '00000000-0000-0000-0000-000000000099',
        company_id: 'acme',
        run_at: '2026-03-14T09:00:00Z',
      }
      mockInsertRun.mockResolvedValueOnce(fakeRow)

      const result = await mockInsertRun({
        company_id: 'acme',
        corpus_snapshot: { docs: [] },
        chunks_retrieved: [],
        reasoning_steps: [],
        gaps_identified: [],
        vendor_resolutions: null,
        trust_scores: { overall: 0.85 },
      })

      expect(result).toEqual(fakeRow)
      expect(mockInsertRun).toHaveBeenCalledTimes(1)
    })
  })

  // ── GET /api/trust/runs/:run_id/provenance ────────────────────────────
  describe('GET /api/trust/runs/:run_id/provenance', () => {
    it('returns provenance data for an existing run', async () => {
      const provenanceData = {
        run_id: 'run-1',
        run_at: '2026-03-14T09:00:00Z',
        sources: [{ chunk_id: 'c1', chunk_text: 'text', provenance: {} }],
      }
      mockFindRunProvenance.mockResolvedValueOnce(provenanceData)

      const res = await app.inject({
        method: 'GET',
        url: '/api/trust/runs/run-1/provenance',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(provenanceData)
    })

    it('returns 404 for non-existent run_id (Req 14.4)', async () => {
      mockFindRunProvenance.mockResolvedValueOnce(null)

      const res = await app.inject({
        method: 'GET',
        url: '/api/trust/runs/nonexistent-run/provenance',
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.code).toBe('RUN_NOT_FOUND')
    })
  })

  // ── GET /api/trust/runs/:run_id/events ────────────────────────────────
  describe('GET /api/trust/runs/:run_id/events', () => {
    it('returns events for an existing run', async () => {
      const fakeRun = { run_id: 'run-1', company_id: 'acme' }
      const fakeEvents = [
        { event_id: 'e1', event_type: 'stale_flagged', event_at: '2026-03-14T09:00:00Z' },
        { event_id: 'e2', event_type: 'refresh_completed', event_at: '2026-03-14T10:00:00Z' },
      ]
      mockFindRunById.mockResolvedValueOnce(fakeRun)
      mockFindEventsByRunId.mockResolvedValueOnce(fakeEvents)

      const res = await app.inject({
        method: 'GET',
        url: '/api/trust/runs/run-1/events',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.run_id).toBe('run-1')
      expect(body.events).toEqual(fakeEvents)
    })

    it('returns 404 for non-existent run_id (Req 14.4)', async () => {
      mockFindRunById.mockResolvedValueOnce(null)

      const res = await app.inject({
        method: 'GET',
        url: '/api/trust/runs/nonexistent-run/events',
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.code).toBe('RUN_NOT_FOUND')
    })
  })
})


// ═══════════════════════════════════════════════════════════════════════
// Provenance Routes — /api/research/provenance/:chunk_id
// ═══════════════════════════════════════════════════════════════════════

describe('provenance routes', () => {
  describe('GET /api/research/provenance/:chunk_id', () => {
    it('returns provenance for an existing chunk', async () => {
      const provenance = { schema_version: '1.0', source_type: 'file' }
      mockFindProvenanceByChunkId.mockResolvedValueOnce(provenance)

      const res = await app.inject({
        method: 'GET',
        url: '/api/research/provenance/chunk-abc',
        headers: { 'x-tenant-id': 'ethikslabs' },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.chunk_id).toBe('chunk-abc')
      expect(body.provenance).toEqual(provenance)
      expect(mockFindProvenanceByChunkId).toHaveBeenCalledWith('chunk-abc', 'ethikslabs')
    })

    it('returns 404 for non-existent chunk_id (Req 14.4)', async () => {
      mockFindProvenanceByChunkId.mockResolvedValueOnce(null)

      const res = await app.inject({
        method: 'GET',
        url: '/api/research/provenance/nonexistent-chunk',
        headers: { 'x-tenant-id': 'ethikslabs' },
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.code).toBe('CHUNK_NOT_FOUND')
    })

    it('returns 404 when tenant_id does not match chunk owner', async () => {
      mockFindProvenanceByChunkId.mockResolvedValueOnce(null)

      const res = await app.inject({
        method: 'GET',
        url: '/api/research/provenance/chunk-abc',
        headers: { 'x-tenant-id': 'wrong-tenant' },
      })

      expect(res.statusCode).toBe(404)
      expect(mockFindProvenanceByChunkId).toHaveBeenCalledWith('chunk-abc', 'wrong-tenant')
    })
  })
})
