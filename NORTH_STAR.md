# NORTH_STAR — research360

**Role:** Knowledge ingestion substrate
**Tier:** 360 — customer-facing product (also acts as internal substrate)
**Winning looks like:** Any document, URL, or YouTube video becomes queryable in minutes. The answer comes with a source. The source can be verified.

---

## What research360 is

research360 ingests anything — PDFs, DOCX, PPTX, URLs, YouTube — runs it through a four-stage BullMQ pipeline (extraction → transform → chunk → embedding), stores it in pgvector, and serves RAG-powered chat over the corpus. A discovery agent runs nightly, scores candidates, and auto-ingests high-confidence results. The corpus becomes smarter over time without manual curation.

## What research360 refuses

- No opinion without source — every answer is grounded in attested content
- No silent failures — failed ingestion jobs surface explicitly
- No cross-tenant data leakage — tenant isolation is structural, not configural

## Boundary

research360 calls: VECTOR (embeddings, Claude Sonnet reasoning), S3 (document storage), pgvector
research360 is called by: fund360 (shared Postgres), proof360 (future), any product needing RAG
research360 exposes: `/research360/` prefix (ingest/query), `/api/` prefix (discovery/trust)

## Winning

A reseller uploads their vendor compliance documents. research360 ingests them overnight. The next morning, their sales team can ask natural-language questions about any vendor's posture and get sourced answers in seconds.

---

*Authority: john-coates*
