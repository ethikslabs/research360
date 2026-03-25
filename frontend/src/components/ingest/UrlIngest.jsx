import { useState } from 'react'
import { ingestUrl } from '../../api/research360.js'

function isYouTube(url) {
  return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/.test(url)
}

function urlIcon(url) {
  return isYouTube(url) ? '▶' : '🔗'
}

function urlLabel(url) {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

export default function UrlIngest({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [queue, setQueue] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function addToQueue() {
    const trimmed = url.trim()
    if (!trimmed) return
    setQueue(prev => [...prev, { url: trimmed, title: title.trim(), done: false, error: null }])
    setUrl('')
    setTitle('')
    setError(null)
  }

  function removeFromQueue(idx) {
    setQueue(prev => prev.filter((_, i) => i !== idx))
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') addToQueue()
  }

  async function ingestAll() {
    if (!queue.length || submitting) return
    setSubmitting(true)

    const updated = [...queue]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].done) continue
      try {
        await ingestUrl(updated[i].url, updated[i].title || undefined)
        updated[i] = { ...updated[i], done: true, error: null }
        setQueue([...updated])
      } catch (err) {
        updated[i] = { ...updated[i], error: err.message }
        setQueue([...updated])
      }
    }

    setSubmitting(false)
    if (updated.every(i => i.done)) onSuccess()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-xs text-fade mb-1">URL or YouTube link</label>
          <input
            type="text"
            value={url}
            onChange={e => { setUrl(e.target.value); setError(null) }}
            onKeyDown={onKeyDown}
            placeholder="https://..."
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-fade focus:outline-none focus:border-indigo-500"
          />
          {url && (
            <div className="mt-1 text-xs text-fade">
              {isYouTube(url) ? '▶ YouTube detected' : '🔗 Web URL'}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-fade mb-1">Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder=""
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-fade focus:outline-none focus:border-indigo-500"
          />
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex justify-end">
          <button
            onClick={addToQueue}
            disabled={!url.trim()}
            className="px-4 py-2 bg-elevated border border-line hover:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-ink rounded-lg transition-colors"
          >
            Add to Queue
          </button>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fade uppercase tracking-wide">Queue</div>
          <div className="bg-surface border border-line rounded-lg overflow-hidden">
            {queue.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0"
              >
                <span className="text-sm w-4 text-center shrink-0">{urlIcon(item.url)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink truncate">
                    {item.title || urlLabel(item.url)}
                  </div>
                  <div className="text-xs text-fade truncate">{item.url}</div>
                  {item.error && <div className="text-xs text-red-400 mt-0.5">{item.error}</div>}
                </div>
                {item.done ? (
                  <span className="text-xs text-green-400 shrink-0">✓</span>
                ) : (
                  <button
                    onClick={() => removeFromQueue(idx)}
                    disabled={submitting}
                    className="text-fade hover:text-red-400 disabled:opacity-40 text-sm px-1 shrink-0"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-1">
            <button
              onClick={ingestAll}
              disabled={submitting || queue.every(i => i.done)}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
            >
              {submitting ? 'Ingesting…' : `Ingest All →`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
