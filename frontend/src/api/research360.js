import { API_URL } from '../config/index.js'

async function handleResponse(res) {
  if (!res.ok) {
    let body
    try { body = await res.json() } catch { body = {} }
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    err.code = body.code
    throw err
  }
  if (res.status === 204) return null
  return res.json()
}

export async function ingestFile(file, title) {
  const form = new FormData()
  form.append('file', file)
  if (title) form.append('title', title)
  const res = await fetch(`${API_URL}/research360/ingest/file`, {
    method: 'POST',
    body: form,
  })
  return handleResponse(res)
}

export async function ingestUrl(url, title) {
  const res = await fetch(`${API_URL}/research360/ingest/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title }),
  })
  return handleResponse(res)
}

export async function listDocuments(filters = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.source_type) params.set('source_type', filters.source_type)
  if (filters.limit) params.set('limit', filters.limit)
  if (filters.offset) params.set('offset', filters.offset)
  const res = await fetch(`${API_URL}/research360/documents?${params}`)
  return handleResponse(res)
}

export async function getDocument(id) {
  const res = await fetch(`${API_URL}/research360/documents/${id}`)
  return handleResponse(res)
}

export async function deleteDocument(id) {
  const res = await fetch(`${API_URL}/research360/documents/${id}`, {
    method: 'DELETE',
  })
  return handleResponse(res)
}

export async function query({ query, persona, complexity, sessionId, filters, provenance_depth = 'summary' }) {
  const res = await fetch(`${API_URL}/research360/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      persona,
      complexity,
      session_id: sessionId,
      filters,
      provenance_depth,
    }),
  })
  return handleResponse(res)
}

export async function getSession(sessionId) {
  const res = await fetch(`${API_URL}/research360/sessions/${sessionId}`)
  return handleResponse(res)
}
