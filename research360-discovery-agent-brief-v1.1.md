# Research360 — Discovery Agent Brief v1.1

**For:** Kiro  
**From:** John  
**Phase:** Build  
**Status:** Ready  

---

## Context

Research360 has a working ingestion pipeline: Playwright for URLs, Unstructured.io for documents, yt-dlp + Whisper for video/audio, BullMQ workers for each stage, pgvector for embeddings.

The existing pipeline is manually fed. This brief defines the **Discovery Agent** — the autonomous layer that keeps the corpus alive, current, and self-expanding without manual input.

---

## Core Principle

The discovery agent is advisory-first: every surfaced URL must be traceable, deduplicated, schema-validated, and auditable before entering the ingestion pipeline.

---

## What the Discovery Agent Does

Answers one question on a schedule: **"What does this corpus not know that it should?"**

Three operating modes, each with a hard candidate budget per run:

| Mode | Job | Max candidates |
|------|-----|---------------|
| `gap_detection` | Reasons over corpus coverage, finds thin or missing categories | 8 |
| `vendor_staleness` | Identifies vendors with no recent corpus entries | 6 |
| `horizon_scan` | Monitors trusted feeds for emerging threats/frameworks not yet ingested | 6 |

Total per run: **20 candidates maximum**.

---

## Configuration Constants

Do not bury these in prompt text or worker logic. Define as env/config:

```
AUTO_INGEST_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.60
DISCARD_THRESHOLD = 0.60
VENDOR_STALENESS_DAYS = 30
HORIZON_LOOKBACK_HOURS = 24
DISCOVERY_MAX_CANDIDATES = 20
DISCOVERY_MAX_GAP = 8
DISCOVERY_MAX_STALENESS = 6
DISCOVERY_MAX_HORIZON = 6
DEDUPE_LOOKBACK_DAYS = 30
```

---

## Architecture

### New Components

```
research360/
├── api/src/
│   ├── workers/
│   │   ├── discovery-worker.ts       ← Claude Sonnet-powered, nightly
│   │   └── feed-poller.ts            ← collects raw feed items
│   ├── services/
│   │   ├── coverage-summary.ts       ← runtime corpus snapshot
│   │   ├── canonicalize.ts           ← URL canonicalization + dedupe
│   │   └── manifest-validator.ts     ← schema validation before insert
│   └── routes/
│       └── discovery.ts              ← review queue endpoints
└── db/
    └── migrations/
        └── 004_discovery_agent.sql
```

### Flow

```
BullMQ nightly job
      ↓
feed-poller → raw feed items (RSS, JSON APIs)
      ↓
discovery-worker
  ├── coverage-summary.ts → curated corpus snapshot
  ├── vendors.js + gaps.js → vendor/gap catalog
  └── raw feed items → horizon context
      ↓
Claude Sonnet → raw candidate JSON
      ↓
manifest-validator → schema validation
      ↓
canonicalize + dedupe → discard duplicates
      ↓
discovery_candidates table
  ├── confidence >= 0.85 → auto_ingest = true → POST /api/ingest
  └── 0.60–0.85 → pending → review queue
      ↓
Existing pipeline (extract → transform → chunk → embed)
```

**Important:** Feed items are not candidates. `feed-poller` collects raw items. `discovery-worker` transforms them into ingestable candidate URLs. Only candidate URLs enter `discovery_candidates`.

---

## Database Schema

### Migration: `004_discovery_agent.sql`

