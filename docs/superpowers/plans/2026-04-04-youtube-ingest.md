# YouTube Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a YouTube tab to the Ingest view so the user can browse their 25 most recently liked videos and ingest selected ones in one click — no URL copying required.

**Architecture:** Frontend-only. Google OAuth 2.0 PKCE (no client secret, no backend). Token in localStorage. Liked videos fetched directly from the YouTube Data API. Each selected video submitted to the existing `POST /research360/ingest/url` endpoint. On completion, navigate to `/library`.

**Tech Stack:** React 18, Vite, Tailwind CSS, YouTube Data API v3, Web Crypto API (for PKCE SHA-256), react-router-dom v6.

> **No frontend test framework exists** (YAGNI — personal single-user tool). Each task has manual verification steps instead of automated tests. Do not add a test framework for this feature.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/hooks/useYouTubeAuth.js` | PKCE flow, token storage, expiry checks |
| Create | `frontend/src/api/youtube.js` | `fetchLikedVideos(token)` — YouTube API call + normalisation |
| Create | `frontend/src/components/ingest/YouTubeIngest.jsx` | Tab UI — connect state, grid, multi-select, ingest |
| Modify | `frontend/src/components/ingest/IngestView.jsx` | Add YouTube tab entry |
| Modify | `frontend/.env.example` | Document `VITE_GOOGLE_CLIENT_ID` |

---

## Pre-flight: Google Cloud Console (John must do this before testing)

Before any code runs, create the OAuth client:
1. Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
2. Application type: **Web application**
3. Authorised JavaScript origins: `http://localhost:5173`
4. Authorised redirect URIs: `http://localhost:5173/ingest`
5. Copy the Client ID into `frontend/.env` as `VITE_GOOGLE_CLIENT_ID=<id>`
6. Enable the YouTube Data API v3 for the project (APIs & Services → Library → search "YouTube Data API v3" → Enable)

---

## Task 1: `useYouTubeAuth.js` — PKCE OAuth hook

**Files:**
- Create: `frontend/src/hooks/useYouTubeAuth.js`

### What this file owns
- Generating PKCE `code_verifier` + `code_challenge`
- Redirecting to Google OAuth
- Detecting `?code=` on return and exchanging for a token
- Storing `{ access_token, expires_at }` in `localStorage` under key `yt_auth`
- Detecting `?error=access_denied` on return
- Cleaning OAuth params from the URL after handling
- Exposing `{ token, isConnected, connect, disconnect, oauthError }`

### Implementation

- [ ] **Step 1: Create `frontend/src/hooks/useYouTubeAuth.js`**

