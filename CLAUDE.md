# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## AWS / EC2 — HARD RULES

- **Never run any command on any EC2 instance unless John has explicitly named it in the current conversation.**
- **Only touch instances tagged `Owner: ethikslabs`. If the instance does not have this tag, do not touch it under any circumstances.**
- If an SSM action is denied, STOP. Do not look for another instance. Ask John.
- Finding project files on an instance does not mean you have permission to deploy to it.
- If uncertain, ask. Never assume.

---

## Commands

### Infrastructure
```bash
# Start Postgres + Redis + MinIO (required before running the API)
docker-compose up -d

# Stop
docker-compose down
```

### API (`api/`)
```bash
npm start          # production
npm run dev        # watch mode (--watch)
npm test           # all tests (vitest)
npm run test:unit      # unit tests only
npm run test:property  # property-based tests only (fast-check)
npx vitest run tests/unit/canonicalize.test.js   # single test file
```

### Frontend (`frontend/`)
```bash
npm run dev     # Vite dev server (default port 5173)
npm run build
```

### Environment (`frontend/.env`)
```
VITE_API_URL=http://localhost:3001   # omit in prod (uses relative URLs via nginx proxy)
VITE_GOOGLE_CLIENT_ID=               # required for YouTube ingest tab (Google OAuth 2.0)
```

### Migrations
Migrations are plain SQL files — run them manually in order:
```bash
psql $DATABASE_URL -f api/src/db/migrations/001_initial.sql
psql $DATABASE_URL -f api/src/db/migrations/004_discovery_agent.sql
psql $DATABASE_URL -f api/src/db/migrations/005_provenance_engine.sql
psql $DATABASE_URL -f api/src/db/migrations/006_file_hash.sql
# New files: next sequential number, e.g. 007_*.sql
```

### Environment (`api/.env`)
Required:
```
DATABASE_URL=postgres://research360:research360@localhost:5432/research360
REDIS_URL=redis://localhost:6379
AWS_REGION=ap-southeast-2
S3_BUCKET=research360-ethikslabs
S3_ENDPOINT=http://localhost:9000   # MinIO in dev
PORT=3001
NODE_ENV=development
```
Phase 2 (workers fail without these, server still starts):
```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
UNSTRUCTURED_API_KEY=...
```

---

## Architecture

### Pipeline

Documents and URLs enter via the ingest routes, are uploaded to S3, then processed through four sequential BullMQ workers:

```
POST /research360/ingest/file   (PDF, DOCX, PPTX — 50MB limit; SHA-256 dedup rejects duplicates with 409)
POST /research360/ingest/url    (any URL; youtube.com/youtu.be URLs auto-tagged source_type=youtube)
  → s3Service.upload()
  → enqueue(CONTENT_UPLOADED)
    → extractionWorker  (text → { text, extraction_confidence, extraction_method }; computes provenance_meta; snapshots to S3)
    → transformWorker   (clean, normalise; passes provenance_meta through unchanged)
    → chunkWorker       (split + buildChunkRow; writes full provenance atomically)
    → embeddingWorker   (OpenAI embeddings → pgvector)
```

Each worker reads `job.data`, does its work, then calls `enqueue(NEXT_EVENT, payload)`. The `EVENTS` enum and `QUEUE_MAP` in `queue/events.js` define the routing. Workers start after `app.listen()` in `app.js`.

### Provenance Engine

`provenanceService.js` is the single codepath for all provenance data. Chunks carry a `provenance` JSONB column plus indexed columns derived via `buildChunkRow(meta)`. Layers govern snapshot policy and staleness:

| Layer | Source type | Snapshot policy | Stale if fetch fails |
|-------|-------------|-----------------|----------------------|
| L1 | document (pdf, docx), tier-1 discovery | static | no |
| L2 | company-scoped, tier-2 discovery | refresh_on_request | — |
| L3 | url, youtube | auto_refresh | yes |
| L5 | API feed | auto_refresh | yes |

Key rules:
- `buildChunkRow()` is the only function that produces provenance data — never write indexed columns independently.
- `reasoning.usages` in stored JSONB is always `[]` — populated only at query time via JOIN on `chunk_reasoning_usages`.
- `canonical_uri` is the field name in service code and JSONB (SQL column renamed from `canonical_url` in migration 005).
- `trust_runs` is append-only — enforced by DB trigger `prevent_trust_runs_mutation`.

