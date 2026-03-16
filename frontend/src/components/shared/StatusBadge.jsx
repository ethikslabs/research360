const CONFIG = {
  PENDING:    { dot: 'bg-amber-400 animate-pulse', label: 'Processing', text: 'text-amber-400' },
  EXTRACTED:  { dot: 'bg-amber-400 animate-pulse', label: 'Processing', text: 'text-amber-400' },
  TRANSFORMED:{ dot: 'bg-amber-400 animate-pulse', label: 'Processing', text: 'text-amber-400' },
  CHUNKED:    { dot: 'bg-amber-400 animate-pulse', label: 'Processing', text: 'text-amber-400' },
  INDEXED:    { dot: 'bg-green-400',               label: 'Indexed',    text: 'text-green-400' },
  FAILED:     { dot: 'bg-red-400',                 label: 'Failed',     text: 'text-red-400' },
}

export default function StatusBadge({ status }) {
  const cfg = CONFIG[status] || CONFIG.PENDING
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}
