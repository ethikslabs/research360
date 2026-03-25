# Research360 — Phase 7 Bug Report
Generated: 23 March 2026
Source: CODEX static analysis + targeted unit test run
Filed by: Claude Code (Verifier role)

---

## BUG-P7-SQL-001
Severity: BLOCKER
File: api/src/services/retrievalService.js
Location: retrieve(), line 41
Expected: Column selected as canonical_uri — consistent with Phase 1 rename and provenance model
Actual: Selects c.canonical_uri directly, but the column on the chunks table is still canonical_url. On a migrated database this throws a SQL error on every /research360/query call before provenance shaping runs.
Fix: Change to `c.canonical_url AS canonical_uri`
Spec ref: Phase 1 locked decision — canonical_url → canonical_uri standardised throughout. The column was renamed in chunks via 005_provenance_engine.sql. Verify migration actually renames the column; if not, the alias is the v1 fix.
Note: Unit tests passed because pool.query is mocked — mocked queries do not validate column names. This is a test coverage gap (see BUG-P7-TEST-001 below).

---

## BUG-P7-SUP-001
Severity: BLOCKER
File: api/src/services/refreshService.js
Location: refreshSource(), markSuperseded call ~line 143
Expected: All old chunks in a grouped source are marked superseded after a re-fetch
Actual: Only representative.id is passed to markSuperseded(). If a source has N chunks, chunks 2..N remain active and retrievable. The API reports them as refreshed but they are not superseded in the DB.
Fix: Loop over oldChunkIds, call markSuperseded(oldId, firstNewChunkId) for each.
Also: insertRefreshedChunks INSERT statement still uses canonical_url column name — rename to canonical_uri to match Phase 1 schema.
Spec ref: Phase 5 locked — markSuperseded() exists for this purpose. v1 fan-out constraint is chunk-level supersession only — this bug violates that constraint by leaving chunks un-superseded.

---

## BUG-P7-TENANT-001
Severity: HIGH
File: api/src/routes/provenance.js
Location: GET /api/research/provenance/:chunk_id, lines 4–10
Expected: Provenance lookup queries by both chunk_id AND tenant_id, matching access pattern across all other routes
Actual: Queries by bare chunk_id only. Any caller who knows a valid chunk UUID can read another tenant's provenance through this route. Tenant boundary not enforced.
Fix: Extract tenantId from request (same pattern as all other routes). Pass to findProvenanceByChunkId(chunk_id, tenantId). Update that query in chunks.js to WHERE id = $1 AND tenant_id = $2.
Spec ref: chunks table is tenant-scoped throughout the rest of the API. No exemption for provenance routes.

---

## BUG-P7-TEST-001
Severity: LOW (not a blocker — test quality issue)
File: tests/unit/retrievalService.test.js and all Phase 7 unit tests
Location: pool.query mock setup
Expected: SQL query strings validated against actual schema
Actual: pool.query is mocked — SQL column bugs pass silently. BUG-P7-SQL-001 was missed by all unit tests and only caught by CODEX.
Fix (post-v1.0.0): Integration tests against a real test DB with schema applied.
Spec ref: Backlog only. Do not block Phase 8 on this.

---

## Summary

| Bug ID            | Severity | File                    | Status       |
|-------------------|----------|-------------------------|--------------|
| BUG-P7-SQL-001    | BLOCKER  | retrievalService.js     | Fix required |
| BUG-P7-SUP-001    | BLOCKER  | refreshService.js       | Fix required |
| BUG-P7-TENANT-001 | HIGH     | provenance.js           | Fix required |
| BUG-P7-TEST-001   | LOW      | unit tests (all)        | Backlog      |

Phase 7 sign-off condition: all three real bugs resolved.
BUG-P7-TEST-001 is backlog only.
