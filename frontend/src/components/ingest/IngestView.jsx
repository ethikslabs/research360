import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FileUpload from './FileUpload.jsx'
import UrlIngest from './UrlIngest.jsx'
import YouTubeIngest from './YouTubeIngest.jsx'

const TABS = ['File', 'URL', 'YouTube']

export default function IngestView() {
  const [tab, setTab] = useState('File')
  const navigate = useNavigate()

  function onSuccess() {
    navigate('/library')
  }

  return (
    <div className="flex-1 flex flex-col p-8 max-w-2xl w-full overflow-y-auto mx-auto">
      <h1 className="text-lg font-semibold text-ink mb-6">Ingest</h1>

      <div className="flex gap-1 mb-6 bg-surface border border-line rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded text-sm transition-colors',
              tab === t
                ? 'bg-elevated text-ink'
                : 'text-fade hover:text-ink',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'File' && <FileUpload onSuccess={onSuccess} />}
      {tab === 'URL' && <UrlIngest onSuccess={onSuccess} />}
      {tab === 'YouTube' && <YouTubeIngest onSuccess={onSuccess} />}
    </div>
  )
}
