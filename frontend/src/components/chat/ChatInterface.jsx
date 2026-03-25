import { useEffect, useRef } from 'react'
import useChat from '../../hooks/useChat.js'
import ChatInput from './ChatInput.jsx'
import MessageBubble from './MessageBubble.jsx'
import PersonaSelector from './PersonaSelector.jsx'
import ComplexitySelector from './ComplexitySelector.jsx'
import DocumentPicker from './DocumentPicker.jsx'
import LoadingDots from '../shared/LoadingDots.jsx'

const EMPTY_SUGGESTIONS = [
  'What were the key insights from my last upload?',
  'Summarise my research on cloud architecture',
  'What are the main themes across my documents?',
]

export default function ChatInterface() {
  const { messages, persona, setPersona, complexity, setComplexity, documentId, setDocumentId, loading, submit } = useChat()
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const isEmpty = messages.length === 0

  // index of the last assistant message — chips only show there
  const lastAssistantIdx = messages.reduce(
    (last, msg, i) => (msg.role === 'assistant' ? i : last),
    -1
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Selectors */}
      <div className="flex items-center gap-4 px-6 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
        <PersonaSelector value={persona} onChange={setPersona} />
        <ComplexitySelector value={complexity} onChange={setComplexity} />
        <div className="ml-auto">
          <DocumentPicker value={documentId} onChange={setDocumentId} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-4">
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
            <div>
              <div className="text-xl font-semibold text-ink mb-2">Research360</div>
              <div className="text-sm text-fade">
                Ask anything across your ingested knowledge base.
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {EMPTY_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="text-left px-4 py-3 bg-surface border border-line rounded-lg text-sm text-fade hover:text-ink hover:border-fade transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isLast={i === lastAssistantIdx && !loading}
                onSuggestion={submit}
              />
            ))}
            {loading && (
              <div className="bg-elevated rounded-lg px-4 py-3 w-fit">
                <LoadingDots />
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSubmit={submit} disabled={loading} />
    </div>
  )
}
