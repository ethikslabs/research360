# research360 — DOSSIER

**Identity:** Knowledge ingestion substrate — documents/URLs/YouTube → pgvector + RAG chat
**Version:** Phases 1–7 complete (per IMPERIUM stack map)
**Status:** `lab` — local dev stack, migrations 001–006 applied
**Authority:** John Coates
**Repo:** ethikslabs/research360
**Ports:** API 3001, Frontend 5173

---

## Visual Identity

| Field | Value |
|-------|-------|
| Glyph | 🔬 |
| Color | `#475569` |

---

## What This Repo Owns

research360 ingests any document or URL, processes it through a four-stage worker pipeline into pgvector, and exposes RAG-based chat via Claude Sonnet streaming. It is the knowledge substrate for the entire 360 stack — any product that needs to reason over a corpus calls research360.

**The boundary:**
- research360 owns ingestion, chunking, embedding, and retrieval.
- Reasoning (the Claude response) streams through research360 but the trust evaluation of sources is Trust360's job.
- Provenance is fully tracked — every chunk carries its lineage.

---

## Role in the 360 Stack

```
IMPERIUM (control plane)
└── research360 (knowledge substrate)
    ├── ingest: documents (PDF/DOCX/PPTX), URLs, YouTube
    ├── query: cosine similarity → Claude Sonnet streaming
    ├── discovery: nightly cron agent (Claude) → auto-ingest high-confidence
    └── provenance: full lineage per chunk, trust_runs append-only
```

---

## Architecture

### Ingestion pipeline

```
POST /research360/ingest/file   (PDF, DOCX, PPTX — 50MB; SHA-256 dedup, 409 on dup)
POST /research360/ingest/url    (any URL; youtube.com auto-tagged source_type=youtube)
  → s3Service.upload()
  → enqueue(CONTENT_UPLOADED)
    → extractionWorker  (text + extraction_confidence + extraction_method; S3 snapshot)
    → transformWorker   (clean, normalise; provenance_meta passes through)
    → chunkWorker       (split + buildChunkRow; writes full provenance atomically)
    → embeddingWorker   (OpenAI text-embedding-3-small → pgvector)
```

Each worker reads `job.data`, does its work, calls `enqueue(NEXT_EVENT, payload)`. Routing via `EVENTS` enum + `QUEUE_MAP` in `queue/events.js`.

### Provenance layers

| Layer | Source type | Snapshot policy | Stale if fetch fails |
|-------|-------------|-----------------|----------------------|
| L1 | document (pdf, docx), tier-1 discovery | static | no |
| L2 | company-scoped, tier-2 discovery | refresh_on_request | — |
| L3 | url, youtube | auto_refresh | yes |
| L5 | API feed | auto_refresh | yes |

**Critical rule:** `buildChunkRow()` is the only function that produces provenance data. Never write indexed columns independently.

### Discovery agent

Nightly cron (`0 2 * * *`). Scores candidate URLs via Claude (Anthropic SDK). Auto-ingests ≥ `AUTO_INGEST_THRESHOLD`. Queues borderline results for human review. On auto-ingest failure → reverts to `pending`.

### RAG query

`POST /research360/query` → `retrievalService.js` → pgvector cosine similarity → `reasoningService.js` → Claude Sonnet streaming. Accepts `provenance_depth` (summary | internal | full_internal), `layers`, `run_id`.

---

## Stack

- **API:** Node.js + Fastify, port 3001
- **Frontend:** React + Vite, port 5173
- **Storage:** S3 (prod) / MinIO (dev), Postgres + pgvector, Redis, BullMQ
- **Embeddings:** OpenAI `text-embedding-3-small`
- **Reasoning:** Anthropic Claude Sonnet (streaming)
- **Database:** Shared Docker container `research360-postgres-1` (also used by fund360)

### Migrations (run in order)

```
001_initial.sql
004_discovery_agent.sql
005_provenance_engine.sql
006_file_hash.sql
```

---

## Key Design Rules

