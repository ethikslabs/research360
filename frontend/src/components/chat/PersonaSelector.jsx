const PERSONAS = ['strategist', 'analyst']

export default function PersonaSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fade">Persona</span>
      <div className="flex gap-1">
        {PERSONAS.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              'px-3 py-1 rounded text-xs capitalize transition-colors',
              value === p
                ? 'bg-indigo-600 text-white'
                : 'bg-surface border border-line text-fade hover:text-ink',
            ].join(' ')}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
