import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useDocuments from '../../hooks/useDocuments.js'
import DocumentRow from './DocumentRow.jsx'

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Documents', value: 'document' },
  { label: 'URLs', value: 'url' },
  { label: 'YouTube', value: 'youtube' },
]

export default function LibraryView() {
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()
  const { documents, total, loading, error, remove } = useDocuments(filter)

  return (
    <div className="flex-1 flex flex-col p-8 max-w-4xl w-full overflow-y-auto mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-ink">
          Library
          {!loading && (
            <span className="ml-2 text-sm font-normal text-fade">{total}</span>
          )}
        </h1>
        <button
          onClick={() => navigate('/ingest')}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          + Ingest
        </button>
      </div>

      <div className="flex gap-1 mb-4 bg-surface border border-line rounded-lg p-1 w-fit">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={[
              'px-3 py-1 rounded text-sm transition-colors',
              filter === f.value
                ? 'bg-elevated text-ink'
                : 'text-fade hover:text-ink',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-fade">Loading…</div>
        ) : error ? (
          <div className="px-5 py-8 text-center text-sm text-red-400">{error}</div>
        ) : documents.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-fade text-sm">No documents yet</div>
            <button
              onClick={() => navigate('/ingest')}
              className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm"
            >
              Ingest your first document →
            </button>
          </div>
        ) : (
          documents.map(doc => (
            <DocumentRow key={doc.id} doc={doc} onDelete={remove} />
          ))
        )}
      </div>
    </div>
  )
}