### Discovery Agent

A separate `discovery-worker.js` runs a nightly cron (`0 2 * * *`). It scores candidate URLs using Claude (Anthropic SDK), auto-ingests high-confidence results (≥ `AUTO_INGEST_THRESHOLD`), and queues borderline results for human review (`REVIEW_THRESHOLD`–`AUTO_INGEST_THRESHOLD`). On auto-ingest failure, candidates revert to `pending` for human review.

### Stale Scan

`staleCronService.js` runs hourly (`0 * * * *`) via BullMQ `stale` queue. It queries `findStaleEligible()` (chunks with expired TTL) and calls `markStale()`. No trust run events are written here — `stale_flagged` events are Trust360's responsibility at run-read time when it detects a cited chunk has been marked stale since the run completed.

### Refresh

`POST /api/research/refresh` → `refreshService.js`. Accepts `chunk_ids`, `source_uris`, or `canonical_uris` (at least one required) plus optional `reason`, `company_id`, `run_id`, `tenant_id` (defaults to `ethikslabs`). Groups chunks by source URI, re-fetches, re-chunks, re-embeds, marks old chunks superseded.

**v1 lineage constraint:** Fan-out (one old source → many new chunks) is only partially linked. Only the first old chunk → first new chunk supersession link is written. A source-level lineage table will be added in a future iteration.

### Query / RAG

`POST /research360/query` → `retrievalService.js` → pgvector cosine similarity search → `reasoningService.js` → Claude Sonnet streaming response. The query route accepts `provenance_depth` (`summary` | `internal` | `full_internal`), `layers`, and `run_id`. Sources are shaped via `shapeByDepth()` before returning — `summary` depth strips `layer`, `chunk_id`, `ingested_by`, `raw_snapshot_uri`, and `reasoning`.

### API routes

Route prefix is mixed — `/research360/` for ingest/documents/query; `/api/` for discovery/research/trust.

```
GET  /health

POST /research360/ingest/file
POST /research360/ingest/url
GET  /research360/documents
GET  /research360/documents/:id
GET  /research360/documents/:id/download
DELETE /research360/documents/:id
GET  /research360/sessions/:id

POST /research360/query

GET  /api/discovery/pending
GET  /api/discovery/runs
POST /api/discovery/:id/approve
POST /api/discovery/:id/reject
POST /api/discovery/run

POST /api/research/refresh
GET  /api/research/provenance/:chunk_id

GET  /api/trust/runs/:run_id/provenance
GET  /api/trust/runs/:run_id/events
PUT/PATCH/DELETE /api/trust/runs/:run_id  → 405 (append-only)
```

### Frontend structure

```
frontend/src/
  App.jsx                        — root, screen routing
  config/index.js                — API_URL + DEFAULTS (persona, complexity, pollInterval)
  api/                           — thin fetch wrappers keyed by domain
  hooks/useChat.js               — streaming query state
  hooks/useDocuments.js          — document list polling
  components/chat/               — chat UI
  components/ingest/             — IngestView + tab components (File, URL, YouTube*)
  components/library/            — document library
  components/shared/             — reusable primitives
```

\* YouTube ingest tab: design approved (`docs/superpowers/specs/2026-04-04-youtube-ingest-design.md`), implementation plan not yet written. Frontend-only — Google OAuth 2.0 PKCE, `useYouTubeAuth.js` hook, calls existing `POST /research360/ingest/url`. Requires `VITE_GOOGLE_CLIENT_ID` and a Google Cloud OAuth 2.0 Web client configured with `http://localhost:5173` as origin and redirect URI.

### Key design rules
- Business logic lives in `services/` — routes are thin HTTP handlers only.
- `queue/events.js` is the only place that maps events to queues. Don't enqueue directly elsewhere.
- `db/queries/` modules are the only place that touch SQL. No raw queries in workers or services.
- `enqueue()` returns the BullMQ job; callers that need `job_id` (e.g. ingest route) use `job.id`.
- All timestamps stored and returned as UTC ISO 8601.
- Tenant ID is read from `x-tenant-id` request header (default: `ethikslabs`) — not a path or query param.
- `trust_runs` is append-only at both the DB trigger layer and the route layer (PUT/PATCH/DELETE return 405).
