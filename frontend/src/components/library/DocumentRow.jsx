import { useState } from 'react'
import StatusBadge from '../shared/StatusBadge.jsx'

const PROCESSING = new Set(['PENDING', 'EXTRACTED', 'TRANSFORMED', 'CHUNKED'])

function sourceIcon(type) {
  if (type === 'youtube') return '▶'
  if (type === 'url') return '🔗'
  return '📄'
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export default function DocumentRow({ doc, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const displayName = doc.title || doc.file_name || doc.source_url || 'Untitled'
  const [deleting, setDeleting] = useState(false)
  const processing = PROCESSING.has(doc.status)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await onDelete(doc.id)
    } catch {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div
      className={[
        'group flex items-center gap-4 px-5 py-4 border-b border-[#2e2e2e] last:border-b-0 transition-colors hover:bg-white/[0.02]',
        processing ? 'border-l-2 border-l-indigo-500/60' : '',
      ].join(' ')}
    >
      <span className="text-base w-5 text-center shrink-0">{sourceIcon(doc.source_type)}</span>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#f0f0f0] truncate font-medium">
          {displayName}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-[#8a8a8a]">
          <span className="capitalize">{doc.source_type}</span>
          {doc.chunk_count != null && (
            <>
              <span>·</span>
              <span>{doc.chunk_count} chunks</span>
            </>
          )}
          <span>·</span>
          <StatusBadge status={doc.status} />
          <span>·</span>
          <span>{timeAgo(doc.created_at)}</span>
        </div>
      </div>

      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8a8a8a]">Delete?</span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Yes'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-[#8a8a8a] hover:text-[#f0f0f0]"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={handleDelete}
            className="text-xs text-[#8a8a8a] hover:text-red-400 transition-colors px-2 py-1"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
