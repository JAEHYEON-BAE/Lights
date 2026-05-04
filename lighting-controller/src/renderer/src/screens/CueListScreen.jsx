import React, { useState } from 'react'
import useStore from '../store'

export default function CueListScreen() {
  const cueList        = useStore(s => s.cueList)
  const setCueList     = useStore(s => s.setCueList)
  const currentCueIndex = useStore(s => s.currentCueIndex)
  const goNextCue      = useStore(s => s.goNextCue)
  const goPrevCue      = useStore(s => s.goPrevCue)
  const scenes         = useStore(s => s.scenes)
  const recallScene    = useStore(s => s.recallScene)

  const [showName, setShowName] = useState(cueList.show_name)
  const [editingCue, setEditingCue] = useState(null)

  const cues = cueList.cues

  const update = (newCues) => {
    setCueList({ ...cueList, cues: newCues })
  }

  const addCue = () => {
    const newCue = {
      cue_number: cues.length + 1,
      name: `Cue ${cues.length + 1}`,
      scene_id: '',
      trigger: 'manual',
      fade_in_ms: 0
    }
    update([...cues, newCue])
    setEditingCue(cues.length)
  }

  const removeCue = (idx) => {
    update(cues.filter((_, i) => i !== idx))
  }

  const updateCue = (idx, field, value) => {
    const next = cues.map((c, i) => i === idx ? { ...c, [field]: value } : c)
    update(next)
  }

  const saveShowName = () => {
    setCueList({ ...cueList, show_name: showName })
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Show name + transport */}
      <div className="flex items-center gap-3 bg-surface-800 rounded-xl p-3">
        <input
          type="text"
          value={showName}
          onChange={e => setShowName(e.target.value)}
          onBlur={saveShowName}
          onKeyDown={e => e.key === 'Enter' && saveShowName()}
          className="flex-1 bg-surface-700 rounded px-3 py-1.5 text-sm font-semibold outline-none border border-surface-600 focus:border-accent-blue"
          placeholder="Show name…"
        />
        <span className="text-gray-500 text-sm">
          Cue {currentCueIndex + 1} / {cues.length}
        </span>
        <button onClick={goPrevCue}
          className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm">
          ◀ BACK
        </button>
        <button onClick={goNextCue}
          className="px-6 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-600 text-white text-sm font-bold">
          GO ▶
        </button>
      </div>

      {/* Cue table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 text-xs border-b border-surface-700">
              <th className="py-2 pr-3 w-10">#</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Scene</th>
              <th className="py-2 pr-3 w-24">Fade (ms)</th>
              <th className="py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {cues.map((cue, idx) => (
              <tr
                key={idx}
                onClick={() => { recallScene(cue.scene_id, cue.fade_in_ms); useStore.setState({ currentCueIndex: idx }) }}
                className={`border-b border-surface-700/50 cursor-pointer transition-colors
                  ${currentCueIndex === idx
                    ? 'bg-accent-blue/20 text-white'
                    : 'hover:bg-surface-700/50'}`}
              >
                <td className="py-2 pr-3 text-gray-500">{cue.cue_number}</td>
                <td className="py-2 pr-3">
                  {editingCue === idx ? (
                    <input
                      autoFocus
                      type="text"
                      value={cue.name}
                      onClick={e => e.stopPropagation()}
                      onChange={e => updateCue(idx, 'name', e.target.value)}
                      onBlur={() => setEditingCue(null)}
                      className="bg-surface-600 rounded px-2 py-0.5 outline-none w-full"
                    />
                  ) : (
                    <span onDoubleClick={e => { e.stopPropagation(); setEditingCue(idx) }}>
                      {cue.name}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={cue.scene_id}
                    onClick={e => e.stopPropagation()}
                    onChange={e => updateCue(idx, 'scene_id', e.target.value)}
                    className="bg-surface-600 rounded px-2 py-0.5 text-sm outline-none w-full"
                  >
                    <option value="">-- none --</option>
                    {scenes.map(s => (
                      <option key={s.scene_id} value={s.scene_id}>{s.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number" min="0" step="100"
                    value={cue.fade_in_ms}
                    onClick={e => e.stopPropagation()}
                    onChange={e => updateCue(idx, 'fade_in_ms', +e.target.value)}
                    className="bg-surface-600 rounded px-2 py-0.5 w-20 outline-none"
                  />
                </td>
                <td className="py-2">
                  <button
                    onClick={e => { e.stopPropagation(); removeCue(idx) }}
                    className="text-gray-600 hover:text-accent-red px-2"
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {cues.length === 0 && (
          <div className="text-center text-gray-600 py-12">
            No cues. Add cues and assign scenes to build your show.
          </div>
        )}
      </div>

      <div className="flex justify-between items-center">
        <button onClick={addCue}
          className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm">
          + Add Cue
        </button>
        <span className="text-xs text-gray-600">
          Double-click a name to edit · ENTER = GO · BACKSPACE = BACK
        </span>
      </div>
    </div>
  )
}
