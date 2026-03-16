import { useState, useRef } from 'react'
import { ingestFile } from '../../api/research360.js'

const ACCEPTED = ['.pdf', '.docx', '.pptx']
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (ext === 'pdf') return '📄'
  if (ext === 'docx') return '📝'
  if (ext === 'pptx') return '📊'
  return '📄'
}

export default function FileUpload({ onSuccess }) {
  const [queue, setQueue] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  function addFiles(files) {
    const valid = Array.from(files).filter(f =>
      ACCEPTED_MIME.includes(f.type) ||
      ACCEPTED.some(ext => f.name.toLowerCase().endsWith(ext))
    )
    setQueue(prev => [
      ...prev,
      ...valid.map(f => ({ file: f, title: '', progress: null, error: null, done: false })),
    ])
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function onDragOver(e) { e.preventDefault(); setDragging(true) }
  function onDragLeave() { setDragging(false) }

  function onBrowse(e) { addFiles(e.target.files); e.target.value = '' }

  function updateTitle(idx, value) {
    setQueue(prev => prev.map((item, i) => i === idx ? { ...item, title: value } : item))
  }

  function removeFile(idx) {
    setQueue(prev => prev.filter((_, i) => i !== idx))
  }

  async function uploadAll() {
    if (!queue.length || uploading) return
    setUploading(true)

    const updated = [...queue]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].done) continue
      updated[i] = { ...updated[i], progress: 'uploading', error: null }
      setQueue([...updated])
      try {
        await ingestFile(updated[i].file, updated[i].title || undefined)
        updated[i] = { ...updated[i], progress: null, done: true }
        setQueue([...updated])
      } catch (err) {
        updated[i] = { ...updated[i], progress: null, error: err.message }
        setQueue([...updated])
      }
    }

    setUploading(false)
    const allDone = updated.every(item => item.done)
    if (allDone) onSuccess()
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-2 cursor-pointer transition-colors',
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : 'border-[#2e2e2e] hover:border-[#3e3e3e]',
        ].join(' ')}
      >
        <span className="text-2xl">↑</span>
        <span className="text-[#f0f0f0] text-sm">Drag files here, or click to browse</span>
        <span className="text-[#8a8a8a] text-xs">PDF · DOCX · PPTX</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          className="hidden"
          onChange={onBrowse}
        />
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          {queue.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg px-4 py-3">
              <span className="text-lg">{fileIcon(item.file.name)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#f0f0f0] truncate">{item.file.name}</div>
                <div className="text-xs text-[#8a8a8a]">{formatBytes(item.file.size)}</div>
                {item.error && <div className="text-xs text-red-400 mt-1">{item.error}</div>}
              </div>
              <input
                type="text"
                placeholder="Title (optional)"
                value={item.title}
                onChange={e => updateTitle(idx, e.target.value)}
                disabled={item.done || item.progress === 'uploading'}
                className="w-40 bg-[#242424] border border-[#2e2e2e] rounded px-2 py-1 text-xs text-[#f0f0f0] placeholder-[#8a8a8a] focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              {item.done ? (
                <span className="text-xs text-green-400">✓</span>
              ) : item.progress === 'uploading' ? (
                <span className="text-xs text-indigo-400">uploading…</span>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); removeFile(idx) }}
                  className="text-[#8a8a8a] hover:text-red-400 text-sm px-1"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <button
            onClick={uploadAll}
            disabled={uploading || queue.every(i => i.done)}
            className="self-end mt-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
          >
            {uploading ? 'Uploading…' : `Upload ${queue.filter(i => !i.done).length} file${queue.filter(i => !i.done).length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
