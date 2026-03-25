import { useState } from 'react'
import { API_URL } from '../../config/index.js'
import { formatDisplayTimestamp } from '../../utils/formatDisplayTimestamp.js'

// ─── Type badge config ────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  pdf:      { label: 'PDF', bg: '#2e1515', color: '#e05555' },
  docx:     { label: 'DOC', bg: '#151a2e', color: '#5580e0' },
  doc:      { label: 'DOC', bg: '#151a2e', color: '#5580e0' },
  pptx:     { label: 'PPT', bg: '#2a1d10', color: '#e07e40' },
  ppt:      { label: 'PPT', bg: '#2a1d10', color: '#e07e40' },
  xlsx:     { label: 'XLS', bg: '#102a18', color: '#40a060' },
  xls:      { label: 'XLS', bg: '#102a18', color: '#40a060' },
  youtube:  { label: 'YT',  bg: '#2a1010', color: '#e03535' },
  url:      { label: 'WEB', bg: '#111e1a', color: '#5c8a72' },
  audio:    { label: 'AUD', bg: '#1e1028', color: '#9b6be0' },
  podcast:  { label: 'POD', bg: '#1e1028', color: '#9b6be0' },
  video:    { label: 'VID', bg: '#101a28', color: '#4d8fcc' },
  document: { label: 'DOC', bg: '#151a2e', color: '#5580e0' },
}

function typeCfg(sourceType, subtype) {
  return TYPE_CONFIG[subtype] || TYPE_CONFIG[sourceType] || { label: (sourceType || 'SRC').slice(0,3).toUpperCase(), bg: 'var(--elevated)', color: 'var(--muted)' }
}

// Coloured pill for file-type sources
function TypePill({ sourceType, subtype }) {
  const cfg = typeCfg(sourceType, subtype)
  return (
    <span
      className="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-[3px] rounded shrink-0 leading-none"
      style={{ background: cfg.bg, color: cfg.color, letterSpacing: '0.06em' }}
    >
      {cfg.label}
    </span>
  )
}

// Favicon for URL / YouTube — falls back to TypePill on load error
function FaviconBadge({ uri, sourceType, subtype }) {
  const [failed, setFailed] = useState(false)

  let domain = null
  if (uri) {
    try { domain = new URL(uri).hostname } catch { /* ignore */ }
  }

  if (!domain || failed) {
    return <TypePill sourceType={sourceType} subtype={subtype} />
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      width={14}
      height={14}
      className="rounded-[2px] shrink-0 mt-0.5"
      style={{ imageRendering: 'crisp-edges' }}
      onError={() => setFailed(true)}
      alt=""
    />
  )
}

function SourceBadge({ source, uri }) {
  const type = source.source_type
  const subtype = source.provenance?.source_subtype || source.source_subtype

  if (type === 'url' || type === 'youtube') {
    return <FaviconBadge uri={uri} sourceType={type} subtype={subtype} />
  }
  return <TypePill sourceType={type} subtype={subtype} />
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scorePercent(score) {
  return `${Math.round((score || 0) * 100)}%`
}

function confidenceBand(confidence) {
  if (confidence == null) return null
  if (confidence >= 0.90) return { label: 'Strong',         color: 'text-emerald-400' }
  if (confidence >= 0.70) return { label: 'Moderate',       color: 'text-yellow-400'  }
  return                          { label: 'Check original', color: 'text-red-400'     }
}

// ─── Component ───────────────────────────────────────────────────────────────

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
    <div
      className="rounded-lg px-3 py-3 flex flex-col gap-1.5"
      style={{ background: 'var(--bg-deep)', border: '1px solid var(--elevated)' }}
    >
      <div className="flex items-start gap-2">
        <SourceBadge source={source} uri={uri} />
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-indigo-400 hover:text-indigo-300 font-medium truncate leading-snug transition-colors"
          >
            {title}
          </a>
        ) : (
          <span className="text-[13px] text-ink font-medium truncate leading-snug">
            {title}
          </span>
        )}
      </div>

      <div className="text-[11px] text-fade pl-4 flex gap-1.5 flex-wrap items-center">
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
        <div className="pl-4">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: '#2a2000', color: '#c8a030' }}
          >
            Source may be outdated
          </span>
        </div>
      )}

      {provStatus.is_superseded && (
        <div className="pl-4">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: '#2a1800', color: '#c07030' }}
          >
            Newer version available
          </span>
        </div>
      )}

      {excerpt && (
        <p className="text-[11px] text-fade italic pl-4 leading-relaxed line-clamp-3 opacity-70">
          "{excerpt}"
        </p>
      )}
    </div>
  )
}
