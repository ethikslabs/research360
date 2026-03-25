
# Discovery Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Research360 Discovery Agent — an autonomous BullMQ worker that runs nightly, reasons over corpus gaps using Claude Sonnet, and produces a validated, deduplicated queue of candidate URLs for ingestion review.

**Architecture:** A `feed-poller` gathers raw items from trusted feeds, a `discovery-worker` calls Claude Sonnet with a curated corpus snapshot + vendor/gap catalog, the response is schema-validated by `manifest-validator`, deduped by `canonicalize`, and written to `discovery_candidates`. Candidates above `AUTO_INGEST_THRESHOLD` are immediately sent to `/research360/ingest/url`. Candidates between `REVIEW_THRESHOLD` and the auto-ingest threshold sit in a `pending` review queue behind new `GET/POST /api/discovery/*` endpoints.

**Tech Stack:** Node.js ESM, Fastify, BullMQ 5, IORedis, Postgres (pg pool), `@anthropic-ai/sdk`, Vitest

---

## Spec Reference

Brief: `research360-discovery-agent-brief-v1.1.md` in repo root.

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `api/src/db/migrations/004_discovery_agent.sql` | Adds `discovery_candidates`, `discovery_runs` tables + chunks metadata columns |
| `api/src/config/vendors.js` | Static vendor catalog for staleness mode |
| `api/src/config/gaps.js` | Static gap-category catalog for gap detection mode |
| `api/src/services/canonicalize.js` | URL normalization + DB-backed dedupe check |
| `api/src/services/coverage-summary.js` | Queries chunks/documents → structured `CoverageSummary` JSON |
| `api/src/services/feed-poller.js` | Polls SEED_FEEDS + vendor blogs → raw feed items |
| `api/src/services/manifest-validator.js` | Schema validation for Claude JSON output |
| `api/src/workers/discovery-worker.js` | Orchestrates one full discovery run end-to-end |
| `api/src/routes/discovery.js` | Review queue endpoints (list pending, approve, reject, list runs) |
| `api/tests/unit/canonicalize.test.js` | Unit tests for URL normalization |
| `api/tests/unit/manifest-validator.test.js` | Unit tests for schema validation |

### Modified files
| Path | Change |
|------|--------|
| `api/src/config/env.js` | Add discovery constants to config object |
| `api/src/db/client.js` | Update `initialize()` to load all migrations in sorted order |
| `api/src/queue/client.js` | Add `discovery` queue |
| `api/src/app.js` | Register `discoveryRoutes` + start `startDiscoveryWorker()` + schedule nightly job |

---

## Task 1: Database Migration + Migration Loader

**Files:**
- Create: `api/src/db/migrations/004_discovery_agent.sql`
- Modify: `api/src/db/client.js`