```sql
-- Discovery candidates table
CREATE TABLE discovery_candidates (
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

-- Indexes
CREATE INDEX idx_discovery_candidates_status       ON discovery_candidates(status);
CREATE INDEX idx_discovery_candidates_run_id       ON discovery_candidates(run_id);
CREATE INDEX idx_discovery_candidates_canonical_url ON discovery_candidates(canonical_url);

-- Chunks schema extension
ALTER TABLE chunks ADD COLUMN source_url          TEXT;
ALTER TABLE chunks ADD COLUMN canonical_url       TEXT;
ALTER TABLE chunks ADD COLUMN source_tier         INTEGER CHECK (source_tier IN (1, 2, 3));
ALTER TABLE chunks ADD COLUMN jurisdiction        VARCHAR(10) DEFAULT 'GLOBAL';
ALTER TABLE chunks ADD COLUMN framework_tags      TEXT[] DEFAULT '{}';
ALTER TABLE chunks ADD COLUMN vendor_tags         TEXT[] DEFAULT '{}';
ALTER TABLE chunks ADD COLUMN last_validated      TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE chunks ADD COLUMN discovery_candidate_id UUID REFERENCES discovery_candidates(candidate_id);

-- Chunk indexes
CREATE INDEX idx_chunks_canonical_url    ON chunks(canonical_url);
CREATE INDEX idx_chunks_last_validated   ON chunks(last_validated);

-- Run metrics table
CREATE TABLE discovery_runs (
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
```

---

## Deduplication Rules

A candidate must be discarded if **any** of the following are true:

1. Its `canonical_url` already exists in `chunks.canonical_url`
2. An equivalent `canonical_url` exists in `discovery_candidates` with status `pending`, `approved`, or `ingested` within the last `DEDUPE_LOOKBACK_DAYS`
3. Same `vendor_tags` + `framework_tags` + `source_domain` combination exists as an active candidate within the lookback window

Dedupe must run **before** insert. Discarded candidates increment `candidates_rejected_dedupe` in run metrics but are not written to `discovery_candidates`.

### URL Canonicalization (`canonicalize.ts`)

Before any dedupe or insert, normalize all URLs:
- Lowercase scheme and host
- Remove tracking parameters (`utm_*`, `ref`, `source`, etc.)
- Remove trailing slashes
- Resolve redirects where possible
- Strip fragments (`#section`)

---

## Coverage Summary Service (`coverage-summary.ts`)

Do not pass raw SQL groupings to Claude. Generate a curated JSON summary at runtime.

**Output shape:**

```typescript
interface CoverageSummary {
  totals: {
    chunks: number;
    vendors_covered: number;
    frameworks_covered: number;
  };
  coverage_by_framework: Array<{
    tag: string;
    chunk_count: number;
    freshest: string;     // ISO timestamp
    stalest: string;      // ISO timestamp
  }>;
  coverage_by_vendor: Array<{
    tag: string;
    chunk_count: number;
    freshest: string;
    days_since_latest: number;
  }>;
  coverage_by_jurisdiction: Array<{
    jurisdiction: string;
    chunk_count: number;
  }>;
  stale_vendors: Array<{
    vendor: string;
    days_since_latest: number;
  }>;
  thin_areas: Array<{
    framework: string;
    jurisdiction: string;
    chunk_count: number;
  }>;
}
```

**Stale** = `days_since_latest >= VENDOR_STALENESS_DAYS`  
**Thin** = `chunk_count < 50` (configurable)

---

## Seed Feeds (Horizon Scanning)

```typescript
const SEED_FEEDS = [
  {
    name: 'CISA KEV',
    url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
    cadence: 'hourly'
  },
  {
    name: 'NVD CVE',
    url: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
    type: 'api_feed',
    tier: 1,
    jurisdiction: 'US',
    cadence: 'hourly'
  },
  {
    name: 'ACSC Alerts',
    url: 'https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
    cadence: 'daily'
  },
  {
    name: 'OAIC Breach Register',
    url: 'https://www.oaic.gov.au/privacy/notifiable-data-breaches/notifiable-data-breaches-register',
    type: 'url',
    tier: 1,
    jurisdiction: 'AU',
    cadence: 'daily'
  },
  {
    name: 'NIST News',
    url: 'https://www.nist.gov/news-events/cybersecurity',
    type: 'url',
    tier: 1,
    jurisdiction: 'US',
    cadence: 'daily'
  }
];
```

Vendor security blogs are added dynamically from `vendors.js` at runtime.

Feed polling failures must not fail the whole run. Partial success is valid. Log each failure to `feed_source_failures` in run metrics.

