import { useEffect, useState } from 'react'
import { listDocuments } from '../../api/research360.js'

function sourceIcon(type) {
  if (type === 'youtube') return '▶'
  if (type === 'url') return '🔗'
  return '📄'
}

export default function DocumentPicker({ value, onChange }) {
  const [docs, setDocs] = useState([])

  useEffect(() => {
    listDocuments({ status: 'INDEXED', limit: 100 })
      .then(res => setDocs(res.documents || []))
      .catch(() => {})
  }, [])

  if (!docs.length) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fade shrink-0">Scope</span>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="text-xs bg-surface border border-line text-ink rounded px-2 py-1 max-w-[180px] truncate focus:outline-none focus:border-indigo-500"
      >
        <option value="">All documents</option>
        {docs.map(doc => (
          <option key={doc.id} value={doc.id}>
            {sourceIcon(doc.source_type)} {doc.title || doc.file_name || 'Untitled'}
          </option>
        ))}
      </select>
    </div>
  )
}
