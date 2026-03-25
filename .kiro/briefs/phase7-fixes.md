# Research360 — Phase 7 Fix Brief
Generated: 23 March 2026
From: Claude Code (Verifier) + CODEX
To: Kiro (Builder)
Authority: John Coates

Role reminder: Kiro fixes. Claude Code verifies after. No agent validates its own work.

---

## Overview

Four fixes across three files. No architectural changes. No new files.
Two are blockers. One is a security boundary fix. One is backlog only.

---

## FIX-1 — retrievalService.js: Select correct column name
File: api/src/services/retrievalService.js
Line: 41

Change:
  c.canonical_uri,

To:
  c.canonical_url AS canonical_uri,

Reason: The column on the chunks table is canonical_url. Selecting canonical_uri directly
throws a SQL error on every /research360/query call on a migrated database.
Unit tests missed this because pool.query is mocked.

No other changes to this file.

---

## FIX-2 — refreshService.js: Two fixes in one file

### FIX-2a — Supersede ALL old chunks, not just representative
Location: refreshSource(), the markSuperseded call (~line 143)

Change from:
  await markSuperseded(representative.id, firstNewChunkId)

To:
  for (const oldId of oldChunkIds) {
    await markSuperseded(oldId, firstNewChunkId)
  }

Reason: Only the representative (first) old chunk was being superseded.
All N old chunks in a grouped source must be superseded by the first new chunk.
The v1 lineage warning log above this block is correct and stays — only the
markSuperseded call needs to become a loop.

### FIX-2b — insertRefreshedChunks INSERT column name
Location: insertRefreshedChunks(), the INSERT statement column list

Change:
  canonical_url,

To:
  canonical_uri,

Reason: Same Phase 1 rename (canonical_url → canonical_uri) was missed in this
INSERT statement. Consistent with all other column references.

---

## FIX-3 — provenance.js + chunks.js: Enforce tenant boundary
Files: api/src/routes/provenance.js AND api/src/db/queries/chunks.js

### provenance.js
Change from:
  const { chunk_id } = request.params
  const provenance = await findProvenanceByChunkId(chunk_id)

To:
  const { chunk_id } = request.params
  const tenantId = request.tenantId   // same pattern as all other routes
  const provenance = await findProvenanceByChunkId(chunk_id, tenantId)

### chunks.js — findProvenanceByChunkId
Update the query to accept and enforce tenant_id as second parameter:
  WHERE id = $1 AND tenant_id = $2

Match the query pattern used by all other chunk queries in chunks.js.

Reason: Route currently returns provenance for any chunk_id regardless of tenant.
This is a security boundary violation — any caller with a valid UUID can read
another tenant's provenance data.

---

## Verification checklist (Claude Code runs after fixes)

  □ /research360/query returns 200 with results (FIX-1)
  □ After refresh of multi-chunk source: all old chunk IDs show is_superseded=true (FIX-2a)
  □ /api/research/provenance/:chunk_id with wrong tenant returns 404 (FIX-3)
  □ /api/research/provenance/:chunk_id with correct tenant returns 200 (FIX-3)
  □ Stack boots clean, no new errors introduced

John signs off → Phase 7 closed → Phase 8 (SourceCard.jsx) begins.