No unit test for SQL — verify by inspecting applied schema.

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/004_discovery_agent.sql` with this exact content (copy from brief verbatim — the chunks `ALTER TABLE` statements assume the `source_url`, `canonical_url`, etc. columns don't yet exist):

```sql
-- Discovery candidates
CREATE TABLE IF NOT EXISTS discovery_candidates (
  candidate_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL,
  url                   TEXT NOT NULL,
  canonical_url         TEXT NOT NULL,
  source_domain         TEXT,
  source_feed           TEXT,
  source_type           VARCHAR(20) NOT NULL,
  source_tier           INTEGER CHECK (source_tier IN (1, 2, 3)),
  jurisdiction          VARCHAR(10) NOT NULL DEFAULT 'GLOBAL',
  framework_tags        TEXT[] DEFAULT '{}',
  vendor_tags           TEXT[] DEFAULT '{}',
  discovery_mode        VARCHAR(30) NOT NULL,
  justification         TEXT NOT NULL,
  confidence            NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  auto_ingest           BOOLEAN DEFAULT FALSE,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  review_reason         TEXT,
  error_message         TEXT,
  content_fingerprint   TEXT,
  ingest_job_id         UUID NULL,
  generated_at          TIMESTAMPTZ DEFAULT NOW(),
  actioned_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status
  ON discovery_candidates(status);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_run_id
  ON discovery_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_canonical_url
  ON discovery_candidates(canonical_url);

-- Discovery run metrics
CREATE TABLE IF NOT EXISTS discovery_runs (
  run_id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                   TIMESTAMPTZ DEFAULT NOW(),
  completed_at                 TIMESTAMPTZ,
  candidates_generated         INTEGER DEFAULT 0,
  candidates_inserted          INTEGER DEFAULT 0,
  candidates_auto_ingested     INTEGER DEFAULT 0,
  candidates_pending_review    INTEGER DEFAULT 0,
  candidates_rejected_dedupe   INTEGER DEFAULT 0,
  feed_sources_polled          INTEGER DEFAULT 0,
  feed_source_failures         INTEGER DEFAULT 0,
  claude_latency_ms            INTEGER,
  total_run_duration_ms        INTEGER,
  error_message                TEXT,
  status                       VARCHAR(20) DEFAULT 'running'
);

-- Extend chunks table with discovery metadata
-- These columns are referenced in retrievalService.js + query.js already
-- Skip with DO $$ blocks to be idempotent

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN source_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN canonical_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN source_tier INTEGER CHECK (source_tier IN (1, 2, 3));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN jurisdiction VARCHAR(10) DEFAULT 'GLOBAL';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN framework_tags TEXT[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN vendor_tags TEXT[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN last_validated TIMESTAMPTZ DEFAULT NOW();
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chunks ADD COLUMN discovery_candidate_id UUID REFERENCES discovery_candidates(candidate_id);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_chunks_canonical_url  ON chunks(canonical_url);
CREATE INDEX IF NOT EXISTS idx_chunks_last_validated ON chunks(last_validated);
```

- [ ] **Step 2: Update db/client.js to load all migrations in order**

`initialize()` currently hardcodes `001_initial.sql`. Change it to read all `.sql` files in the migrations directory in sorted order, so `004_discovery_agent.sql` (and any future migrations) run automatically on startup:

```js
import pg from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from '../config/env.js'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

export const pool = new Pool({ connectionString: config.DATABASE_URL })

export async function initialize() {
  const migrationsDir = join(__dirname, 'migrations')
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    await pool.query(sql)
  }
}

export async function healthCheck() {
  const res = await pool.query('SELECT 1')
  return res.rows.length === 1
}
```

- [ ] **Step 3: Apply migration manually for first-time setup**

```bash
psql $DATABASE_URL -f api/src/db/migrations/004_discovery_agent.sql
```

Expected: no errors. If you see `already exists` warnings that's fine — the IF NOT EXISTS guards are there.

- [ ] **Step 4: Verify schema**

```bash
psql $DATABASE_URL -c "\d discovery_candidates" -c "\d discovery_runs" -c "\d chunks" | grep -E "canonical_url|source_tier|framework_tags|vendor_tags"
```

Expected: all columns present.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/004_discovery_agent.sql api/src/db/client.js
git commit -m "feat(discovery): add discovery migration + update db/client.js to load all migrations"
```

---

## Task 2: Config Constants + Catalogs

**Files:**
- Modify: `api/src/config/env.js`
- Create: `api/src/config/vendors.js`
- Create: `api/src/config/gaps.js`

- [ ] **Step 1: Add discovery constants to env.js**

In `api/src/config/env.js`, extend the returned frozen object with these constants. They do NOT come from environment variables — they are fixed config values:

```js
// Add to the return inside validateEnv(), after NODE_ENV:
AUTO_INGEST_THRESHOLD:     parseFloat(process.env.AUTO_INGEST_THRESHOLD)     || 0.85,
REVIEW_THRESHOLD:          parseFloat(process.env.REVIEW_THRESHOLD)          || 0.60,
VENDOR_STALENESS_DAYS:     parseInt(process.env.VENDOR_STALENESS_DAYS, 10)   || 30,
HORIZON_LOOKBACK_HOURS:    parseInt(process.env.HORIZON_LOOKBACK_HOURS, 10)  || 24,
DISCOVERY_MAX_CANDIDATES:  parseInt(process.env.DISCOVERY_MAX_CANDIDATES, 10)|| 20,
DISCOVERY_MAX_GAP:         parseInt(process.env.DISCOVERY_MAX_GAP, 10)       || 8,
DISCOVERY_MAX_STALENESS:   parseInt(process.env.DISCOVERY_MAX_STALENESS, 10) || 6,
DISCOVERY_MAX_HORIZON:     parseInt(process.env.DISCOVERY_MAX_HORIZON, 10)   || 6,
DEDUPE_LOOKBACK_DAYS:      parseInt(process.env.DEDUPE_LOOKBACK_DAYS, 10)    || 30,
```

- [ ] **Step 2: Create vendors.js**

Create `api/src/config/vendors.js`:

```js
// Proof360 vendor catalog — used by discovery agent for staleness detection.
// vendor: display name
// tags: how this vendor appears in corpus vendor_tags
// security_page: canonical trust/security page URL
// gap_categories: relevance to Proof360 gap categories

export const VENDORS = [
  {
    vendor: 'CrowdStrike',
    tags: ['crowdstrike'],
    security_page: 'https://www.crowdstrike.com/resources/reports/',
    gap_categories: ['security', 'identity'],
  },
  {
    vendor: 'Okta',
    tags: ['okta'],
    security_page: 'https://www.okta.com/security/',
    gap_categories: ['identity'],
  },
  {
    vendor: 'AWS',
    tags: ['aws', 'amazon'],
    security_page: 'https://aws.amazon.com/security/',
    gap_categories: ['cloud infrastructure', 'security'],
  },
  {
    vendor: 'Microsoft',
    tags: ['microsoft', 'azure', 'microsoft365'],
    security_page: 'https://www.microsoft.com/en-us/trust-center/security',
    gap_categories: ['cloud infrastructure', 'identity', 'governance'],
  },
  {
    vendor: 'Google Cloud',
    tags: ['google', 'gcp', 'google cloud'],
    security_page: 'https://cloud.google.com/security',
    gap_categories: ['cloud infrastructure', 'security'],
  },
  {
    vendor: 'Atlassian',
    tags: ['atlassian', 'jira', 'confluence'],
    security_page: 'https://www.atlassian.com/trust',
    gap_categories: ['governance', 'operational maturity'],
  },
  {
    vendor: 'Palo Alto Networks',
    tags: ['palo alto', 'paloalto'],
    security_page: 'https://www.paloaltonetworks.com/security',
    gap_categories: ['security'],
  },
  {
    vendor: 'Qualys',
    tags: ['qualys'],
    security_page: 'https://www.qualys.com/security/',
    gap_categories: ['security', 'compliance'],
  },
  {
    vendor: 'Vanta',
    tags: ['vanta'],
    security_page: 'https://www.vanta.com/resources',
    gap_categories: ['compliance', 'governance'],
  },
  {
    vendor: 'Drata',
    tags: ['drata'],
    security_page: 'https://drata.com/resources',
    gap_categories: ['compliance', 'governance'],
  },
]
```

- [ ] **Step 3: Create gaps.js**

Create `api/src/config/gaps.js`:

```js
// Research360 gap category catalog — authoritative sources per category + jurisdiction.
// Used by discovery agent gap_detection mode.

export const GAP_CATEGORIES = [
  {
    category: 'security',
    description: 'Cybersecurity frameworks, threat intelligence, vulnerability management',
    authoritative_sources: [
      { name: 'ACSC Essential Eight', url: 'https://www.cyber.gov.au/resources-business-and-government/essential-cyber-security/essential-eight', jurisdiction: 'AU' },
      { name: 'NIST CSF 2.0', url: 'https://www.nist.gov/cyberframework', jurisdiction: 'US' },
      { name: 'ISO 27001 Overview', url: 'https://www.iso.org/isoiec-27001-information-security.html', jurisdiction: 'GLOBAL' },
    ],
  },
  {
    category: 'compliance',
    description: 'Regulatory compliance, data protection, privacy law',
    authoritative_sources: [
      { name: 'OAIC Privacy Act', url: 'https://www.oaic.gov.au/privacy/australian-privacy-principles', jurisdiction: 'AU' },
      { name: 'APRA CPS 234', url: 'https://www.apra.gov.au/cps-234-information-security', jurisdiction: 'AU' },
      { name: 'GDPR Overview', url: 'https://gdpr.eu/', jurisdiction: 'EU' },
    ],
  },
  {
    category: 'governance',
    description: 'IT governance, risk management, board-level oversight',
    authoritative_sources: [
      { name: 'COBIT 2019', url: 'https://www.isaca.org/resources/cobit', jurisdiction: 'GLOBAL' },
      { name: 'ASX Corporate Governance', url: 'https://www.asx.com.au/regulation/corporate-governance-council.htm', jurisdiction: 'AU' },
    ],
  },
  {
    category: 'identity',
    description: 'Identity and access management, zero trust, MFA',
    authoritative_sources: [
      { name: 'ACSC Identity Hardening', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/system-hardening-and-administration/identity', jurisdiction: 'AU' },
      { name: 'NIST Zero Trust', url: 'https://csrc.nist.gov/publications/detail/sp/800-207/final', jurisdiction: 'US' },
    ],
  },
  {
    category: 'cloud infrastructure',
    description: 'Cloud security posture, shared responsibility, infrastructure hardening',
    authoritative_sources: [
      { name: 'ACSC Cloud Security', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/cloud-security', jurisdiction: 'AU' },
      { name: 'CSA CCM', url: 'https://cloudsecurityalliance.org/research/cloud-controls-matrix/', jurisdiction: 'GLOBAL' },
    ],
  },
  {
    category: 'operational maturity',
    description: 'Incident response, business continuity, change management',
    authoritative_sources: [
      { name: 'ACSC Incident Response', url: 'https://www.cyber.gov.au/resources-business-and-government/maintaining-devices-and-systems/incident-response', jurisdiction: 'AU' },
      { name: 'NIST SP 800-61 Rev 3', url: 'https://csrc.nist.gov/publications/detail/sp/800-61/rev-3/final', jurisdiction: 'US' },
    ],
  },
]
```

- [ ] **Step 4: Commit**

```bash
git add api/src/config/env.js api/src/config/vendors.js api/src/config/gaps.js
git commit -m "feat(discovery): add discovery config constants, vendor catalog, and gap categories"
```

---

## Task 3: URL Canonicalization Service

**Files:**
- Create: `api/src/services/canonicalize.js`
- Create: `api/tests/unit/canonicalize.test.js`
- Modify: nothing

- [ ] **Step 1: Write failing tests**

Create `api/tests/unit/canonicalize.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { canonicalizeUrl } from '../../src/services/canonicalize.js'

describe('canonicalizeUrl', () => {
  it('lowercases scheme and host', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/path')).toBe('https://example.com/path')
  })

  it('removes trailing slash', () => {
    expect(canonicalizeUrl('https://example.com/page/')).toBe('https://example.com/page')
  })

  it('preserves root path without trailing slash', () => {
    // Root URL: no trailing slash added/removed
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('removes utm_source tracking param', () => {
    expect(canonicalizeUrl('https://example.com/page?utm_source=twitter')).toBe('https://example.com/page')
  })

  it('removes multiple tracking params, preserves non-tracking', () => {
    expect(
      canonicalizeUrl('https://example.com/page?id=123&utm_medium=email&ref=foo&q=bar')
    ).toBe('https://example.com/page?id=123&q=bar')
  })

  it('strips fragments', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe('https://example.com/page')
  })

  it('handles all tracking params', () => {
    const url = 'https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&ref=x&source=y&fbclid=z&gclid=w'
    expect(canonicalizeUrl(url)).toBe('https://example.com/')
  })

  it('throws on invalid URL', () => {
    expect(() => canonicalizeUrl('not-a-url')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd api && npx vitest run tests/unit/canonicalize.test.js
```

Expected: FAIL — `Cannot find module '../../src/services/canonicalize.js'`

- [ ] **Step 3: Implement canonicalize.js**

Create `api/src/services/canonicalize.js`:

```js
import { pool } from '../db/client.js'
import { config } from '../config/env.js'

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'fbclid', 'gclid', 'msclkid', 'mc_eid',
])

/**
 * Normalize a URL: lowercase scheme+host, strip tracking params and fragments,
 * remove trailing slash (except root).
 *
 * @param {string} rawUrl
 * @returns {string} canonical URL
 * @throws if rawUrl is not a valid URL
 */
export function canonicalizeUrl(rawUrl) {
  const u = new URL(rawUrl) // throws on invalid input

  // Lowercase scheme + host
  u.hostname = u.hostname.toLowerCase()
  u.protocol = u.protocol.toLowerCase()

  // Strip fragment
  u.hash = ''

  // Remove tracking params
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      u.searchParams.delete(key)
    }
  }

  // Remove trailing slash (except root path)
  let href = u.toString()
  if (href.endsWith('/') && u.pathname !== '/') {
    href = href.slice(0, -1)
  }

  return href
}

/**
 * Extract the source_domain from a URL.
 * @param {string} url
 * @returns {string}
 */
export function sourceDomain(url) {
  return new URL(url).hostname.toLowerCase()
}

/**
 * Check if a canonical URL already exists in chunks or in a recent discovery run.
 * Returns true if the candidate should be DISCARDED.
 *
 * @param {string} canonicalUrl
 * @param {string[]} vendorTags
 * @param {string[]} frameworkTags
 * @param {string} sourceDomain
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(canonicalUrl, vendorTags, frameworkTags, srcDomain) {
  const lookbackDays = config.DEDUPE_LOOKBACK_DAYS

  // Rule 1: canonical_url already in chunks
  const chunksResult = await pool.query(
    `SELECT 1 FROM chunks WHERE canonical_url = $1 LIMIT 1`,
    [canonicalUrl]
  )
  if (chunksResult.rowCount > 0) return true

  // Rule 2: canonical_url in discovery_candidates (pending/approved/ingested) within lookback
  const dcResult = await pool.query(
    `SELECT 1 FROM discovery_candidates
     WHERE canonical_url = $1
       AND status IN ('pending', 'approved', 'ingested')
       AND generated_at >= NOW() - ($2 || ' days')::INTERVAL
     LIMIT 1`,
    [canonicalUrl, lookbackDays]
  )
  if (dcResult.rowCount > 0) return true

  // Rule 3: same vendor_tags + framework_tags + source_domain combo within lookback
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd api && npx vitest run tests/unit/canonicalize.test.js
```

Expected: all 8 tests PASS. (`isDuplicate` is not tested here as it requires a DB — that's integration territory.)

- [ ] **Step 5: Commit**

```bash
git add api/src/services/canonicalize.js api/tests/unit/canonicalize.test.js
git commit -m "feat(discovery): add URL canonicalization service with unit tests"
```

---

## Task 4: Manifest Validator

**Files:**
- Create: `api/src/services/manifest-validator.js`
- Create: `api/tests/unit/manifest-validator.test.js`

- [ ] **Step 1: Write failing tests**

Create `api/tests/unit/manifest-validator.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { validateManifest } from '../../src/services/manifest-validator.js'

const VALID_CANDIDATE = {
  url: 'https://www.cyber.gov.au/resources',
  source_type: 'url',
  source_tier: 1,
  source_domain: 'cyber.gov.au',
  jurisdiction: 'AU',
  framework_tags: ['essential-eight'],
  vendor_tags: [],
  discovery_mode: 'gap_detection',
  justification: 'Adds Essential Eight guidance missing from corpus',
  confidence: 0.92,
}

describe('validateManifest', () => {
  it('accepts a valid candidate array', () => {
    const result = validateManifest(JSON.stringify([VALID_CANDIDATE]))
    expect(result.ok).toBe(true)
    expect(result.candidates).toHaveLength(1)
  })

  it('rejects non-array JSON', () => {
    const result = validateManifest(JSON.stringify({ url: 'https://example.com' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/array/)
  })

  it('rejects invalid JSON', () => {
    const result = validateManifest('not json {{{')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/JSON/)
  })

  it('rejects candidate missing required field', () => {
    const bad = { ...VALID_CANDIDATE }
    delete bad.justification
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.ok).toBe(true)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toMatch(/justification/)
  })

  it('rejects confidence out of range', () => {
    const bad = { ...VALID_CANDIDATE, confidence: 1.5 }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/confidence/)
  })

  it('rejects invalid jurisdiction', () => {
    const bad = { ...VALID_CANDIDATE, jurisdiction: 'NZ' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/jurisdiction/)
  })

  it('rejects invalid source_tier', () => {
    const bad = { ...VALID_CANDIDATE, source_tier: 5 }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/source_tier/)
  })

  it('rejects invalid discovery_mode', () => {
    const bad = { ...VALID_CANDIDATE, discovery_mode: 'random' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/discovery_mode/)
  })

  it('rejects invalid URL', () => {
    const bad = { ...VALID_CANDIDATE, url: 'not-a-url' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/url/)
  })

  it('accepts multiple candidates, rejects bad ones individually', () => {
    const bad = { ...VALID_CANDIDATE, confidence: -1 }
    const result = validateManifest(JSON.stringify([VALID_CANDIDATE, bad]))
    expect(result.candidates).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd api && npx vitest run tests/unit/manifest-validator.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement manifest-validator.js**

Create `api/src/services/manifest-validator.js`:

```js
const REQUIRED_FIELDS = [
  'url', 'source_type', 'source_tier', 'source_domain',
  'jurisdiction', 'framework_tags', 'vendor_tags',
  'discovery_mode', 'justification', 'confidence',
]

const VALID_SOURCE_TYPES   = new Set(['url', 'document', 'api_feed'])
const VALID_SOURCE_TIERS   = new Set([1, 2, 3])
const VALID_JURISDICTIONS  = new Set(['AU', 'US', 'EU', 'GLOBAL'])
const VALID_MODES          = new Set(['gap_detection', 'vendor_staleness', 'horizon_scan'])

function validateCandidate(raw) {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      return { ok: false, reason: `Missing required field: ${field}` }
    }
  }

  // URL validity
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
 *
 * @param {string} rawJson  - Raw string from Claude response
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd api && npx vitest run tests/unit/manifest-validator.test.js
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/manifest-validator.js api/tests/unit/manifest-validator.test.js
git commit -m "feat(discovery): add manifest validator with unit tests"
```

---

## Task 5: Coverage Summary Service

**Files:**
- Create: `api/src/services/coverage-summary.js`

No unit test — this is a thin query layer over live DB. Verify manually.

- [ ] **Step 1: Implement coverage-summary.js**

Create `api/src/services/coverage-summary.js`:

```js
import { pool } from '../db/client.js'
import { config } from '../config/env.js'

const THIN_THRESHOLD = 50

/**
 * Generate a structured snapshot of corpus coverage.
 * Called once per discovery run — output is passed directly to Claude.
 *
 * @returns {Promise<CoverageSummary>}
 */
export async function buildCoverageSummary() {
  const [totals, byFramework, byVendor, byJurisdiction, thinAreasResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)                                       AS chunks,
        COUNT(DISTINCT UNNEST(framework_tags))         AS frameworks_covered,
        COUNT(DISTINCT UNNEST(vendor_tags))            AS vendors_covered
      FROM chunks
      WHERE framework_tags IS NOT NULL OR vendor_tags IS NOT NULL
    `),
    pool.query(`
      SELECT
        tag,
        COUNT(*)                                                        AS chunk_count,
        MAX(last_validated)::TEXT                                       AS freshest,
        MIN(last_validated)::TEXT                                       AS stalest
      FROM chunks, UNNEST(framework_tags) AS tag
      GROUP BY tag
      ORDER BY chunk_count DESC
    `),
    pool.query(`
      SELECT
        tag,
        COUNT(*)                                                        AS chunk_count,
        MAX(last_validated)::TEXT                                       AS freshest,
        EXTRACT(DAY FROM NOW() - MAX(last_validated))::INTEGER         AS days_since_latest
      FROM chunks, UNNEST(vendor_tags) AS tag
      GROUP BY tag
      ORDER BY days_since_latest DESC
    `),
    pool.query(`
      SELECT
        COALESCE(jurisdiction, 'GLOBAL')              AS jurisdiction,
        COUNT(*)                                       AS chunk_count
      FROM chunks
      GROUP BY jurisdiction
      ORDER BY chunk_count DESC
    `),
    // thin_areas: actual per framework+jurisdiction combos below threshold
    pool.query(`
      SELECT
        fw_tag                                        AS framework,
        COALESCE(jurisdiction, 'GLOBAL')              AS jurisdiction,
        COUNT(*)::INTEGER                             AS chunk_count
      FROM chunks, UNNEST(framework_tags) AS fw_tag
      GROUP BY fw_tag, jurisdiction
      HAVING COUNT(*) < $1
      ORDER BY chunk_count ASC
    `, [THIN_THRESHOLD]),
  ])

  const staleVendors = byVendor.rows.filter(
    v => v.days_since_latest >= config.VENDOR_STALENESS_DAYS
  )

  return {
    totals: {
      chunks:             parseInt(totals.rows[0]?.chunks || 0),
      vendors_covered:    parseInt(totals.rows[0]?.vendors_covered || 0),
      frameworks_covered: parseInt(totals.rows[0]?.frameworks_covered || 0),
    },
    coverage_by_framework: byFramework.rows.map(r => ({
      tag:         r.tag,
      chunk_count: parseInt(r.chunk_count),
      freshest:    r.freshest,
      stalest:     r.stalest,
    })),
    coverage_by_vendor: byVendor.rows.map(r => ({
      tag:              r.tag,
      chunk_count:      parseInt(r.chunk_count),
      freshest:         r.freshest,
      days_since_latest: r.days_since_latest,
    })),
    coverage_by_jurisdiction: byJurisdiction.rows.map(r => ({
      jurisdiction: r.jurisdiction,
      chunk_count:  parseInt(r.chunk_count),
    })),
    stale_vendors: staleVendors.map(r => ({
      vendor:            r.tag,
      days_since_latest: r.days_since_latest,
    })),
    thin_areas: thinAreasResult.rows,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/services/coverage-summary.js
git commit -m "feat(discovery): add coverage summary service"
```

---

## Task 6: Feed Poller

**Files:**
- Create: `api/src/services/feed-poller.js`

No unit tests — all logic is HTTP I/O. Verify by running locally with `ENABLE_FEED_POLLING=true`.

- [ ] **Step 1: Implement feed-poller.js**

Create `api/src/services/feed-poller.js`:

```js
import { config } from '../config/env.js'

const SEED_FEEDS = [
  {
    name: 'CISA KEV',
    url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'NVD CVE',
    url: 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
  },
  {
    name: 'ACSC Alerts',
    url: 'https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  {
    name: 'OAIC Breach Register',
    url: 'https://www.oaic.gov.au/privacy/notifiable-data-breaches/notifiable-data-breaches-register',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
  },
  {
    name: 'NIST Cybersecurity News',
    url: 'https://www.nist.gov/news-events/cybersecurity',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
  },
]

/**
 * Poll all seed feeds + vendor security pages.
 * Returns a flat list of raw feed items plus run metrics.
 * Never throws — partial failure is valid.
 *
 * @param {Array} vendors  - from config/vendors.js VENDORS
 * @returns {Promise<{ items: FeedItem[], polled: number, failures: number }>}
 */
export async function pollFeeds(vendors) {
  const lookbackMs = config.HORIZON_LOOKBACK_HOURS * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - lookbackMs)

  const allFeeds = [
    ...SEED_FEEDS,
    ...vendors.map(v => ({
      name: `${v.vendor} Security`,
      url: v.security_page,
      type: 'url',
      tier: 2,
      jurisdiction: 'GLOBAL',
    })),
  ]

  const items = []
  let polled = 0
  let failures = 0

  await Promise.allSettled(
    allFeeds.map(async (feed) => {
      polled++
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

        const res = await fetch(feed.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Research360-DiscoveryAgent/1.0' },
        })
        clearTimeout(timeout)

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const contentType = res.headers.get('content-type') || ''
        let content = ''

        if (contentType.includes('json')) {
          const json = await res.json()
          // Extract text summary from known API shapes
          if (Array.isArray(json?.vulnerabilities)) {
            content = json.vulnerabilities.slice(0, 10).map(v =>
              `CVE: ${v.cve?.id} — ${v.cve?.descriptions?.[0]?.value || ''}`
            ).join('\n')
          } else if (Array.isArray(json?.catalogVersion !== undefined && json.vulnerabilities)) {
            // CISA KEV shape
            content = (json.vulnerabilities || []).slice(0, 10).map(v =>
              `${v.cveID}: ${v.vulnerabilityName}`
            ).join('\n')
          } else {
            content = JSON.stringify(json).slice(0, 2000)
          }
        } else {
          // HTML — grab first 3000 chars as plain signal
          content = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
        }

        items.push({
          feed_name:   feed.name,
          feed_url:    feed.url,
          source_type: feed.type,
          source_tier: feed.tier,
          jurisdiction: feed.jurisdiction,
          content,
          fetched_at:  new Date().toISOString(),
        })
      } catch (err) {
        failures++
        console.log(JSON.stringify({ stage: 'feed_poller', feed: feed.name, error: err.message }))
      }
    })
  )

  return { items, polled, failures }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/services/feed-poller.js
git commit -m "feat(discovery): add feed poller with partial failure tolerance"
```

---

## Task 7: Discovery Worker

**Files:**
- Create: `api/src/workers/discovery-worker.js`

This is the main orchestrator. It reads from the `discovery` queue and runs a full discovery pass.

- [ ] **Step 1: Implement discovery-worker.js**

Create `api/src/workers/discovery-worker.js`:

```js
import Anthropic from '@anthropic-ai/sdk'
import { Worker } from 'bullmq'
import { randomUUID } from 'crypto'
import { redis } from '../queue/client.js'
import { pool } from '../db/client.js'
import { config } from '../config/env.js'
import { VENDORS } from '../config/vendors.js'
import { GAP_CATEGORIES } from '../config/gaps.js'
import { buildCoverageSummary } from '../services/coverage-summary.js'
import { pollFeeds } from '../services/feed-poller.js'
import { validateManifest } from '../services/manifest-validator.js'
import { canonicalizeUrl, sourceDomain, isDuplicate } from '../services/canonicalize.js'

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildPrompt(coverageSummary, vendorCatalog, feedItems) {
  return `You are the Research360 Discovery Agent for Proof360, a trust intelligence platform for Australian founders and SMEs.

Your job is to identify what the corpus is missing that would materially improve vendor recommendations across these gap categories: security, compliance, governance, identity, cloud infrastructure, and operational maturity.

CONFIDENCE DEFINITION:
confidence = your confidence that ingesting this URL will materially improve Research360 corpus quality for Proof360 vendor recommendations. Score on utility to the corpus, not general importance.

You will receive:
1. corpus_summary — current corpus coverage (what exists, how fresh, what is thin)
2. vendor_catalog — vendors currently in the Proof360 recommendation engine
3. feed_items — recent items from monitored sources (last ${config.HORIZON_LOOKBACK_HOURS} hours)

<corpus_summary>
${JSON.stringify(coverageSummary, null, 2)}
</corpus_summary>

<vendor_catalog>
${JSON.stringify(vendorCatalog, null, 2)}
</vendor_catalog>

<feed_items>
${JSON.stringify(feedItems.slice(0, 20), null, 2)}
</feed_items>

Your task across three modes:

GAP DETECTION (max ${config.DISCOVERY_MAX_GAP} candidates):
- Identify frameworks or compliance areas with thin coverage (see thin_areas)
- Identify jurisdictions under-represented relative to AU-first mandate
- Generate candidate URLs for authoritative sources on those gaps

VENDOR STALENESS (max ${config.DISCOVERY_MAX_STALENESS} candidates):
- For each vendor in stale_vendors, find their current trust/security page
- Prioritise vendors with highest gap_category relevance in Proof360

HORIZON SCAN (max ${config.DISCOVERY_MAX_HORIZON} candidates):
- From feed_items, identify emerging threats or frameworks not yet in corpus
- Only surface items where the same topic appears in 2+ feed sources
- Candidate URL should be the primary source page, not the feed item itself

RULES:
- Prioritise AU jurisdiction sources
- Prioritise Tier 1 (authoritative framework/gov) over Tier 2 (vendor) over Tier 3
- Maximum ${config.DISCOVERY_MAX_CANDIDATES} candidates total across all modes
- Do not surface URLs likely to be paywalled
- Justification must be one sentence anchored to corpus utility

Respond ONLY with a valid JSON array. No preamble. No markdown. No explanation.

Schema per candidate:
{
  "url": string,
  "source_type": "url" | "document" | "api_feed",
  "source_tier": 1 | 2 | 3,
  "source_domain": string,
  "jurisdiction": "AU" | "US" | "EU" | "GLOBAL",
  "framework_tags": string[],
  "vendor_tags": string[],
  "discovery_mode": "gap_detection" | "vendor_staleness" | "horizon_scan",
  "justification": string,
  "confidence": number
}`
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function createRun() {
  const res = await pool.query(
    `INSERT INTO discovery_runs (run_id) VALUES ($1) RETURNING *`,
    [randomUUID()]
  )
  return res.rows[0]
}

async function finalizeRun(runId, metrics) {
  await pool.query(
    `UPDATE discovery_runs SET
       completed_at               = NOW(),
       status                     = $2,
       candidates_generated       = $3,
       candidates_inserted        = $4,
       candidates_auto_ingested   = $5,
       candidates_pending_review  = $6,
       candidates_rejected_dedupe = $7,
       feed_sources_polled        = $8,
       feed_source_failures       = $9,
       claude_latency_ms          = $10,
       total_run_duration_ms      = $11,
       error_message              = $12
     WHERE run_id = $1`,
    [
      runId,
      metrics.error ? 'failed' : 'completed',
      metrics.candidates_generated,
      metrics.candidates_inserted,
      metrics.candidates_auto_ingested,
      metrics.candidates_pending_review,
      metrics.candidates_rejected_dedupe,
      metrics.feed_sources_polled,
      metrics.feed_source_failures,
      metrics.claude_latency_ms,
      metrics.total_run_duration_ms,
      metrics.error || null,
    ]
  )
}

async function insertCandidate(runId, candidate, canonical, autoIngest) {
  const res = await pool.query(
    `INSERT INTO discovery_candidates (
       run_id, url, canonical_url, source_domain, source_feed,
       source_type, source_tier, jurisdiction, framework_tags, vendor_tags,
       discovery_mode, justification, confidence, auto_ingest, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING candidate_id`,
    [
      runId,
      candidate.url,
      canonical,
      candidate.source_domain,
      null,
      candidate.source_type,
      candidate.source_tier,
      candidate.jurisdiction,
      candidate.framework_tags,
      candidate.vendor_tags,
      candidate.discovery_mode,
      candidate.justification,
      candidate.confidence,
      autoIngest,
      autoIngest ? 'approved' : 'pending',
    ]
  )
  return res.rows[0].candidate_id
}

async function autoIngestCandidate(candidateId, url) {
  try {
    const res = await fetch(`http://localhost:${config.PORT}/research360/ingest/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        title: null,
        tenant_id: 'ethikslabs',
      }),
    })
    if (!res.ok) throw new Error(`Ingest API returned ${res.status}`)
    const body = await res.json()
    // Write ingest_job_id back to candidate
    await pool.query(
      `UPDATE discovery_candidates SET ingest_job_id = $1, actioned_at = NOW() WHERE candidate_id = $2`,
      [body.document_id, candidateId]
    )
    return true
  } catch (err) {
    console.log(JSON.stringify({ stage: 'auto_ingest', candidate_id: candidateId, error: err.message }))
    return false
  }
}

