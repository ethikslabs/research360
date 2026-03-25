import { useState, useEffect } from 'react'

const MESSAGES = [
  null,
  'On it — searching your knowledge base…',
  'Reasoning across sources…',
  'Pulling it together…',
  'Almost there…',
  'Still working — this one needs some thought…',
]

export default function LoadingDots() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const msg = MESSAGES[Math.min(tick, MESSAGES.length - 1)]

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-fade animate-bounce"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
      {msg && (
        <span className="text-xs text-fade animate-fade-up">{msg}</span>
      )}
    </div>
  )
}
