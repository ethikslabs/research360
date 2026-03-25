import { NavLink } from 'react-router-dom'

const nav = [
  { to: '/chat',    label: 'Chat',    glyph: '◈' },
  { to: '/library', label: 'Library', glyph: '◫' },
  { to: '/ingest',  label: 'Ingest',  glyph: '◎' },
]

export default function Sidebar() {
  return (
    <aside className="w-[108px] min-h-screen flex flex-col bg-deep" style={{ borderRight: '1px solid var(--elevated)' }}>

      {/* Logotype */}
      <div className="px-5 pt-6 pb-5">
        <div className="font-display leading-none" style={{ letterSpacing: '-0.02em' }}>
          <span className="text-[20px] font-bold text-ink">R</span>
          <span className="text-[20px] font-bold" style={{ color: '#5c8a72' }}>360</span>
        </div>
        <div className="mt-1.5 text-[8px] uppercase tracking-[0.22em] text-fade">
          research
        </div>
      </div>

      {/* Hairline divider */}
      <div className="mx-5 mb-3" style={{ height: '1px', background: 'var(--elevated)' }} />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-px px-3">
        {nav.map(({ to, label, glyph }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 px-2.5 py-2 rounded transition-colors duration-150',
                isActive
                  ? 'bg-surface text-ink'
                  : 'text-fade hover:text-ink hover:bg-surface/50',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className="text-[11px] shrink-0 transition-colors"
                  style={{ color: isActive ? '#5c8a72' : undefined }}
                >
                  {glyph}
                </span>
                <span className="text-[10px] uppercase tracking-[0.1em]">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer mark */}
      <div className="px-5 py-5">
        <div
          className="text-[8px] uppercase tracking-[0.2em] text-fade opacity-50"
          style={{ letterSpacing: '0.18em' }}
        >
          ethikslabs
        </div>
      </div>
    </aside>
  )
}
