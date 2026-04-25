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
