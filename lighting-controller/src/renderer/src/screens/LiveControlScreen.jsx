import React, { useState } from 'react'
import useStore from '../store'
import ColorPicker from '../components/ColorPicker'

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function FixtureTile({ fixture }) {
  const fixtureState   = useStore(s => s.fixtureState)
  const setFixtureColor = useStore(s => s.setFixtureColor)
  const [open, setOpen] = useState(false)

  const { r = 0, g = 0, b = 0 } = fixtureState[fixture.id] || {}
  const hex = rgbToHex(r, g, b)
  const dim = r + g + b
  const textColor = dim > 200 ? '#000' : '#fff'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-between rounded-xl border border-surface-600 hover:border-surface-500 p-2 transition-all aspect-square"
        style={{ background: hex }}
      >
        <span className="text-[10px] font-mono opacity-60" style={{ color: textColor }}>
          {fixture.id}
        </span>
        <span className="text-[10px] text-center leading-tight" style={{ color: textColor }}>
          {fixture.name}
        </span>
        <span className="text-[10px] font-mono opacity-60" style={{ color: textColor }}>
          {hex}
        </span>
      </button>

      {open && (
        <ColorPicker
          r={r} g={g} b={b}
          onChange={(nr, ng, nb) => setFixtureColor(fixture.id, nr, ng, nb)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export default function LiveControlScreen() {
  const fixtures       = useStore(s => s.fixtures)
  const groups         = useStore(s => s.groups)
  const setGroupColor  = useStore(s => s.setGroupColor)
  const blackoutActive = useStore(s => s.blackoutActive)
  const toggleBlackout = useStore(s => s.toggleBlackout)

  const [selectedGroup, setSelectedGroup]   = useState('all')
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [flash, setFlash]                   = useState(false)

  const allGroups = [{ id: 'all', name: 'All Fixtures' }, ...groups]

  const handleFlashDown = () => {
    setFlash(true)
    fixtures.forEach(f => window.api.setFixture(f.id, 255, 255, 255))
  }
  const handleFlashUp = () => {
    setFlash(false)
    // restore state
    fixtures.forEach(f => {
      const el = document.querySelector(`[data-fid="${f.id}"]`)
      // trigger re-broadcast via store
    })
    window.api.setBlackout(blackoutActive)
  }

  if (fixtures.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <div className="text-center">
          <div className="text-4xl mb-3">🔌</div>
          <div>No fixtures loaded. Go to Settings to load a fixture file.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Group bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {allGroups.map(g => (
          <button
            key={g.id}
            onClick={() => setSelectedGroup(g.id)}
            className={`px-3 py-1 rounded-lg text-sm transition-colors
              ${selectedGroup === g.id
                ? 'bg-accent-blue text-white'
                : 'bg-surface-700 text-gray-400 hover:bg-surface-600'}`}
          >
            {g.name}
          </button>
        ))}

        <div className="flex-1" />

        {/* Flash */}
        <button
          onMouseDown={handleFlashDown}
          onMouseUp={handleFlashUp}
          onMouseLeave={handleFlashUp}
          className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors select-none
            ${flash ? 'bg-white text-black' : 'bg-surface-700 text-gray-400 hover:bg-surface-600'}`}
        >
          FLASH
        </button>

        {/* Group color */}
        <button
          onClick={() => setGroupPickerOpen(true)}
          className="px-4 py-1.5 rounded-lg text-sm bg-surface-700 text-gray-300 hover:bg-surface-600"
        >
          Set Group Color
        </button>
      </div>

      {/* Fixture grid */}
      <div className="flex-1 grid gap-3 content-start"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {fixtures.map(f => <FixtureTile key={f.id} fixture={f} />)}
      </div>

      {groupPickerOpen && (
        <ColorPicker
          r={0} g={0} b={0}
          onChange={(r, g, b) => setGroupColor(selectedGroup, r, g, b)}
          onClose={() => setGroupPickerOpen(false)}
        />
      )}
    </div>
  )
}
