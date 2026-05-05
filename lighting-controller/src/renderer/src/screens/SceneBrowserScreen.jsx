import React, { useState } from 'react'
import useStore from '../store'
import { EFFECTS } from '../engines/effect-engine'

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function SceneThumbnail({ scene, fixtureCount }) {
  const slots = Array.from({ length: Math.min(fixtureCount || 8, 8) }, (_, i) => {
    const f = scene.fixtures.find(x => x.id === i)
    return f ? rgbToHex(f.r, f.g, f.b) : '#111'
  })
  return (
    <div className="grid grid-cols-4 gap-0.5 rounded overflow-hidden w-full h-10">
      {slots.map((color, i) => (
        <div key={i} style={{ background: color }} className="h-full" />
      ))}
    </div>
  )
}

export default function SceneBrowserScreen() {
  const scenes           = useStore(s => s.scenes)
  const fixtures         = useStore(s => s.fixtures)
  const fixtureState     = useStore(s => s.fixtureState)
  const recallScene      = useStore(s => s.recallScene)
  const saveScene        = useStore(s => s.saveScene)
  const deleteScene      = useStore(s => s.deleteScene)
  const activeSceneId    = useStore(s => s.activeSceneId)
  const activeEffect     = useStore(s => s.activeEffect)
  const effectParams     = useStore(s => s.effectParams)
  const effectFixtureIds = useStore(s => s.effectFixtureIds)

  const [search, setSearch]     = useState('')
  const [editName, setEditName] = useState('')
  const [saving, setSaving]     = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  const filtered = scenes.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSaveCurrent = async () => {
    if (!editName.trim()) return
    const scene = {
      version: '1.0',
      scene_id: `scene_${Date.now()}`,
      name: editName.trim(),
      fade_in_ms: 500,
      fade_out_ms: 0,
      fixtures: fixtures.map(f => {
        const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
        return { id: f.id, ...c }
      })
    }
    if (activeEffect) {
      scene.effect = activeEffect
      scene.effectParams = { ...effectParams }
      scene.effectFixtureIds = [...effectFixtureIds]
    }
    await saveScene(scene)
    setEditName('')
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-4 h-full" onClick={() => setContextMenu(null)}>
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search scenes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-surface-700 rounded-lg px-3 py-1.5 text-sm outline-none border border-surface-600 focus:border-accent-blue"
        />
        <button
          onClick={() => setSaving(v => !v)}
          className="px-4 py-1.5 rounded-lg text-sm bg-accent-blue text-white hover:bg-blue-600"
        >
          + Save Current
        </button>
      </div>

      {/* Save form */}
      {saving && (
        <div className="flex gap-2 items-center bg-surface-700 rounded-xl p-3">
          <input
            autoFocus
            type="text"
            placeholder="Scene name…"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrent() }}
            className="flex-1 bg-surface-600 rounded px-3 py-1.5 text-sm outline-none"
          />
          <button onClick={handleSaveCurrent}
            className="px-3 py-1.5 rounded bg-accent-green text-white text-sm">Save</button>
          <button onClick={() => setSaving(false)}
            className="px-3 py-1.5 rounded bg-surface-600 text-gray-400 text-sm">Cancel</button>
        </div>
      )}

      {/* Scene grid */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">
          No scenes saved yet.
        </div>
      ) : (
        <div className="flex-1 grid gap-3 content-start overflow-auto"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {filtered.map(scene => (
            <div
              key={scene.scene_id}
              onDoubleClick={() => recallScene(scene.scene_id)}
              onContextMenu={e => { e.preventDefault(); setContextMenu({ scene, x: e.clientX, y: e.clientY }) }}
              className={`rounded-xl border p-3 cursor-pointer transition-all hover:border-accent-blue/60 select-none
                ${activeSceneId === scene.scene_id
                  ? 'border-accent-blue bg-accent-blue/10'
                  : 'border-surface-600 bg-surface-800'}`}
            >
              <SceneThumbnail scene={scene} fixtureCount={fixtures.length} />
              <div className="mt-2 text-sm font-medium truncate">{scene.name}</div>
              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>{scene.fixtures?.length ?? 0} fx · {scene.fade_in_ms ?? 0}ms</span>
                {scene.effect && (
                  <span className="px-1.5 py-0.5 rounded bg-accent-purple/30 text-purple-300 font-mono">
                    {EFFECTS[scene.effect]?.name ?? scene.effect}
                  </span>
                )}
              </div>
              <button
                onClick={() => recallScene(scene.scene_id)}
                className="mt-2 w-full text-xs py-1 rounded bg-surface-700 hover:bg-accent-blue hover:text-white transition-colors"
              >
                GO
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-700 border border-surface-600 rounded-lg shadow-xl overflow-hidden text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => { recallScene(contextMenu.scene.scene_id); setContextMenu(null) }}
            className="block w-full text-left px-4 py-2 hover:bg-surface-600">Recall</button>
          <button onClick={() => { deleteScene(contextMenu.scene.scene_id); setContextMenu(null) }}
            className="block w-full text-left px-4 py-2 hover:bg-accent-red/30 text-red-400">Delete</button>
        </div>
      )}
    </div>
  )
}
