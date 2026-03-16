import { API_URL } from '../../config/index.js'

function sourceIcon(type) {
  if (type === 'youtube') return '▶'
  if (type === 'url') return '🔗'
  return '📄'
}

function scorePercent(score) {
  return `${Math.round((score || 0) * 100)}%`
}

export default function SourceCard({ source }) {
  const excerpt = source.chunk_text
    ? source.chunk_text.slice(0, 200) + (source.chunk_text.length > 200 ? '…' : '')
    : null

  let href = null
  if (source.source_type === 'url' || source.source_type === 'youtube') {
    href = source.source_url
  } else if (source.source_type === 'document' && source.document_id) {
    href = `${API_URL}/research360/documents/${source.document_id}/download`
  }

  return (
    <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-3 py-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className="text-sm shrink-0 mt-0.5">{sourceIcon(source.source_type)}</span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-400 hover:text-indigo-300 font-medium truncate leading-snug transition-colors"
          >
            {source.document_title || source.source_url || 'Untitled'}
          </a>
        ) : (
          <span className="text-sm text-[#f0f0f0] font-medium truncate leading-snug">
            {source.document_title || 'Untitled'}
          </span>
        )}
      </div>
      <div className="text-xs text-[#8a8a8a] pl-6 flex gap-1.5 flex-wrap">
        <span className="capitalize">{source.source_type}</span>
        <span>·</span>
        <span>chunk {source.chunk_index ?? '—'}</span>
        <span>·</span>
        <span>{scorePercent(source.relevance_score)}</span>
      </div>
      {excerpt && (
        <p className="text-xs text-[#8a8a8a] italic pl-6 leading-relaxed line-clamp-3">
          "{excerpt}"
        </p>
      )}
    </div>
  )
}
