import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { formatDisplayTimestamp } from '../../../frontend/src/utils/formatDisplayTimestamp.js'

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 18: Timestamp formatting (frontend-only)
// **Validates: Requirements 15.4, 16.2, 16.3, 16.4**
//
// For any UTC ISO 8601 timestamp, formatDisplayTimestamp SHALL return a
// non-null string matching the pattern `\d{1,2} [A-Z][a-z]{2} \d{4}`
// (e.g., "20 Mar 2026"). For null/undefined/empty input, it SHALL return null.
// The output SHALL always be in Australia/Sydney timezone.
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a random ISO 8601 UTC timestamp string */
const isoTimestampArb = fc.date({
  min: new Date('1970-01-01T00:00:00Z'),
  max: new Date('2099-12-31T23:59:59Z'),
}).map(d => d.toISOString())

/**
 * Pattern for the expected output format: "20 Mar 2026" or "1 June 2012".
 * The en-AU locale with month: 'short' may produce 3-4 letter month
 * abbreviations (e.g., "Mar", "Jun") or full names depending on the
 * Intl implementation. We match: day, space, capitalized month word, space, year.
 */
const DISPLAY_FORMAT_REGEX = /^\d{1,2} [A-Z][a-z]{2,8} \d{4}$/

describe('Property 18: Timestamp formatting (frontend-only)', () => {
  it('returns a string matching "D Mon YYYY" for any valid UTC ISO timestamp', () => {
    fc.assert(
      fc.property(isoTimestampArb, (iso) => {
        const result = formatDisplayTimestamp(iso)
        expect(result).not.toBeNull()
        expect(typeof result).toBe('string')
        expect(result).toMatch(DISPLAY_FORMAT_REGEX)
      }),
      { numRuns: 100 },
    )
  })

  it('returns null for null, undefined, and empty string inputs', () => {
    const falsyArb = fc.constantFrom(null, undefined, '')
    fc.assert(
      fc.property(falsyArb, (input) => {
        const result = formatDisplayTimestamp(input)
        expect(result).toBeNull()
      }),
      { numRuns: 100 },
    )
  })

  it('output is always in Australia/Sydney timezone (cross-check with Intl)', () => {
    const sydneyFormatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

    fc.assert(
      fc.property(isoTimestampArb, (iso) => {
        const result = formatDisplayTimestamp(iso)
        const expected = sydneyFormatter.format(new Date(iso))
        expect(result).toBe(expected)
      }),
      { numRuns: 100 },
    )
  })

  it('never contains raw UTC offset or AEST/AEDT strings', () => {
    fc.assert(
      fc.property(isoTimestampArb, (iso) => {
        const result = formatDisplayTimestamp(iso)
        expect(result).not.toMatch(/[+-]\d{2}:\d{2}/)
        expect(result).not.toMatch(/UTC/)
        expect(result).not.toMatch(/AEST/)
        expect(result).not.toMatch(/AEDT/)
        expect(result).not.toMatch(/Z$/)
      }),
      { numRuns: 100 },
    )
  })

  it('day component is a valid day number (1-31) and year is a 4-digit number', () => {
    fc.assert(
      fc.property(isoTimestampArb, (iso) => {
        const result = formatDisplayTimestamp(iso)
        const parts = result.split(' ')
        expect(parts.length).toBe(3)

        const day = parseInt(parts[0], 10)
        expect(day).toBeGreaterThanOrEqual(1)
        expect(day).toBeLessThanOrEqual(31)

        const year = parseInt(parts[2], 10)
        expect(year).toBeGreaterThanOrEqual(1970)
        expect(year).toBeLessThanOrEqual(2100)
      }),
      { numRuns: 100 },
    )
  })
})
