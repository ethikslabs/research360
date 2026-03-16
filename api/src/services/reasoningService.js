import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config/env.js'
import { PERSONAS } from '../config/personas.js'

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

const COMPLEXITY_CONFIG = {
  simple:   { style: 'Brief, direct answer. 2-3 sentences maximum.' },
  detailed: { style: 'Structured analysis. Use sections if helpful.' },
  deep:     { style: 'Comprehensive reasoning. Full evidence citation.' },
}

export async function reason({ query, chunks, persona = 'strategist', complexity = 'detailed', history = [] }) {
  const personaPrompt = PERSONAS[persona] || PERSONAS.strategist
  const config_ = COMPLEXITY_CONFIG[complexity] || COMPLEXITY_CONFIG.detailed

  const contextText = chunks.map((c, i) =>
    `[Source ${i + 1}] ${c.document_title || 'Untitled'} (${c.source_type})\n${c.chunk_text}`
  ).join('\n\n---\n\n')

  const systemPrompt = `You are Research360, a knowledge reasoning assistant for ethikslabs.

${personaPrompt}

You reason strictly from the provided context. You do not invent facts.
If the context does not contain sufficient information, say so clearly.
Reasoning style: ${config_.style}

Always end your response with exactly 3 suggested follow-up questions the user might want to explore next.

Format your full response as JSON:
{
  "answer": "your full answer here",
  "suggestions": ["question 1", "question 2", "question 3"]
}`

  // Last 6 turns of history
  const recentHistory = history.slice(-6)
  const messages = [
    ...recentHistory.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    {
      role: 'user',
      content: `Context:\n${contextText}\n\nQuestion: ${query}`,
    },
  ]

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  })

  const raw = res.content[0].text.trim()

  let parsed
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  } catch {
    parsed = { answer: raw, suggestions: [] }
  }

  return {
    answer: parsed.answer || raw,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
    persona,
    complexity,
    sources: chunks,
  }
}