- `buildChunkRow()` is the only provenance writer — never write indexed columns independently.
- `queue/events.js` is the only place that maps events to queues.
- `db/queries/` modules are the only place that touch SQL.
- `trust_runs` is append-only — enforced by DB trigger `prevent_trust_runs_mutation`.
- All timestamps: UTC ISO 8601.
- Tenant ID from `x-tenant-id` request header (default: `ethikslabs`).

---

## API Routes (mixed prefix)

```
/research360/   — ingest, documents, query
/api/           — discovery, research refresh, trust runs
```

---

## Current State

- Migrations 001–006 applied
- YouTube ingest tab: design approved (`docs/superpowers/specs/2026-04-04-youtube-ingest-design.md`), implementation plan not yet written
- Requires `VITE_GOOGLE_CLIENT_ID` for YouTube tab (Google Cloud OAuth 2.0 Web client)
- Not deployed to EC2

---

## Open Items

- YouTube ingest implementation (frontend-only feature — calls existing `POST /research360/ingest/url`)
- EC2 deployment path not defined
- Source-level lineage table (v1 fan-out only partially linked — first old chunk → first new chunk)
- `stale_flagged` events are Trust360's responsibility at run-read time (research360 only marks chunks stale)

---

## Related

- `trust360/` — evaluates trust of cited sources; reads `trust_runs`
- `fund360/` — shares `research360-postgres-1` Docker container
- `VERITAS/` — future provenance authority
- `WHY.md` — origin story and the Ethiks360 context — why any of this exists

---

## MCP Surface (planned)

```
mcp://research360/
└── tools/
    ├── ingest_file           — POST /research360/ingest/file; PDF/DOCX/PPTX → pipeline
    ├── ingest_url            — POST /research360/ingest/url; URL or YouTube → pipeline
    ├── query                 — POST /research360/query; RAG retrieval + Claude Sonnet streaming
    ├── list_documents        — GET /research360/documents; corpus listing with provenance
    ├── get_provenance        — GET /api/research/provenance/:chunk_id; full chunk lineage
    ├── refresh               — POST /api/research/refresh; re-fetch and re-embed by URI/chunk
    └── run_discovery         — POST /api/discovery/run; trigger nightly discovery agent manually
```

---

## A2A Agent Card

```json
{
  "agent_id": "research360",
  "display_name": "research360 — Knowledge ingestion substrate and RAG query engine",
  "owner": "john-coates",
  "version": "1.0.0",
  "port": 3001,
  "capabilities": [
    "document_ingestion",
    "url_ingestion",
    "youtube_ingestion",
    "rag_query",
    "provenance_tracking",
    "discovery_agent",
    "stale_detection"
  ],
  "authority_level": "product",
  "contact_protocol": "http",
  "human_principal": "john-coates"
}
```

---

## Deployment

| Field | Value |
|-------|-------|
| GitHub | `ethikslabs/research360` |
| EC2 | no — local only (Docker-dependent, Postgres + Redis) |
| URL | local only |
| Deploy method | not deployed |
| PM2 name | n/a |
| Local port | 3001 |

---

## Commercial

| Field | Value |
|-------|-------|
| Status | pre-revenue |
| Founder | john-coates |
| ABN / UEN | pending |
| Capital path | revenue |
| Revenue model | Knowledge substrate-as-a-service — per-query RAG retrieval + per-ingest fee; corpus licensing to any 360 product needing document reasoning |
| IP boundary | Four-stage BullMQ ingestion pipeline, provenance engine with full chunk lineage, trust_runs audit layer, nightly discovery agent, stale detection |
| Stack dependency | VECTOR (embeddings + Claude Sonnet reasoning, future), VERITAS (future provenance authority) |
| First customer | internal: fund360 (shared corpus), trust360 (provenance evaluation) |

### Traction

| Metric | Value | Source |
|--------|-------|--------|
| Migrations applied | 001–006 | manual |
| YouTube ingest | design approved | manual |
| Corpus | live local | manual |

---

*Last updated: 2026-04-25*
*Authority: john-coates*