---

## Claude Prompt — Discovery Worker

```
You are the Research360 Discovery Agent for Proof360, a trust intelligence 
platform for Australian founders and SMEs.

Your job is to identify what the corpus is missing that would materially improve 
vendor recommendations across these gap categories: security, compliance, 
governance, identity, cloud infrastructure, and operational maturity.

CONFIDENCE DEFINITION:
confidence = your confidence that ingesting this URL will materially improve 
Research360 corpus quality for Proof360 vendor recommendations. Score on 
utility to the corpus, not general importance.

You will receive:
1. corpus_summary — current corpus coverage (what exists, how fresh, what is thin)
2. vendor_catalog — vendors currently in the Proof360 recommendation engine
3. feed_items — recent items from monitored sources (last 24 hours)

Your task across three modes:

GAP DETECTION (max 8 candidates):
- Identify frameworks or compliance areas with thin coverage (see thin_areas)
- Identify jurisdictions under-represented relative to AU-first mandate
- Generate candidate URLs for authoritative sources on those gaps

VENDOR STALENESS (max 6 candidates):
- For each vendor in stale_vendors, find their current trust/security page
- Prioritise vendors with highest gap_category relevance in Proof360

HORIZON SCAN (max 6 candidates):
- From feed_items, identify emerging threats or frameworks not yet in corpus
- Only surface items where the same topic appears in 2+ feed sources
- Candidate URL should be the primary source page, not the feed item itself

RULES:
- Prioritise AU jurisdiction sources
- Prioritise Tier 1 (authoritative framework/gov) over Tier 2 (vendor) over Tier 3
- Maximum 20 candidates total across all modes
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
}
```

---

## Manifest Validation (`manifest-validator.ts`)

Claude output must be validated before any insert. Reject the entire run on parse failure. Reject individual candidates on schema violation — do not silently coerce.

Validation rules:
- Must be valid JSON array
- Each candidate must have all required fields
- `confidence` must be `0.0–1.0`
- `source_tier` must be `1`, `2`, or `3`
- `jurisdiction` must be one of `AU`, `US`, `EU`, `GLOBAL`
- `url` must be a valid URL
- `discovery_mode` must be one of the three defined modes
- `justification` must be non-empty string

Log validation failures to run metrics `error_message`.

---

## Review Queue Endpoints (`discovery.ts`)

```
GET  /api/discovery/pending           — list candidates with status 'pending'
GET  /api/discovery/runs              — list recent run summaries
POST /api/discovery/:id/approve       — approve and queue for ingest
POST /api/discovery/:id/reject        — reject, requires body: { reason: string }
```

Approved candidates immediately POST to existing `/api/ingest` endpoint. `ingest_job_id` is written back to the candidate record on success.

---

## Implementation Guardrails

1. Discovery must be idempotent per `run_id`
2. Discovery must never directly ingest without first writing candidate records
3. Auto-ingest must still write full candidate record and audit trail
4. Feed polling failures must not fail the whole run
5. Claude output must be schema-validated before insert
6. All URLs must be canonicalized before dedupe or insert
7. Nightly job must emit run metrics to `discovery_runs` on completion
8. Dedupe must run before insert, never after

---

## Build Order

1. `004_discovery_agent.sql` — migrations first, everything depends on this
2. `canonicalize.ts` — URL canonicalization + dedupe utility
3. `coverage-summary.ts` — runtime corpus snapshot service
4. `feed-poller.ts` — feed polling with partial failure tolerance
5. `manifest-validator.ts` — schema validation for Claude output
6. `discovery-worker.ts` — Claude Sonnet call + manifest write + dedupe + auto-ingest handoff
7. BullMQ nightly scheduled job — wires discovery-worker on cadence
8. `discovery.ts` — review queue endpoints
9. Run metrics — emit to `discovery_runs` on job completion
10. Wire auto-approved candidates into existing `/api/ingest` endpoint

---

*EthiksLabs — Research360 v1.1*
