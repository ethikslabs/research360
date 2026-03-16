const PERSONAS = ['strategist', 'analyst']

export default function PersonaSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[#8a8a8a]">Persona</span>
      <div className="flex gap-1">
        {PERSONAS.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              'px-3 py-1 rounded text-xs capitalize transition-colors',
              value === p
                ? 'bg-indigo-600 text-white'
                : 'bg-[#1a1a1a] border border-[#2e2e2e] text-[#8a8a8a] hover:text-[#f0f0f0]',
            ].join(' ')}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
