const COMPLEXITIES = ['simple', 'detailed', 'deep']

export default function ComplexitySelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[#8a8a8a]">Depth</span>
      <div className="flex gap-1">
        {COMPLEXITIES.map(c => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={[
              'px-3 py-1 rounded text-xs capitalize transition-colors',
              value === c
                ? 'bg-indigo-600 text-white'
                : 'bg-[#1a1a1a] border border-[#2e2e2e] text-[#8a8a8a] hover:text-[#f0f0f0]',
            ].join(' ')}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
