import { API_URL } from '../../config/index.js'
import { formatDisplayTimestamp } from '../../utils/formatDisplayTimestamp.js'

function sourceIcon(type) {
  if (type === 'youtube') return '▶'
  if (type === 'url') return '🔗'
  return '📄'
}

function scorePercent(score) {
  return `${Math.round((score || 0) * 100)}%`
}

function confidenceBand(confidence) {
  if (confidence == null) return null
  if (confidence >= 0.90) return { label: 'Strong',         color: 'text-emerald-400' }
  if (confidence >= 0.70) return { label: 'Moderate',       color: 'text-yellow-400'  }
  return                          { label: 'Check original', color: 'text-red-400'     }
}

export default function SourceCard({ source }) {
  const prov = source.provenance || {}
  const provSource = prov.source || {}
  const provExtraction = prov.extraction || {}
  const provStatus = prov.status || {}

  const title = provSource.title || source.document_title || source.source_url || 'Untitled'
  const uri   = provSource.uri   || source.source_url

  const href = uri
    ? uri
    : (source.source_type === 'document' && source.document_id)
      ? `${API_URL}/research360/documents/${source.document_id}/download`
      : null

  const retrievedDate = formatDisplayTimestamp(provSource.retrieved_at)
  const band = confidenceBand(provExtraction.confidence)

  const excerpt = source.chunk_text
    ? source.chunk_text.slice(0, 200) + (source.chunk_text.length > 200 ? '…' : '')
    : null

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
            {title}
          </a>
        ) : (
          <span className="text-sm text-[#f0f0f0] font-medium truncate leading-snug">
            {title}
          </span>
        )}
      </div>

      <div className="text-xs text-[#8a8a8a] pl-6 flex gap-1.5 flex-wrap items-center">
        <span className="capitalize">{source.source_type}</span>
        <span>·</span>
        <span>chunk {source.chunk_index ?? '—'}</span>
        <span>·</span>
        <span>{scorePercent(source.relevance_score)}</span>
        {retrievedDate && (
          <>
            <span>·</span>
            <span>sourced {retrievedDate}</span>
          </>
        )}
        {band && (
          <>
            <span>·</span>
            <span className={band.color}>{band.label}</span>
          </>
        )}
      </div>

      {provStatus.is_stale && (
        <div className="pl-6">
          <span className="text-xs text-yellow-500 bg-yellow-500/10 rounded px-1.5 py-0.5">
            Source may be outdated
          </span>
        </div>
      )}

      {provStatus.is_superseded && (
        <div className="pl-6">
          <span className="text-xs text-orange-400 bg-orange-400/10 rounded px-1.5 py-0.5">
            Newer version available — refresh available
          </span>
        </div>
      )}

      {excerpt && (
        <p className="text-xs text-[#8a8a8a] italic pl-6 leading-relaxed line-clamp-3">
          "{excerpt}"
        </p>
      )}
    </div>
  )
}
