import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the pool before importing the module under test
const mockQuery = vi.fn()
vi.mock('../../src/db/client.js', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}))

const { insertEvent, findEventsByRunId, VALID_EVENT_TYPES } = await import(
  '../../src/db/queries/trustRunEvents.js'
)

describe('trustRunEvents query module', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  // ── Module exports ────────────────────────────────────────────────────
  it('exports insertEvent, findEventsByRunId, and VALID_EVENT_TYPES', async () => {
    const mod = await import('../../src/db/queries/trustRunEvents.js')
    const exportedNames = Object.keys(mod).sort()
    expect(exportedNames).toEqual(
      ['VALID_EVENT_TYPES', 'findEventsByRunId', 'insertEvent'].sort()
    )
  })

  // ── VALID_EVENT_TYPES enum ────────────────────────────────────────────
  describe('VALID_EVENT_TYPES', () => {
    it('contains exactly the v1 event types', () => {
      expect(VALID_EVENT_TYPES).toEqual([
        'stale_flagged',
        'refresh_triggered',
        'refresh_completed',
        'dispute_opened',
        'dispute_closed',
      ])
    })
  })

  // ── insertEvent ───────────────────────────────────────────────────────
  describe('insertEvent', () => {
    it('inserts a valid event and returns the created row', async () => {
      const fakeRow = {
        event_id: 'evt-1',
        run_id: 'run-1',
        event_type: 'refresh_completed',
        event_at: '2026-03-14T09:00:00Z',
        payload: { old_chunk_id: 'c1', new_chunk_id: 'c2' },
      }
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] })

      const result = await insertEvent({
        run_id: 'run-1',
        event_type: 'refresh_completed',
        payload: { old_chunk_id: 'c1', new_chunk_id: 'c2' },
      })

      expect(result).toEqual(fakeRow)

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/INSERT INTO trust_run_events/i)
      expect(sql).toMatch(/RETURNING \*/i)
    })

    it.each([
      'stale_flagged',
      'refresh_triggered',
      'refresh_completed',
      'dispute_opened',
      'dispute_closed',
    ])('accepts valid event_type "%s"', async (eventType) => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ event_id: 'e', event_type: eventType }],
      })

      const result = await insertEvent({
        run_id: 'run-1',
        event_type: eventType,
      })
      expect(result.event_type).toBe(eventType)
    })

    it('rejects an invalid event_type', async () => {
      await expect(
        insertEvent({ run_id: 'run-1', event_type: 'invalid_type' })
      ).rejects.toThrow(/Invalid event_type "invalid_type"/)
    })

    it('rejects an empty string event_type', async () => {
      await expect(
        insertEvent({ run_id: 'run-1', event_type: '' })
      ).rejects.toThrow(/Invalid event_type/)
    })

    it('serialises null payload as JSON null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ event_id: 'e', payload: null }],
      })

      await insertEvent({ run_id: 'run-1', event_type: 'stale_flagged' })

      const params = mockQuery.mock.calls[0][1]
      expect(params[2]).toBe('null')
    })

    it('serialises object payload as JSON', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ event_id: 'e', payload: { reason: 'ttl' } }],
      })

      await insertEvent({
        run_id: 'run-1',
        event_type: 'stale_flagged',
        payload: { reason: 'ttl' },
      })

      const params = mockQuery.mock.calls[0][1]
      expect(JSON.parse(params[2])).toEqual({ reason: 'ttl' })
    })
  })

  // ── findEventsByRunId ─────────────────────────────────────────────────
  describe('findEventsByRunId', () => {
    it('returns events ordered by event_at ASC', async () => {
      const fakeRows = [
        { event_id: 'e1', event_at: '2026-03-14T09:00:00Z' },
        { event_id: 'e2', event_at: '2026-03-14T10:00:00Z' },
      ]
      mockQuery.mockResolvedValueOnce({ rows: fakeRows })

      const result = await findEventsByRunId('run-1')
      expect(result).toEqual(fakeRows)

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/ORDER BY event_at ASC/i)
    })

    it('passes run_id as query parameter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await findEventsByRunId('run-abc')
      expect(mockQuery.mock.calls[0][1]).toEqual(['run-abc'])
    })

    it('returns empty array when no events exist for the run', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await findEventsByRunId('run-empty')
      expect(result).toEqual([])
    })
  })
})