// ── Main worker function ──────────────────────────────────────────────────────

async function runDiscovery() {
  const startMs = Date.now()
  const run = await createRun()
  const runId = run.run_id

  const metrics = {
    candidates_generated: 0,
    candidates_inserted: 0,
    candidates_auto_ingested: 0,
    candidates_pending_review: 0,
    candidates_rejected_dedupe: 0,
    feed_sources_polled: 0,
    feed_source_failures: 0,
    claude_latency_ms: 0,
    total_run_duration_ms: 0,
    error: null,
  }

  try {
    console.log(JSON.stringify({ stage: 'discovery_start', run_id: runId, timestamp: new Date().toISOString() }))

    // 1. Gather context
    const [coverageSummary, { items: feedItems, polled, failures }] = await Promise.all([
      buildCoverageSummary(),
      pollFeeds(VENDORS),
    ])

    metrics.feed_sources_polled = polled
    metrics.feed_source_failures = failures

    // 2. Call Claude
    const prompt = buildPrompt(coverageSummary, GAP_CATEGORIES, feedItems)
    const claudeStart = Date.now()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    metrics.claude_latency_ms = Date.now() - claudeStart
    const rawJson = message.content[0]?.text || '[]'

    // 3. Validate manifest
    const { ok, candidates, rejected, error: parseError } = validateManifest(rawJson)

    if (!ok) {
      metrics.error = `Manifest validation failed: ${parseError}`
      await finalizeRun(runId, { ...metrics, total_run_duration_ms: Date.now() - startMs })
      return
    }

    // Enforce hard candidate budget (Claude may exceed it despite instructions)
    const cappedCandidates = candidates.slice(0, config.DISCOVERY_MAX_CANDIDATES)

    console.log(JSON.stringify({
      stage: 'discovery_claude_complete',
      run_id: runId,
      candidates_raw: candidates.length,
      candidates_capped: cappedCandidates.length,
      rejected_schema: rejected.length,
    }))

    metrics.candidates_generated = cappedCandidates.length
    const candidatesToProcess = cappedCandidates

    // 4. Dedupe + insert
    // Note: candidatesToProcess already capped at DISCOVERY_MAX_CANDIDATES
    // Note: autoIngestCandidate uses localhost HTTP — safe because BullMQ jobs
    // only process AFTER app.listen() completes in start(), so the server
    // is always up when a job runs.
    for (const candidate of candidatesToProcess) {
      let canonical
      try {
        canonical = canonicalizeUrl(candidate.url)
      } catch {
        metrics.candidates_rejected_dedupe++
        continue
      }

      const domain = sourceDomain(canonical)
      const dup = await isDuplicate(canonical, candidate.vendor_tags, candidate.framework_tags, domain)
      if (dup) {
        metrics.candidates_rejected_dedupe++
        continue
      }

      const autoIngest = candidate.confidence >= config.AUTO_INGEST_THRESHOLD
      const aboveReview = candidate.confidence >= config.REVIEW_THRESHOLD

      // Discard if below review threshold
      if (!aboveReview) {
        metrics.candidates_rejected_dedupe++ // counts as filtered
        continue
      }

      const candidateId = await insertCandidate(runId, candidate, canonical, autoIngest)
      metrics.candidates_inserted++

      if (autoIngest) {
        const ingested = await autoIngestCandidate(candidateId, canonical)
        if (ingested) {
          metrics.candidates_auto_ingested++
          await pool.query(
            `UPDATE discovery_candidates SET status = 'ingested' WHERE candidate_id = $1`,
            [candidateId]
          )
        }
      } else {
        metrics.candidates_pending_review++
      }
    }

  } catch (err) {
    metrics.error = err.message
    console.log(JSON.stringify({ stage: 'discovery_error', run_id: runId, error: err.message }))
  }

  metrics.total_run_duration_ms = Date.now() - startMs
  await finalizeRun(runId, metrics)

  console.log(JSON.stringify({ stage: 'discovery_complete', run_id: runId, ...metrics }))
}

