# YouTube Ingest — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Scope:** Frontend only — no backend changes required

---

## Problem

Ingesting YouTube videos requires manually pasting a URL. The goal is to surface the user's liked videos directly in the ingest UI so they can pick and ingest in one flow. YouTube's API does not expose watch history; liked videos are the practical equivalent — user likes anything they want to ingest.

---

## Approach

Frontend-only OAuth2 PKCE flow. Token stored in localStorage. YouTube Data API called directly from the browser. All ingestion goes through the existing `POST /research360/ingest/url` endpoint — no backend changes.

---

## User Flow

1. User opens Ingest view → clicks "YouTube" tab
2. If not connected: sees "Connect with Google" button
3. Click → Google OAuth PKCE redirect → `youtube.readonly` scope
4. Google redirects back to `/ingest?code=...` — hook detects code, exchanges for token
5. Token stored in localStorage, liked videos fetched immediately
6. Thumbnail grid appears (25 most recent liked videos)
7. User clicks to toggle-select one or more videos
8. "Ingest N →" button ingests each selected video sequentially; failures are shown inline, successes continue
9. On completion (all attempted): navigates to `/library`

---

## Data Models

### YouTube API → Frontend

```
GET https://www.googleapis.com/youtube/v3/playlistItems
  ?playlistId=LL
  &part=snippet
  &maxResults=25
  Authorization: Bearer <access_token>
```

`snippet.publishedAt` on a `playlistItems` response is the date the video was added to the playlist (i.e. when liked), not the video's publish date. The normalised field is named `likedAt` to reflect this — add a comment in `youtube.js` since the raw field name will cause confusion. `contentDetails.videoPublishedAt` is intentionally excluded. Grid is sorted by `likedAt` descending — the API returns items in this order by default, no client-side sort needed.

Normalised item shape:
```js
{
  videoId:      string,  // snippet.resourceId.videoId
  title:        string,  // snippet.title
  channelTitle: string,  // snippet.channelTitle
  thumbnail:    string,  // snippet.thumbnails.medium.url
  likedAt:      string,  // snippet.publishedAt (= liked date, see above)
}
```

Empty list: YouTube API omits `items` entirely (rather than `[]`) when the playlist is empty. `fetchLikedVideos` must normalise this to `[]`. The UI renders an empty-state message: "No liked videos yet — like a video on YouTube to see it here."

### Frontend → Ingest API (unchanged)

```
POST /research360/ingest/url
{ url: "https://www.youtube.com/watch?v={videoId}", title: "{title}" }
```

---

## New Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useYouTubeAuth.js` | PKCE OAuth flow. Generates code_verifier/challenge, redirects to Google, handles callback on return, stores token + expiry. Exposes `{ token, connect, disconnect, isConnected }`. Checks token expiry before returning `isConnected`. |
| `frontend/src/api/youtube.js` | `fetchLikedVideos(token)` — calls YouTube playlistItems API, normalises response. No pagination at v1. |
| `frontend/src/components/ingest/YouTubeIngest.jsx` | Tab component. Uses `useYouTubeAuth` and `fetchLikedVideos`. Renders connect state, empty state, or thumbnail grid with multi-select and ingest button. |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/ingest/IngestView.jsx` | Add "YouTube" tab, render `<YouTubeIngest />` |
| `frontend/.env.example` | Add `VITE_GOOGLE_CLIENT_ID=` |

---

## OAuth PKCE Flow

### Google Cloud Console setup

Register an OAuth 2.0 client:
- **Application type:** Web application
- **Authorised JavaScript origins:** `http://localhost:5173` (dev) + production origin
- **Authorised redirect URIs:** `http://localhost:5173/ingest` (dev) + production `/ingest`

Web application clients support PKCE exchange without a `client_secret` when called from the browser. Do not embed a client secret in frontend code.

### Flow steps

1. Generate code_verifier: 32 random bytes, base64url-encoded without padding (produces ~43 chars of unreserved ASCII, satisfying RFC 7636)
2. Derive `code_challenge = base64url(SHA256(code_verifier))` without padding
3. Store `code_verifier` in `sessionStorage` (survives the redirect, cleared after use)
4. Redirect to:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id={VITE_GOOGLE_CLIENT_ID}
     &redirect_uri={window.location.origin}/ingest
     &response_type=code
     &scope=https://www.googleapis.com/auth/youtube.readonly
     &code_challenge={code_challenge}
     &code_challenge_method=S256
   ```
   `redirect_uri` is always derived as `window.location.origin + '/ingest'` — never hardcoded. This works across dev, staging, and production without additional env vars.
5. On return to `/ingest`, detect `?code=` in URL
6. Exchange at `https://oauth2.googleapis.com/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` (no `client_secret`)
7. Store `{ access_token, expires_at: Date.now() + expires_in * 1000 }` in localStorage under `yt_auth`
8. Clear OAuth params from URL with `history.replaceState`: remove `code` and `error` params, preserve all others, result is `/ingest` (or `/ingest?<remaining-params>` if any non-OAuth params were present)
9. Clear `code_verifier` from sessionStorage

### Token expiry

Check `expires_at` at two points:
- On each render (determines `isConnected` state)
- Immediately before any YouTube API call in `fetchLikedVideos` — if expired, throw a typed error so `YouTubeIngest` can show a re-auth prompt instead of a 401

If expired: clear `yt_auth` from localStorage, render the connect button.

### Error states

| Condition | UI response |
|-----------|-------------|
| User denies OAuth | Google returns `?error=access_denied` — detect and show "Access denied" message |
| Token expired before API call | Clear token, show connect button with "Session expired — reconnect" |
| YouTube API returns non-200 | Show error message in the grid area, do not crash |
| Liked videos list empty | Empty state message (see above) |

---

## Ingest Behaviour

Sequential. For each selected video, call `ingestUrl(url, title)`. If a video fails, mark it with an inline error and continue to the next. Do not abort the batch on failure. After all are attempted, navigate to `/library`.

Maximum batch size: 25 (the grid shows at most 25 videos — selecting all is the worst case). No rate limiting or batching needed at this scale.

## Known Limitations

- **No token refresh.** Google access tokens expire after ~1 hour. If the token expires mid-session, the next YouTube API call will fail, the token is cleared, and the user sees a re-auth prompt. This is the accepted tradeoff for a personal single-user tool with no backend. Acceptable.
- **No pagination.** Grid shows the 25 most recently liked videos only. Sufficient for the use case at v1.

---

## Configuration

```
VITE_GOOGLE_CLIENT_ID=<your-oauth-client-id>
```

Add to `frontend/.env` (local) and to production environment. Do not commit the actual value.
