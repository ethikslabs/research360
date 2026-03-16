import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import SourceCard from './SourceCard.jsx'
import SuggestionChips from './SuggestionChips.jsx'

function UserBubble({ content }) {
  return (
    <div className="flex justify-end animate-fade-up">
      <div className="max-w-[70%] bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed">
        {content}
      </div>
    </div>
  )
}

function SourcesAccordion({ sources }) {
  const [open, setOpen] = useState(true)

  if (!sources?.length) return null

  return (
    <div className="mt-4 border-t border-[#2e2e2e] pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-[#8a8a8a] hover:text-[#f0f0f0] transition-colors mb-2"
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
    <div className="bg-[#242424] rounded-lg px-4 py-4 text-sm text-[#f0f0f0] animate-fade-up">
      {msg.persona && (
        <span className="inline-block mb-3 text-xs px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-300 capitalize">
          {msg.persona}
        </span>
      )}
      <div className="prose prose-invert prose-sm max-w-none leading-relaxed">
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
    <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3 text-sm text-red-400">
      {content}
    </div>
  )
}

export default function MessageBubble({ msg, isLast, onSuggestion }) {
  if (msg.role === 'user') return <UserBubble content={msg.content} />
  if (msg.role === 'error') return <ErrorBubble content={msg.content} />
  return <AssistantBubble msg={msg} isLast={isLast} onSuggestion={onSuggestion} />
}
