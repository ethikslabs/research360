import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FileUpload from './FileUpload.jsx'
import UrlIngest from './UrlIngest.jsx'

const TABS = ['File', 'URL']

export default function IngestView() {
  const [tab, setTab] = useState('File')
  const navigate = useNavigate()

  function onSuccess() {
    navigate('/library')
  }

  return (
    <div className="flex-1 flex flex-col p-8 max-w-2xl w-full overflow-y-auto">
      <h1 className="text-lg font-semibold text-[#f0f0f0] mb-6">Ingest</h1>

      <div className="flex gap-1 mb-6 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded text-sm transition-colors',
              tab === t
                ? 'bg-[#242424] text-[#f0f0f0]'
                : 'text-[#8a8a8a] hover:text-[#f0f0f0]',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'File' ? (
        <FileUpload onSuccess={onSuccess} />
      ) : (
        <UrlIngest onSuccess={onSuccess} />
      )}
    </div>
  )
}
