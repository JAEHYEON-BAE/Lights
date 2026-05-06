import React from 'react'
import useStore from '../store'

const NAV = [
  { id: 'live',     label: 'Live',     icon: '✦' },
  { id: 'scenes',   label: 'Scenes',   icon: '▤' },
  { id: 'cues',     label: 'Cue List', icon: '▶' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

export default function Sidebar() {
  const active        = useStore(s => s.activeScreen)
  const setActive     = useStore(s => s.setActiveScreen)
  const connected     = useStore(s => s.connected)

  return (
    <div className="w-16 flex flex-col items-center py-4 gap-1 bg-surface-800 border-r border-surface-700 flex-shrink-0">
      {/* logo dot */}
      <div className={`w-3 h-3 rounded-full mb-4 ${connected ? 'bg-accent-green' : 'bg-surface-600'}`} />

      {NAV.map(n => (
        <button
          key={n.id}
          onClick={() => setActive(n.id)}
          title={n.label}
          className={`
            w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5
            text-xs transition-colors
            ${active === n.id
              ? 'bg-accent-blue text-white'
              : 'text-gray-500 hover:bg-surface-700 hover:text-gray-300'}
          `}
        >
          <span className="text-base leading-none">{n.icon}</span>
          <span className="text-[9px] leading-none">{n.label}</span>
        </button>
      ))}
    </div>
  )
}
