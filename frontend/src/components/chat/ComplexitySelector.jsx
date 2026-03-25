const COMPLEXITIES = ['simple', 'detailed', 'deep']

export default function ComplexitySelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-fade">Depth</span>
      <div className="flex gap-1">
        {COMPLEXITIES.map(c => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={[
              'px-3 py-1 rounded text-xs capitalize transition-colors',
              value === c
                ? 'bg-indigo-600 text-white'
                : 'bg-surface border border-line text-fade hover:text-ink',
            ].join(' ')}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
