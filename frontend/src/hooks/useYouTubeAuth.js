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
  // token state exists only to trigger re-renders when auth state changes.
  // The actual returned token value always comes from readToken() (liveToken below).
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

    const controller = new AbortController()

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
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        sessionStorage.removeItem(VERIFIER_KEY)
        clearOAuthParams()
        if (data.access_token) {
          const payload = {
            access_token: data.access_token,
            expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
          setToken(data.access_token)
        } else {
          setOauthError('Token exchange failed — please try again.')
        }
      })
      .catch(err => {
        if (err.name === 'AbortError') return
        sessionStorage.removeItem(VERIFIER_KEY)
        clearOAuthParams()
        setOauthError('Token exchange failed — please try again.')
      })

    return () => controller.abort()
  }, [])

  const connect = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) {
      setOauthError('Google Client ID is not configured — set VITE_GOOGLE_CLIENT_ID.')
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

  // Re-read from localStorage on each render so expiry is caught mid-session.
  // readToken() clears the entry if expired, so this is the authoritative value.
  const liveToken = readToken()
  const isConnected = liveToken !== null

  return { token: liveToken, isConnected, connect, disconnect, oauthError }
}