```js
import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'yt_auth'
const VERIFIER_KEY = 'yt_pkce_verifier'

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generatePKCE() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64url(verifierBytes)
  const challengeBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(challengeBuffer)
  return { verifier, challenge }
}

function readToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed.access_token || !parsed.expires_at) return null
    if (Date.now() >= parsed.expires_at) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed.access_token
  } catch {
    return null
  }
}

function clearOAuthParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('error')
  url.searchParams.delete('scope')
  history.replaceState(null, '', url.pathname + (url.search === '?' ? '' : url.search))
}

export function useYouTubeAuth() {
  const [token, setToken] = useState(() => readToken())
  const [oauthError, setOauthError] = useState(null)

  // Handle OAuth callback on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')

    if (error) {
      clearOAuthParams()
      setOauthError('Access denied — Google OAuth was not approved.')
      return
    }

    if (!code) return

    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    if (!verifier) {
      clearOAuthParams()
      return
    }

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    const redirectUri = `${window.location.origin}/ingest`

    fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    })
      .then(r => r.json())
      .then(data => {
        sessionStorage.removeItem(VERIFIER_KEY)
        clearOAuthParams()
        if (data.access_token) {
          const payload = {
            access_token: data.access_token,
            expires_at: Date.now() + data.expires_in * 1000,
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
          setToken(data.access_token)
        } else {
          setOauthError('Token exchange failed — please try again.')
        }
      })
      .catch(() => {
        sessionStorage.removeItem(VERIFIER_KEY)
        clearOAuthParams()
        setOauthError('Token exchange failed — please try again.')
      })
  }, [])

  const connect = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      console.error('VITE_GOOGLE_CLIENT_ID is not set')
      return
    }
    const { verifier, challenge } = await generatePKCE()
    sessionStorage.setItem(VERIFIER_KEY, verifier)
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${window.location.origin}/ingest`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }, [])

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
    setOauthError(null)
  }, [])

  const isConnected = token !== null

  return { token, isConnected, connect, disconnect, oauthError }
}
```

- [ ] **Step 2: Verify it loads without errors**

Start the frontend:
```bash
cd frontend && npm run dev
```
Open `http://localhost:5173/ingest`. Check browser console — no import errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useYouTubeAuth.js
git commit -m "feat(youtube): add useYouTubeAuth PKCE OAuth hook"
```

---

## Task 2: `api/youtube.js` — YouTube API wrapper

**Files:**
- Create: `frontend/src/api/youtube.js`

### What this file owns
- `fetchLikedVideos(token)` — calls YouTube playlistItems API for `playlistId=LL`
- Normalising the response to `{ videoId, title, channelTitle, thumbnail, likedAt }`
- Handling the empty-playlist case (API omits `items` entirely — normalise to `[]`)
- Checking token expiry before calling the API and throwing a typed error if expired

### Implementation

- [ ] **Step 1: Create `frontend/src/api/youtube.js`**

```js
const PLAYLIST_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems'

// snippet.publishedAt on a playlistItems response is the date the video was
// *liked* (added to the playlist), not the video's original publish date.
// It's named likedAt here to prevent future confusion.

export class TokenExpiredError extends Error {
  constructor() {
    super('YouTube token expired')
    this.name = 'TokenExpiredError'
  }
}

function isExpired(token) {
  try {
    const raw = localStorage.getItem('yt_auth')
    if (!raw) return true
    const { expires_at } = JSON.parse(raw)
    return Date.now() >= expires_at
  } catch {
    return true
  }
}

