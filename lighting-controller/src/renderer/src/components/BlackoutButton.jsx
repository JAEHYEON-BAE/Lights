import React from 'react'
import useStore from '../store'

export default function BlackoutButton() {
  const blackoutActive = useStore(s => s.blackoutActive)
  const toggleBlackout = useStore(s => s.toggleBlackout)

  return (
    <div className="flex flex-col items-center justify-end p-3 pb-5 gap-2 border-l border-surface-700 flex-shrink-0">
      <button
        onClick={toggleBlackout}
        className={`
          w-14 h-24 rounded-xl font-bold text-xs tracking-widest
          flex flex-col items-center justify-center gap-1
          transition-all duration-150 select-none
          ${blackoutActive
            ? 'bg-accent-red text-white shadow-lg shadow-red-900/60 scale-95'
            : 'bg-surface-700 text-gray-400 hover:bg-surface-600 hover:text-gray-200'}
        `}
      >
        <span className="text-2xl leading-none">⬛</span>
        <span>BLK</span>
        <span className="text-[9px] text-gray-500">SPACE</span>
      </button>
    </div>
  )
}
