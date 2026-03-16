const FILLER_WORDS = /\b(um+|uh+|you know|like,)\b/gi

export function transform(rawText) {
  let text = rawText

  // Normalise unicode to NFC
  text = text.normalize('NFC')

  // Strip control characters (except newlines and tabs)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // Remove filler words as standalone tokens
  text = text.replace(FILLER_WORDS, '')

  // Normalise whitespace within lines
  text = text.replace(/[^\S\n]+/g, ' ')

  // Reconstruct broken paragraphs — join lines that don't end with sentence-ending punctuation
  text = text.replace(/([^.!?\n])\n([^\n])/g, '$1 $2')

  // Collapse 3+ newlines to double newline
  text = text.replace(/\n{3,}/g, '\n\n')

  // Trim leading/trailing whitespace per line
  text = text.split('\n').map(l => l.trim()).join('\n')

  text = text.trim()

  // Identify semantic boundaries — positions of double newlines and headers
  const boundaries = []
  const lines = text.split('\n')
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '' || /^#{1,6}\s/.test(line) || /^[A-Z][^a-z]{3,}$/.test(line)) {
      boundaries.push(pos)
    }
    pos += line.length + 1
  }

  return { text, boundaries }
}