export async function fetchLikedVideos(token) {
  if (isExpired(token)) {
    localStorage.removeItem('yt_auth')
    throw new TokenExpiredError()
  }

  const params = new URLSearchParams({
    playlistId: 'LL',
    part: 'snippet',
    maxResults: '25',
  })

  const res = await fetch(`${PLAYLIST_ENDPOINT}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `YouTube API error (${res.status})`)
  }

  const data = await res.json()

  return (data.items ?? []).map(item => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? '',
    likedAt: item.snippet.publishedAt, // = date liked, see comment above
  }))
}
```

- [ ] **Step 2: Verify it loads without errors**

The file has no UI — just confirm no import errors appear in the console on page load.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/youtube.js
git commit -m "feat(youtube): add fetchLikedVideos API wrapper"
```

---

## Task 3: `YouTubeIngest.jsx` — tab component

**Files:**
- Create: `frontend/src/components/ingest/YouTubeIngest.jsx`

### What this file owns
- Connect state: "Connect with Google" button or disconnect link
- Loading state: fetching videos after token is obtained
- Empty state: "No liked videos yet"
- Error state: inline error message (API failure, token expired, OAuth denied)
- Thumbnail grid: 25 videos, click-to-toggle multi-select
- Ingest button: "Ingest N →" (disabled when nothing selected or submitting)
- Sequential ingest: calls `ingestUrl(url, title)` for each selected video, marks failures inline, continues on error
- On completion (all attempted): calls `onSuccess()`

### Implementation

- [ ] **Step 1: Create `frontend/src/components/ingest/YouTubeIngest.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useYouTubeAuth } from '../../hooks/useYouTubeAuth.js'
import { fetchLikedVideos, TokenExpiredError } from '../../api/youtube.js'
import { ingestUrl } from '../../api/research360.js'

export default function YouTubeIngest({ onSuccess }) {
  const { token, isConnected, connect, disconnect, oauthError } = useYouTubeAuth()
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [ingestState, setIngestState] = useState({}) // videoId → 'done' | 'error:<msg>'
  const [submitting, setSubmitting] = useState(false)

  // Fetch liked videos when connected
  useEffect(() => {
    if (!isConnected || !token) return
    let cancelled = false
    setLoading(true)
    setFetchError(null)
    fetchLikedVideos(token)
      .then(items => {
        if (!cancelled) setVideos(items)
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof TokenExpiredError) {
          disconnect()
        } else {
          setFetchError(err.message)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [isConnected, token, disconnect])

  function toggleSelect(videoId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  async function ingestSelected() {
    if (!selected.size || submitting) return
    setSubmitting(true)
    const toIngest = videos.filter(v => selected.has(v.videoId))
    const state = {}

    for (const video of toIngest) {
      const url = `https://www.youtube.com/watch?v=${video.videoId}`
      try {
        await ingestUrl(url, video.title)
        state[video.videoId] = 'done'
      } catch (err) {
        state[video.videoId] = `error:${err.message}`
      }
      setIngestState({ ...state })
    }

    setSubmitting(false)
    onSuccess()
  }

  // Not connected
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        {oauthError && (
          <div className="text-sm text-red-400 mb-2">{oauthError}</div>
        )}
        <button
          onClick={connect}
          className="px-5 py-2.5 bg-elevated border border-line hover:border-indigo-500 text-sm text-ink rounded-lg transition-colors"
        >
          Connect with Google
        </button>
        <p className="text-xs text-fade">Grants read-only access to your liked videos</p>
      </div>
    )
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-fade">
        Loading liked videos…
      </div>
    )
  }

  // Fetch error
  if (fetchError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="text-sm text-red-400">{fetchError}</div>
        <button onClick={disconnect} className="text-xs text-fade hover:text-ink underline">
          Disconnect
        </button>
      </div>
    )
  }

  // Empty state
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="text-sm text-fade">
          No liked videos yet — like a video on YouTube to see it here.
        </div>
        <button onClick={disconnect} className="text-xs text-fade hover:text-ink underline">
          Disconnect
        </button>
      </div>
    )
  }

  const selectedCount = selected.size
  const allAttempted = submitting === false && selectedCount > 0 &&
    [...selected].every(id => ingestState[id])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fade">{videos.length} liked videos</span>
        <button onClick={disconnect} className="text-xs text-fade hover:text-ink underline">
          Disconnect
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {videos.map(video => {
          const isSelected = selected.has(video.videoId)
          const state = ingestState[video.videoId]
          const isDone = state === 'done'
          const isError = state?.startsWith('error:')

          return (
            <button
              key={video.videoId}
              onClick={() => !submitting && !isDone && toggleSelect(video.videoId)}
              disabled={submitting || isDone}
              className={[
                'relative flex flex-col rounded-lg overflow-hidden border text-left transition-colors',
                isSelected && !isDone ? 'border-indigo-500' : 'border-line',
                isDone ? 'opacity-50 cursor-default' : 'hover:border-indigo-400 cursor-pointer',
              ].join(' ')}
            >
              <img
                src={video.thumbnail}
                alt={video.title}
                className="w-full aspect-video object-cover bg-surface"
              />
              <div className="p-2 bg-elevated">
                <div className="text-xs text-ink line-clamp-2 leading-snug">{video.title}</div>
                <div className="text-xs text-fade mt-0.5 truncate">{video.channelTitle}</div>
                {isDone && <div className="text-xs text-green-400 mt-0.5">✓ Ingested</div>}
                {isError && (
                  <div className="text-xs text-red-400 mt-0.5">
                    {state.slice('error:'.length)}
                  </div>
                )}
              </div>
              {isSelected && !isDone && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-600 border border-white flex items-center justify-center">
                  <span className="text-white text-xs leading-none">✓</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {selectedCount > 0 && (
        <div className="flex justify-end mt-2">
          <button
            onClick={ingestSelected}
            disabled={submitting || allAttempted}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
          >
            {submitting ? 'Ingesting…' : `Ingest ${selectedCount} →`}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it loads without errors**

The component isn't wired up yet. Check browser console for import errors only.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ingest/YouTubeIngest.jsx
git commit -m "feat(youtube): add YouTubeIngest tab component"
```

---

## Task 4: Wire YouTube tab into `IngestView.jsx`

**Files:**
- Modify: `frontend/src/components/ingest/IngestView.jsx`

- [ ] **Step 1: Add the YouTube tab**

Replace the entire file content:

```jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FileUpload from './FileUpload.jsx'
import UrlIngest from './UrlIngest.jsx'
import YouTubeIngest from './YouTubeIngest.jsx'

const TABS = ['File', 'URL', 'YouTube']

export default function IngestView() {
  const [tab, setTab] = useState('File')
  const navigate = useNavigate()

  function onSuccess() {
    navigate('/library')
  }

  return (
    <div className="flex-1 flex flex-col p-8 max-w-2xl w-full overflow-y-auto mx-auto">
      <h1 className="text-lg font-semibold text-ink mb-6">Ingest</h1>

      <div className="flex gap-1 mb-6 bg-surface border border-line rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded text-sm transition-colors',
              tab === t
                ? 'bg-elevated text-ink'
                : 'text-fade hover:text-ink',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'File' && <FileUpload onSuccess={onSuccess} />}
      {tab === 'URL' && <UrlIngest onSuccess={onSuccess} />}
      {tab === 'YouTube' && <YouTubeIngest onSuccess={onSuccess} />}
    </div>
  )
}
```

- [ ] **Step 2: Verify manually**

Open `http://localhost:5173/ingest`. You should see three tabs: File, URL, YouTube. Clicking YouTube shows "Connect with Google". File and URL tabs still work.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ingest/IngestView.jsx
git commit -m "feat(youtube): wire YouTube tab into IngestView"
```

---

## Task 5: Update `.env.example`

**Files:**
- Modify: `frontend/.env.example`

- [ ] **Step 1: Add the Google Client ID var**

Append to `frontend/.env.example`:

```
VITE_GOOGLE_CLIENT_ID=   # Google OAuth 2.0 Web client ID — required for YouTube ingest tab
```

- [ ] **Step 2: Commit**

```bash
git add frontend/.env.example
git commit -m "chore: document VITE_GOOGLE_CLIENT_ID in .env.example"
```

---

## Task 6: End-to-end manual verification

**Prerequisite:** `VITE_GOOGLE_CLIENT_ID` is set in `frontend/.env` and the Google Cloud project has YouTube Data API v3 enabled.

- [ ] **Step 1: Happy path**
  1. Open `http://localhost:5173/ingest` → YouTube tab
  2. Click "Connect with Google" → Google consent screen appears with "YouTube" scope
  3. Approve → redirected back to `/ingest`, URL cleaned (no `?code=` param), liked video grid appears
  4. Click 2–3 thumbnails — blue ring + checkmark appears on each
  5. Click "Ingest 3 →" — button shows "Ingesting…", each card shows "✓ Ingested" as it completes
  6. On completion: navigated to `/library`

- [ ] **Step 2: Token expiry (simulate)**
  1. Open DevTools → Application → Local Storage → `yt_auth`
  2. Set `expires_at` to `1` (epoch 0 — already expired)
  3. Reload page → YouTube tab shows "Connect with Google" (expired token cleared automatically)

- [ ] **Step 3: OAuth denied**
  1. Click "Connect with Google" → on Google's screen, click "Cancel"
  2. Redirected back → "Access denied — Google OAuth was not approved." message shown

- [ ] **Step 4: Empty liked list (if applicable)**
  - If the account has no liked videos, the empty state message appears: "No liked videos yet — like a video on YouTube to see it here."

- [ ] **Step 5: Disconnect**
  1. When connected with grid showing, click "Disconnect" link
  2. Grid disappears, "Connect with Google" button shown
  3. `yt_auth` key gone from localStorage (verify in DevTools)
