# Handoff — YouTube Ingest Feature

**Date:** 2026-04-04
**Status:** Design complete. Implementation plan not yet written.

---

## What was designed

A new "YouTube" tab in the Ingest view. User connects their Google account via OAuth2 PKCE (frontend only, no backend changes). Their 25 most recently liked videos appear as a thumbnail grid. They select one or more and hit "Ingest N →". Each selected video is submitted to the existing `POST /research360/ingest/url` endpoint — the same pipeline as manual URL paste.

Flow: like a video on YouTube → open research360 → YouTube tab → pick it → ingest.

---

## Spec

`docs/superpowers/specs/2026-04-04-youtube-ingest-design.md`

Reviewed and approved. Read it before writing the implementation plan.

---

## New files to build

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useYouTubeAuth.js` | PKCE OAuth flow, token in localStorage, expiry checks |
| `frontend/src/api/youtube.js` | `fetchLikedVideos(token)` — calls YouTube playlistItems API (playlistId=LL) |
| `frontend/src/components/ingest/YouTubeIngest.jsx` | Tab component — connect state, empty state, thumbnail grid, multi-select, ingest button |

## Modified files

| File | Change |
|------|--------|
| `frontend/src/components/ingest/IngestView.jsx` | Add "YouTube" to TABS, render `<YouTubeIngest />` |
| `frontend/.env.example` | Add `VITE_GOOGLE_CLIENT_ID=` |

---

## Next step

**Write the implementation plan** using the `superpowers:writing-plans` skill. The spec is the input. The plan should give Kiro file-by-file build instructions in the correct order:

1. `useYouTubeAuth.js` (no dependencies)
2. `api/youtube.js` (no dependencies)
3. `YouTubeIngest.jsx` (depends on both above)
4. `IngestView.jsx` patch (depends on YouTubeIngest)
5. `.env.example` update

---

## One thing John needs to do before testing

Create a Google OAuth 2.0 client in Google Cloud Console:
- Type: **Web application**
- Authorised JavaScript origins: `http://localhost:5173`
- Authorised redirect URIs: `http://localhost:5173/ingest`
- Copy the Client ID into `frontend/.env` as `VITE_GOOGLE_CLIENT_ID=`
