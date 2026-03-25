import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import SourceCard from './SourceCard.jsx'
import SuggestionChips from './SuggestionChips.jsx'

function UserBubble({ content }) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div
        className="max-w-[70%] text-white px-4 py-3 text-[13px] leading-relaxed"
        style={{
          background: '#4a7560',
          borderRadius: '14px 14px 3px 14px',
        }}
      >
        {content}
      </div>
    </div>
  )
}

function SourcesAccordion({ sources }) {
  const [open, setOpen] = useState(false)

  if (!sources?.length) return null

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-fade hover:text-ink transition-colors mb-2"
      >
        <span className="transition-transform" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          ▾
        </span>
        Sources ({sources.length})
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {sources.map((src, i) => (
            <SourceCard key={src.chunk_id || i} source={src} />
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantBubble({ msg, isLast, onSuggestion }) {
  return (
    <div
      className="rounded-lg px-5 py-4 text-ink animate-fade-up"
      style={{ background: 'var(--surface)', border: '1px solid var(--elevated)' }}
    >
      {msg.persona && (
        <span
          className="inline-block mb-3 text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded"
          style={{ background: '#1e2e26', color: '#7faa94' }}
        >
          {msg.persona}
        </span>
      )}
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{msg.content}</ReactMarkdown>
      </div>
      <SourcesAccordion sources={msg.sources} />
      {isLast && (
        <SuggestionChips suggestions={msg.suggestions} onSelect={onSuggestion} />
      )}
    </div>
  )
}

function ErrorBubble({ content }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-[13px]"
      style={{ background: '#1e1010', border: '1px solid #3a1a1a', color: '#c08080' }}
    >
      {content}
    </div>
  )
}

export default function MessageBubble({ msg, isLast, onSuggestion }) {
  if (msg.role === 'user') return <UserBubble content={msg.content} />
  if (msg.role === 'error') return <ErrorBubble content={msg.content} />
  return <AssistantBubble msg={msg} isLast={isLast} onSuggestion={onSuggestion} />
}
