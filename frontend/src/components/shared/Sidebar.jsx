import { NavLink } from 'react-router-dom'

const nav = [
  { to: '/chat', label: 'Chat' },
  { to: '/library', label: 'Library' },
  { to: '/ingest', label: 'Ingest' },
]

export default function Sidebar() {
  return (
    <aside className="w-[120px] min-h-screen flex flex-col border-r border-[#2e2e2e] bg-[#0f0f0f]">
      <div className="px-4 py-5">
        <span className="text-base font-semibold text-[#f0f0f0] tracking-tight">R360</span>
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2 mt-2">
        {nav.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex items-center px-3 py-2 rounded text-sm transition-colors',
                isActive
                  ? 'border-l-2 border-indigo-500 bg-white/5 text-[#f0f0f0] pl-[10px]'
                  : 'text-[#8a8a8a] hover:text-[#f0f0f0] hover:bg-white/5',
              ].join(' ')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4">
        <span className="text-[11px] text-[#8a8a8a]">ethikslabs</span>
      </div>
    </aside>
  )
}