// ── BullMQ worker export ──────────────────────────────────────────────────────

export function startDiscoveryWorker() {
  const worker = new Worker('discovery', async (job) => {
    await runDiscovery()
  }, {
    connection: redis,
    concurrency: 1, // never run two discovery passes simultaneously
  })

  worker.on('failed', (job, err) => {
    console.log(JSON.stringify({ stage: 'discovery_worker_failed', error: err.message }))
  })

  return worker
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/workers/discovery-worker.js
git commit -m "feat(discovery): add discovery worker — Claude Sonnet reasoning, dedupe, auto-ingest"
```

---

## Task 8: Discovery Queue + Nightly Scheduler

**Files:**
- Modify: `api/src/queue/client.js` — add `discovery` queue
- Modify: `api/src/app.js` — register worker + schedule nightly job

- [ ] **Step 1: Add discovery queue to client.js**

In `api/src/queue/client.js`, add `discovery` to the `queues` object:

```js
// Add to the queues object:
discovery: new Queue('discovery', { connection: redis }),
```

- [ ] **Step 2: Wire worker + scheduler into app.js**

In `api/src/app.js`:

Add import at top:
```js
import { startDiscoveryWorker } from './workers/discovery-worker.js'
import discoveryRoutes from './routes/discovery.js'
import { queues } from './queue/client.js'
```

Add route registration:
```js
app.register(discoveryRoutes)
```

In the `start()` function, after the existing worker starts, add:
```js
startDiscoveryWorker()

// Schedule nightly discovery run at 02:00 local time
await queues.discovery.add(
  'nightly',
  { trigger: 'scheduled' },
  {
    repeat: { cron: '0 2 * * *' },
    jobId: 'discovery-nightly', // stable ID prevents duplicate schedules on restart
  }
)
console.log(JSON.stringify({ stage: 'discovery_scheduler', status: 'scheduled', cron: '0 2 * * *' }))
```

- [ ] **Step 3: Commit**

```bash
git add api/src/queue/client.js api/src/app.js
git commit -m "feat(discovery): add discovery queue and nightly BullMQ scheduler"
```

---

## Task 9: Discovery Review Routes

**Files:**
- Create: `api/src/routes/discovery.js`

- [ ] **Step 1: Implement discovery.js routes**

Create `api/src/routes/discovery.js`:

```js
import { pool } from '../db/client.js'
import { config } from '../config/env.js'
import { queues } from '../queue/client.js'

const DEFAULT_TENANT = 'ethikslabs'

export default async function discoveryRoutes(app) {

  // List pending candidates for human review
  app.get('/api/discovery/pending', async (request, reply) => {
    const res = await pool.query(`
      SELECT
        candidate_id, run_id, url, canonical_url, source_domain,
        source_type, source_tier, jurisdiction, framework_tags, vendor_tags,
        discovery_mode, justification, confidence, generated_at
      FROM discovery_candidates
      WHERE status = 'pending'
      ORDER BY confidence DESC, generated_at DESC
    `)
    return reply.send({ candidates: res.rows })
  })

  // List recent discovery run summaries
  app.get('/api/discovery/runs', async (request, reply) => {
    const res = await pool.query(`
      SELECT *
      FROM discovery_runs
      ORDER BY started_at DESC
      LIMIT 20
    `)
    return reply.send({ runs: res.rows })
  })

  // Approve a candidate — immediately queue for ingest
  app.post('/api/discovery/:id/approve', async (request, reply) => {
    const { id } = request.params

    const candidate = await pool.query(
      `SELECT * FROM discovery_candidates WHERE candidate_id = $1 AND status = 'pending'`,
      [id]
    )

    if (candidate.rowCount === 0) {
      return reply.status(404).send({ error: 'Candidate not found or not pending', code: 'NOT_FOUND' })
    }

    const c = candidate.rows[0]

    // POST to ingest
    try {
      const res = await fetch(`http://localhost:${config.PORT}/research360/ingest/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: c.canonical_url, title: null, tenant_id: DEFAULT_TENANT }),
      })

      if (!res.ok) throw new Error(`Ingest API returned ${res.status}`)
      const body = await res.json()

      await pool.query(
        `UPDATE discovery_candidates
         SET status = 'ingested', ingest_job_id = $1, actioned_at = NOW()
         WHERE candidate_id = $2`,
        [body.document_id, id]
      )

      return reply.send({ candidate_id: id, status: 'ingested', document_id: body.document_id })
    } catch (err) {
      return reply.status(500).send({ error: `Ingest failed: ${err.message}`, code: 'INGEST_FAILED' })
    }
  })

  // Reject a candidate
  app.post('/api/discovery/:id/reject', async (request, reply) => {
    const { id } = request.params
    const { reason } = request.body || {}

    if (!reason?.trim()) {
      return reply.status(400).send({ error: 'reason is required', code: 'MISSING_REASON' })
    }

    const res = await pool.query(
      `UPDATE discovery_candidates
       SET status = 'rejected', review_reason = $1, actioned_at = NOW()
       WHERE candidate_id = $2 AND status = 'pending'
       RETURNING candidate_id`,
      [reason, id]
    )

    if (res.rowCount === 0) {
      return reply.status(404).send({ error: 'Candidate not found or not pending', code: 'NOT_FOUND' })
    }

    return reply.send({ candidate_id: id, status: 'rejected' })
  })

  // Trigger a manual discovery run (useful for testing)
  app.post('/api/discovery/run', async (request, reply) => {
    await queues.discovery.add('manual', { trigger: 'manual' })
    return reply.send({ status: 'queued', message: 'Discovery run queued' })
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/routes/discovery.js
git commit -m "feat(discovery): add review queue endpoints (pending, approve, reject, manual trigger)"
```

---

## Task 10: Integration Verification

No new files. Verify the full stack wires up correctly.

- [ ] **Step 1: Run full test suite**

```bash
cd api && npm test
```

Expected: all unit tests pass. (No integration tests — those require live DB.)

- [ ] **Step 2: Start the API and verify worker starts**

```bash
cd api && node src/app.js
```

Look for these log lines on startup:
```
{ stage: 'discovery_scheduler', status: 'scheduled', cron: '0 2 * * *' }
```

- [ ] **Step 3: Trigger a manual run and observe logs**

In a second terminal:
```bash
curl -X POST http://localhost:3000/api/discovery/run
```

Expected response: `{ "status": "queued", "message": "Discovery run queued" }`

Watch logs for:
```
{ stage: 'discovery_start', run_id: '...', ... }
{ stage: 'discovery_claude_complete', run_id: '...', candidates_raw: N, ... }
{ stage: 'discovery_complete', run_id: '...', ... }
```

- [ ] **Step 4: Verify DB records**

```bash
psql $DATABASE_URL -c "SELECT run_id, status, candidates_inserted, candidates_pending_review, total_run_duration_ms FROM discovery_runs ORDER BY started_at DESC LIMIT 1;"
psql $DATABASE_URL -c "SELECT candidate_id, url, confidence, status, discovery_mode FROM discovery_candidates ORDER BY generated_at DESC LIMIT 10;"
```

- [ ] **Step 5: Test review queue endpoints**

```bash
# List pending candidates
curl http://localhost:3000/api/discovery/pending

# Approve one (replace UUID with actual)
curl -X POST http://localhost:3000/api/discovery/<candidate_id>/approve

# Reject one
curl -X POST http://localhost:3000/api/discovery/<candidate_id>/reject \
  -H "Content-Type: application/json" \
  -d '{"reason": "out of scope for current corpus focus"}'

# List runs
curl http://localhost:3000/api/discovery/runs
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(discovery): wire discovery agent — all components integrated"
```

---

## Summary of All New/Modified Files

```
api/src/db/migrations/004_discovery_agent.sql  ← new
api/src/config/vendors.js                      ← new
api/src/config/gaps.js                         ← new
api/src/services/canonicalize.js               ← new
api/src/services/coverage-summary.js           ← new
api/src/services/feed-poller.js                ← new
api/src/services/manifest-validator.js         ← new
api/src/workers/discovery-worker.js            ← new
api/src/routes/discovery.js                    ← new
api/tests/unit/canonicalize.test.js            ← new
api/tests/unit/manifest-validator.test.js      ← new
api/src/config/env.js                          ← modified (discovery constants)
api/src/queue/client.js                        ← modified (discovery queue)
api/src/app.js                                 ← modified (routes + worker + scheduler)
```
