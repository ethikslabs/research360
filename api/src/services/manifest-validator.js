const REQUIRED_FIELDS = [
  'url', 'source_type', 'source_tier', 'source_domain',
  'jurisdiction', 'framework_tags', 'vendor_tags',
  'discovery_mode', 'justification', 'confidence',
]

const VALID_SOURCE_TYPES  = new Set(['url', 'document', 'api_feed'])
const VALID_SOURCE_TIERS  = new Set([1, 2, 3])
const VALID_JURISDICTIONS = new Set(['AU', 'US', 'EU', 'GLOBAL'])
const VALID_MODES         = new Set(['gap_detection', 'vendor_staleness', 'horizon_scan'])

function validateCandidate(raw) {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      return { ok: false, reason: `Missing required field: ${field}` }
    }
  }

  try { new URL(raw.url) } catch {
    return { ok: false, reason: `Invalid url: ${raw.url}` }
  }

  if (!VALID_SOURCE_TYPES.has(raw.source_type)) {
    return { ok: false, reason: `Invalid source_type: ${raw.source_type}` }
  }

  if (!VALID_SOURCE_TIERS.has(raw.source_tier)) {
    return { ok: false, reason: `Invalid source_tier: ${raw.source_tier}` }
  }

  if (!VALID_JURISDICTIONS.has(raw.jurisdiction)) {
    return { ok: false, reason: `Invalid jurisdiction: ${raw.jurisdiction}` }
  }

  if (!VALID_MODES.has(raw.discovery_mode)) {
    return { ok: false, reason: `Invalid discovery_mode: ${raw.discovery_mode}` }
  }

  if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
    return { ok: false, reason: `confidence must be 0.0–1.0, got: ${raw.confidence}` }
  }

  if (typeof raw.justification !== 'string' || raw.justification.trim() === '') {
    return { ok: false, reason: `justification must be a non-empty string` }
  }

  return { ok: true }
}

/**
 * Validate raw Claude JSON output.
 * - Rejects entire run on JSON parse failure (returns ok: false)
 * - Rejects individual candidates on schema violation (returns ok: true, with rejected list)
 *
 * @param {string} rawJson
 * @returns {{ ok: boolean, candidates: object[], rejected: object[], error?: string }}
 */
export function validateManifest(rawJson) {
  let parsed
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    return { ok: false, candidates: [], rejected: [], error: `JSON parse failed: ${err.message}` }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, candidates: [], rejected: [], error: 'Claude output must be a JSON array' }
  }

  const candidates = []
  const rejected = []

  for (const item of parsed) {
    const check = validateCandidate(item)
    if (check.ok) {
      candidates.push(item)
    } else {
      rejected.push({ candidate: item, reason: check.reason })
    }
  }

  return { ok: true, candidates, rejected }
}
