import { useState, useCallback } from 'react'
import { query } from '../api/research360.js'
import { DEFAULTS } from '../config/index.js'

export default function useChat() {
  const [messages, setMessages] = useState([])
  const [persona, setPersona] = useState(DEFAULTS.persona)
  const [complexity, setComplexity] = useState(DEFAULTS.complexity)
  const [documentId, setDocumentId] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async (queryText) => {
    const text = queryText.trim()
    if (!text || loading) return

    setError(null)
    setMessages(prev => [...prev, { role: 'user', content: text, id: Date.now() }])
    setLoading(true)

    try {
      const res = await query({
        query: text,
        persona,
        complexity,
        sessionId,
        filters: documentId ? { document_id: documentId } : {},
      })

      if (!sessionId) setSessionId(res.session_id)

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          id: Date.now() + 1,
          content: res.answer,
          persona: res.persona,
          complexity: res.complexity,
          sources: res.sources || [],
          suggestions: res.suggestions || [],
          session_id: res.session_id,
        },
      ])
    } catch (err) {
      setError(err.message)
      setMessages(prev => [
        ...prev,
        {
          role: 'error',
          id: Date.now() + 1,
          content: err.message,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [loading, persona, complexity, documentId, sessionId])

  return {
    messages,
    persona,
    setPersona,
    complexity,
    setComplexity,
    documentId,
    setDocumentId,
    sessionId,
    loading,
    error,
    submit,
  }
}
