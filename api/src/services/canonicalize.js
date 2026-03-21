import { pool } from '../db/client.js'
import { config } from '../config/env.js'

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'fbclid', 'gclid', 'msclkid', 'mc_eid',
])

/**
 * Normalize a URL: lowercase scheme+host, strip tracking params and fragments,
 * remove trailing slash (except root path).
 * @param {string} rawUrl
 * @returns {string} canonical URL
 * @throws if rawUrl is not a valid URL
 */
export function canonicalizeUrl(rawUrl) {
  const u = new URL(rawUrl)

  u.hostname = u.hostname.toLowerCase()
  u.protocol = u.protocol.toLowerCase()
  u.hash = ''

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      u.searchParams.delete(key)
    }
  }

  let href = u.toString()

  // Strip trailing slash on non-root paths
  if (href.endsWith('/') && u.pathname !== '/') {
    href = href.slice(0, -1)
  }

  // Strip trailing slash added by URL parser when original had no explicit path.
  // e.g. 'https://example.com' → URL parses to 'https://example.com/' but should stay slash-free.
  // But 'https://example.com/' (explicit slash) and 'https://example.com/?q=1' both keep their slash.
  const rawWithoutFragment = rawUrl.split('#')[0]
  const rawWithoutQuery = rawWithoutFragment.split('?')[0]
  const originalHadExplicitSlash = rawWithoutQuery.endsWith('/')
  if (href.endsWith('/') && u.pathname === '/' && !originalHadExplicitSlash) {
    href = href.slice(0, -1)
  }

  return href
}

/**
 * Extract the source_domain (hostname) from a URL.
 * @param {string} url
 * @returns {string}
 */
export function sourceDomain(url) {
  return new URL(url).hostname.toLowerCase()
}

/**
 * Check if a canonical URL already exists in chunks or recent discovery_candidates.
 * Returns true if the candidate should be DISCARDED (is a duplicate).
 *
 * Deduplication rules:
 * 1. canonical_url already in chunks.canonical_url
 * 2. canonical_url in discovery_candidates (pending/approved/ingested) within DEDUPE_LOOKBACK_DAYS
 * 3. Same vendor_tags + framework_tags + source_domain combination within lookback
 *
 * @param {string} canonicalUrl
 * @param {string[]} vendorTags
 * @param {string[]} frameworkTags
 * @param {string} srcDomain
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(canonicalUrl, vendorTags, frameworkTags, srcDomain) {
  const lookbackDays = config.DEDUPE_LOOKBACK_DAYS

  // Rule 1
  const chunksResult = await pool.query(
    `SELECT 1 FROM chunks WHERE canonical_url = $1 LIMIT 1`,
    [canonicalUrl]
  )
  if (chunksResult.rowCount > 0) return true

  // Rule 2
  const dcResult = await pool.query(
    `SELECT 1 FROM discovery_candidates
     WHERE canonical_url = $1
       AND status IN ('pending', 'approved', 'ingested')
       AND generated_at >= NOW() - ($2 || ' days')::INTERVAL
     LIMIT 1`,
    [canonicalUrl, lookbackDays]
  )
  if (dcResult.rowCount > 0) return true

  // Rule 3: exact array match on vendor_tags + framework_tags + same source_domain
  if (vendorTags.length > 0 || frameworkTags.length > 0) {
    const comboResult = await pool.query(
      `SELECT 1 FROM discovery_candidates
       WHERE source_domain = $1
         AND vendor_tags   @> $2::text[]
         AND $2::text[]    @> vendor_tags
         AND framework_tags @> $3::text[]
         AND $3::text[]    @> framework_tags
         AND status IN ('pending', 'approved', 'ingested')
         AND generated_at >= NOW() - ($4 || ' days')::INTERVAL
       LIMIT 1`,
      [srcDomain, vendorTags, frameworkTags, lookbackDays]
    )
    if (comboResult.rowCount > 0) return true
  }

  return false
}
