export default function SuggestionChips({ suggestions, onSelect }) {
  if (!suggestions?.length) return null

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s)}
          className="border border-white/20 rounded-full px-3 py-1 text-xs text-[#8a8a8a] hover:border-indigo-500 hover:text-[#f0f0f0] transition-colors cursor-pointer"
        >
          {s}
        </button>
      ))}
    </div>
  )
}
