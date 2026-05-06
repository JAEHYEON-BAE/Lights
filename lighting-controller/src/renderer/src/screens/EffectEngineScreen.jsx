import React, { useState, useEffect } from 'react'
import useStore from '../store'
import { EFFECTS } from '../engines/effect-engine'
import ColorPicker from '../components/ColorPicker'

const EFFECT_LIST = Object.entries(EFFECTS).map(([key, val]) => ({ key, name: val.name, defaultParams: val.defaultParams }))
const NONE_KEY    = '__none__'

export default function EffectEngineScreen({ effectEngine }) {
  const fixtures        = useStore(s => s.fixtures)
  const groups          = useStore(s => s.groups)
  const fixtureState    = useStore(s => s.fixtureState)
  const fixtureEffects  = useStore(s => s.fixtureEffects)
  const setFixtureEffect  = useStore(s => s.setFixtureEffect)
  const clearFixtureEffect = useStore(s => s.clearFixtureEffect)
  const saveScene       = useStore(s => s.saveScene)
  const setFixtureColor = useStore(s => s.setFixtureColor)

  const [selectedIds, setSelectedIds]   = useState([])
  const [effectKey, setEffectKey]       = useState('sinePulse')
  const [params, setParams]             = useState({ ...EFFECTS['sinePulse'].defaultParams })
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [sceneName, setSceneName]       = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)

  // When a single fixture is clicked, load its current effect into the editor
  const loadFixtureIntoEditor = (id) => {
    const entry = fixtureEffects[id]
    if (entry) {
      setEffectKey(entry.effectKey)
      setParams({ ...entry.params })
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      const next = [...prev, id]
      if (next.length === 1) loadFixtureIntoEditor(id)
      return next
    })
  }

  const selectGroup = (groupId) => {
    const ids = groupId === 'all'
      ? fixtures.map(f => f.id)
      : fixtures.filter(f => f.group === groupId).map(f => f.id)
    setSelectedIds(ids)
  }

  useEffect(() => {
    setParams({ ...EFFECTS[effectKey]?.defaultParams })
  }, [effectKey])

  const setParam = (key, value) => setParams(p => ({ ...p, [key]: value }))

  const applyToSelected = () => {
    if (selectedIds.length === 0) return
    effectEngine.current?.setFixtureEffect(selectedIds, effectKey, params)
    setFixtureEffect(selectedIds, effectKey, params)
  }

  const clearSelected = () => {
    if (selectedIds.length === 0) return
    effectEngine.current?.clearFixtureEffect(selectedIds)
    clearFixtureEffect(selectedIds)
  }

  const handleSaveScene = async () => {
    if (!sceneName.trim()) return
    const scene = {
      version: '2.0',
      scene_id: `scene_${Date.now()}`,
      name: sceneName.trim(),
      fade_in_ms: 0,
      fixtures: fixtures.map(f => {
        const color = fixtureState[f.id] || { d: 254, r: 0, g: 0, b: 0 }
        const entry = fixtureEffects[f.id] || null
        return {
          id:           f.id,
          dim:          color.d ?? 254,
          r:            color.r,
          g:            color.g,
          b:            color.b,
          effect:       entry?.effectKey ?? null,
          effectParams: entry?.params    ?? {},
        }
      })
    }
    await saveScene(scene)
    setSceneName('')
    setShowSaveForm(false)
  }

  const allGroups = [{ id: 'all', name: 'All' }, ...groups]

  return (
    <div className="flex gap-4 h-full">

      {/* ── Left: fixture list ── */}
      <div className="w-44 flex-shrink-0 flex flex-col gap-2">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Fixtures</div>

        {/* Group quick-select */}
        <div className="flex flex-wrap gap-1 mb-1">
          {allGroups.map(g => (
            <button key={g.id} onClick={() => selectGroup(g.id)}
              className="px-2 py-0.5 rounded text-xs bg-surface-700 text-gray-400 hover:bg-surface-600">
              {g.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 overflow-auto flex-1">
          {fixtures.map(f => {
            const entry    = fixtureEffects[f.id]
            const checked  = selectedIds.includes(f.id)
            const c        = fixtureState[f.id] || { d: 254, r: 0, g: 0, b: 0 }
            const dim      = (c.d ?? 254) / 254
            const swatch   = `rgb(${Math.round(c.r*dim)},${Math.round(c.g*dim)},${Math.round(c.b*dim)})`
            return (
              <label key={f.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none transition-colors
                  ${checked ? 'bg-surface-600' : 'hover:bg-surface-700'}`}>
                <input type="checkbox" checked={checked}
                  onChange={() => toggleSelect(f.id)}
                  className="accent-accent-blue" />
                <div className="w-3 h-3 rounded-full flex-shrink-0 border border-surface-500"
                  style={{ background: swatch }} />
                <span className="text-xs flex-1 truncate">{f.name}</span>
                {entry && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0" />
                )}
              </label>
            )
          })}
        </div>

        <button onClick={() => setSelectedIds([])}
          className="text-xs text-gray-600 hover:text-gray-400 text-left">
          Deselect all
        </button>
      </div>

      {/* ── Middle: effect editor ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="bg-surface-800 rounded-2xl p-5 flex flex-col gap-4">

          {/* Effect selector */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Effect</div>
            <div className="flex flex-wrap gap-2">
              {EFFECT_LIST.map(e => (
                <button key={e.key} onClick={() => setEffectKey(e.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors
                    ${effectKey === e.key
                      ? 'bg-accent-blue text-white'
                      : 'bg-surface-700 text-gray-400 hover:bg-surface-600'}`}>
                  {e.name}
                </button>
              ))}
            </div>
          </div>

          {/* Speed */}
          {'speed' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Speed: {params.speed.toFixed(1)}
              </label>
              <input type="range" min="0.1" max="20" step="0.1"
                value={params.speed}
                onChange={e => setParam('speed', +e.target.value)}
                className="w-full" />
            </div>
          )}

          {/* Phase Offset */}
          {'phaseOffset' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Phase Offset: {params.phaseOffset}°
              </label>
              <input type="range" min="0" max="180" step="1"
                value={params.phaseOffset}
                onChange={e => setParam('phaseOffset', +e.target.value)}
                className="w-full" />
            </div>
          )}

          {/* Min Brightness */}
          {'minBrightness' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Min Brightness: {Math.round(params.minBrightness * 100)}%
              </label>
              <input type="range" min="0" max="1" step="0.01"
                value={params.minBrightness}
                onChange={e => setParam('minBrightness', +e.target.value)}
                className="w-full" />
            </div>
          )}

          {/* Color */}
          {'r' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-2">Color</label>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-10 rounded-lg border border-surface-600 cursor-pointer hover:border-accent-blue flex-shrink-0"
                  style={{ background: `rgb(${params.r},${params.g},${params.b})` }}
                  onClick={() => setColorPickerOpen(true)}
                />
                {[['R','r','#ef4444'],['G','g','#10b981'],['B','b','#3b82f6']].map(([label,key,color]) => (
                  <div key={key} className="flex-1">
                    <label className="text-xs mb-0.5 block" style={{ color }}>{label}</label>
                    <input type="range" min="0" max="255" step="1"
                      value={params[key]}
                      onChange={e => setParam(key, +e.target.value)}
                      className="w-full" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={applyToSelected}
            disabled={selectedIds.length === 0}
            className="flex-1 py-2 rounded-xl text-sm font-bold bg-accent-green text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-green-500 transition-colors">
            Apply to {selectedIds.length} fixture{selectedIds.length !== 1 ? 's' : ''}
          </button>
          <button onClick={clearSelected}
            disabled={selectedIds.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-700 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-surface-600 transition-colors">
            Clear
          </button>
        </div>

        {/* Save as scene */}
        <div className="bg-surface-800 rounded-2xl p-4 flex flex-col gap-2">
          {showSaveForm ? (
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Scene name…"
                value={sceneName}
                onChange={e => setSceneName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveScene() }}
                className="flex-1 bg-surface-700 rounded-lg px-3 py-1.5 text-sm outline-none border border-surface-600 focus:border-accent-blue"
              />
              <button onClick={handleSaveScene}
                className="px-3 py-1.5 rounded-lg bg-accent-blue text-white text-sm">Save</button>
              <button onClick={() => setShowSaveForm(false)}
                className="px-3 py-1.5 rounded-lg bg-surface-700 text-gray-400 text-sm">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setShowSaveForm(true)}
              className="text-sm text-gray-400 hover:text-white transition-colors text-left">
              + Save current state as scene…
            </button>
          )}
        </div>
      </div>

      {colorPickerOpen && (
        <ColorPicker
          r={params.r || 0} g={params.g || 0} b={params.b || 0}
          onChange={(r, g, b) => setParams(p => ({ ...p, r, g, b }))}
          onClose={() => setColorPickerOpen(false)}
        />
      )}
    </div>
  )
}
