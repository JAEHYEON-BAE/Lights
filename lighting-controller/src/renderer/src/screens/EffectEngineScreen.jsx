import React, { useState, useEffect } from 'react'
import useStore from '../store'
import { EFFECTS } from '../engines/effect-engine'
import ColorPicker from '../components/ColorPicker'

const EFFECT_LIST = Object.entries(EFFECTS).map(([key, val]) => ({ key, ...val }))

export default function EffectEngineScreen({ effectEngine }) {
  const fixtures       = useStore(s => s.fixtures)
  const groups         = useStore(s => s.groups)
  const activeEffect   = useStore(s => s.activeEffect)
  const setActiveEffect = useStore(s => s.setActiveEffect)
  const clearEffect    = useStore(s => s.clearEffect)
  const setFixtureColor = useStore(s => s.setFixtureColor)

  const [selectedEffect, setSelectedEffect] = useState('sinePulse')
  const [selectedGroup, setSelectedGroup]   = useState('all')
  const [params, setParams] = useState(EFFECTS[selectedEffect]?.defaultParams || {})
  const [colorPickerField, setColorPickerField] = useState(null)

  const running = useStore(s => s.activeEffect !== null)

  // Sync params when effect changes
  useEffect(() => {
    setParams({ ...EFFECTS[selectedEffect]?.defaultParams })
  }, [selectedEffect])

  const allGroups = [{ id: 'all', name: 'All Fixtures' }, ...groups]

  const getTargetFixtures = () => {
    if (selectedGroup === 'all') return fixtures.map(f => f.id)
    return fixtures.filter(f => f.group === selectedGroup).map(f => f.id)
  }

  const startEffect = () => {
    const ids = getTargetFixtures()
    effectEngine.current?.start(selectedEffect, ids, params)
    setActiveEffect(selectedEffect, params, ids)
  }

  const stopEffect = () => {
    effectEngine.current?.stop()
    clearEffect()
  }

  const setParam = (key, value) => {
    const next = { ...params, [key]: value }
    setParams(next)
    if (running) {
      const ids = getTargetFixtures()
      effectEngine.current?.start(selectedEffect, ids, next)
    }
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Effect library */}
      <div className="w-48 flex flex-col gap-2 flex-shrink-0">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Effects</div>
        {EFFECT_LIST.map(e => (
          <button
            key={e.key}
            onClick={() => { setSelectedEffect(e.key); stopEffect() }}
            className={`px-3 py-2.5 rounded-xl text-sm text-left transition-colors
              ${selectedEffect === e.key
                ? 'bg-accent-blue text-white'
                : 'bg-surface-700 text-gray-400 hover:bg-surface-600'}`}
          >
            {e.name}
            {activeEffect === e.key && <span className="ml-2 text-xs opacity-70">▶</span>}
          </button>
        ))}
      </div>

      {/* Parameters */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="bg-surface-800 rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{EFFECTS[selectedEffect]?.name}</h2>
            <div className="flex gap-2">
              {/* Target group */}
              <select
                value={selectedGroup}
                onChange={e => setSelectedGroup(e.target.value)}
                className="bg-surface-700 rounded-lg px-3 py-1.5 text-sm outline-none"
              >
                {allGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>

              {running ? (
                <button onClick={stopEffect}
                  className="px-5 py-1.5 rounded-lg bg-accent-red text-white text-sm font-bold">
                  STOP
                </button>
              ) : (
                <button onClick={startEffect}
                  className="px-5 py-1.5 rounded-lg bg-accent-green text-white text-sm font-bold">
                  START
                </button>
              )}
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

          {/* Phase offset */}
          {'phaseOffset' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Phase Offset: {params.phaseOffset}°
              </label>
              <input type="range" min="1" max="120" step="1"
                value={params.phaseOffset}
                onChange={e => setParam('phaseOffset', +e.target.value)}
                className="w-full" />
            </div>
          )}

          {/* Color (r/g/b params) */}
          {'r' in params && (
            <div>
              <label className="text-xs text-gray-500 block mb-2">Color</label>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-10 rounded-lg border border-surface-600 cursor-pointer hover:border-accent-blue"
                  style={{ background: `rgb(${params.r},${params.g},${params.b})` }}
                  onClick={() => setColorPickerField('color')}
                />
                {[['R', 'r', '#ef4444'], ['G', 'g', '#10b981'], ['B', 'b', '#3b82f6']].map(([label, key, color]) => (
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

        {/* Target preview */}
        <div className="bg-surface-800 rounded-2xl p-4">
          <div className="text-xs text-gray-500 mb-2">
            Target: {getTargetFixtures().length} fixture(s)
          </div>
          <div className="flex flex-wrap gap-1">
            {getTargetFixtures().map(id => {
              const f = fixtures.find(x => x.id === id)
              return (
                <span key={id} className="px-2 py-0.5 rounded bg-surface-700 text-xs text-gray-400">
                  {f?.name || `Fixture ${id}`}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {colorPickerField && (
        <ColorPicker
          r={params.r || 0} g={params.g || 0} b={params.b || 0}
          onChange={(r, g, b) => {
            const next = { ...params, r, g, b }
            setParams(next)
            if (running) {
              const ids = getTargetFixtures()
              effectEngine.current?.start(selectedEffect, ids, next)
            }
          }}
          onClose={() => setColorPickerField(null)}
        />
      )}
    </div>
  )
}
