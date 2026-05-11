import React, { useState, useEffect } from 'react'
import useStore from '../store'

// ── Helpers ───────────────────────────────────────────────────────────────────
function newShowId() { return `show_${Date.now()}` }
function newSongId()  { return `song_${Date.now()}` }
function newSegId()   { return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
function newBpId()    { return `bp_${Date.now()}` }

function emptyShow() {
  return { version: '1.0', show_id: newShowId(), show_name: '새 공연', songs: {}, setlist: [] }
}
function emptySegment() {
  return { segment_id: newSegId(), name: '', scene_id: null, bars: 8, fade_in_ms: 250 }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ShowScreen({ bpmEngine }) {
  const shows             = useStore(s => s.shows)
  const scenes            = useStore(s => s.scenes)
  const saveShow          = useStore(s => s.saveShow)
  const deleteShow        = useStore(s => s.deleteShow)
  const activeShow        = useStore(s => s.activeShow)
  const setActiveShow     = useStore(s => s.setActiveShow)
  const runnerState       = useStore(s => s.runnerState)
  const updateRunnerState = useStore(s => s.updateRunnerState)
  const bpmEngineStore    = useStore(s => s.bpmEngine)
  const showToast         = useStore(s => s.showToast)
  const setDirtyScreen    = useStore(s => s.setDirtyScreen)
  const clearDirtyScreen  = useStore(s => s.clearDirtyScreen)

  const engine  = bpmEngine?.current ?? bpmEngineStore
  const status  = runnerState.status
  const isIdle  = status === 'stopped' || status === 'ended'

  // Local working copy for editing (separate from store so unsaved edits don't affect runner)
  const [show,           setShow]           = useState(() => activeShow ? structuredClone(activeShow) : null)
  const [selectedSongId, setSelectedSongId] = useState(null)
  const [isDirty,        setIsDirty]        = useState(false)

  // When a show is selected from dropdown or saved externally, sync local copy (only when idle)
  useEffect(() => {
    if (!isIdle || !show || !activeShow) return
    if (show.show_id !== activeShow.show_id) {
      setShow(structuredClone(activeShow))
      setSelectedSongId(null)
      setIsDirty(false)
      clearDirtyScreen()
    }
  }, [activeShow])

  // ── Edit helpers ──────────────────────────────────────────────────────────────
  function updateShow(fn) {
    setShow(prev => { const next = structuredClone(prev); fn(next); return next })
    if (!isDirty) {
      setIsDirty(true)
      setDirtyScreen('show')
    }
  }

  // ── Show-level ────────────────────────────────────────────────────────────────
  function handleSelectShow(showId) {
    const found = shows.find(s => s.show_id === showId)
    if (!found) return
    const clone = structuredClone(found)
    setShow(clone)
    setSelectedSongId(null)
    setIsDirty(false)
    clearDirtyScreen()
    setActiveShow(found)
    engine?.load(found)
    updateRunnerState({ status: 'stopped', currentSetlistIndex: -1, currentSongId: null, currentSegmentIndex: -1, elapsedBarsInSegment: 0 })
  }

  function handleNewShow() {
    const s = emptyShow()
    setShow(s)
    setSelectedSongId(null)
    setIsDirty(true)
    setDirtyScreen('show')
  }

  async function handleSave() {
    if (!show) return
    await saveShow(show)
    setIsDirty(false)
    clearDirtyScreen()
    showToast('저장되었습니다')
  }

  async function handleDelete() {
    if (!show) return
    if (!window.confirm(`"${show.show_name}" 을 삭제할까요?`)) return
    await deleteShow(show.show_id)
    setShow(null)
    setSelectedSongId(null)
    setIsDirty(false)
    clearDirtyScreen()
  }

  // ── Song ──────────────────────────────────────────────────────────────────────
  function handleAddSong() {
    const songId = newSongId()
    updateShow(draft => {
      draft.songs[songId] = { song_id: songId, name: '새 곡', bpm: 120, beats_per_bar: 4, segments: [emptySegment()] }
      draft.setlist.push({ type: 'song', song_id: songId })
    })
    setSelectedSongId(songId)
  }

  function handleRemoveSong(songId) {
    updateShow(draft => {
      delete draft.songs[songId]
      draft.setlist = draft.setlist.filter(i => !(i.type === 'song' && i.song_id === songId))
    })
    if (selectedSongId === songId) setSelectedSongId(null)
  }

  function handleSongField(songId, field, value) {
    updateShow(draft => { draft.songs[songId][field] = value })
  }

  // ── Breakpoint ────────────────────────────────────────────────────────────────
  function handleAddBreakpoint(afterIndex) {
    updateShow(draft => {
      draft.setlist.splice(afterIndex + 1, 0, {
        type: 'breakpoint', breakpoint_id: newBpId(), name: '멘트', scene_id: null, fade_in_ms: 0,
      })
    })
  }

  function handleRemoveBreakpoint(bpId) {
    updateShow(draft => {
      draft.setlist = draft.setlist.filter(i => !(i.type === 'breakpoint' && i.breakpoint_id === bpId))
    })
  }

  function handleBpField(bpId, field, value) {
    updateShow(draft => {
      const item = draft.setlist.find(i => i.type === 'breakpoint' && i.breakpoint_id === bpId)
      if (item) item[field] = value
    })
  }

  // ── Setlist reorder ───────────────────────────────────────────────────────────
  function handleMoveSetlistItem(index, dir) {
    updateShow(draft => {
      const target = index + dir
      if (target < 0 || target >= draft.setlist.length) return
      ;[draft.setlist[index], draft.setlist[target]] = [draft.setlist[target], draft.setlist[index]]
    })
  }

  // ── Segment ───────────────────────────────────────────────────────────────────
  function handleAddSegment(songId) {
    updateShow(draft => { draft.songs[songId].segments.push(emptySegment()) })
  }

  function handleRemoveSegment(songId, segId) {
    updateShow(draft => {
      draft.songs[songId].segments = draft.songs[songId].segments.filter(s => s.segment_id !== segId)
    })
  }

  function handleSegmentField(songId, segId, field, value) {
    updateShow(draft => {
      const seg = draft.songs[songId].segments.find(s => s.segment_id === segId)
      if (seg) seg[field] = value
    })
  }

  function handleMoveSegment(songId, index, dir) {
    updateShow(draft => {
      const segs = draft.songs[songId].segments
      const target = index + dir
      if (target < 0 || target >= segs.length) return
      ;[segs[index], segs[target]] = [segs[target], segs[index]]
    })
  }

  // ── Transport ─────────────────────────────────────────────────────────────────
  function handleStart() {
    if (!show || !engine) return
    engine.load(show)
    engine.start()
  }

  function handleStop() {
    engine?.stop()
    const state = useStore.getState()
    state.effectEngine?.clearAll()
    state.clearAllEffects()
    state.fixtures.forEach(f => {
      state.setFixtureColor(f.id, 0, 0, 0)
      state.setFixtureDimmer(f.id, 0)
    })
  }
  function handleGo()          { engine?.resume() }
  function handleSkipForward() { engine?.skipForward() }
  function handleSkipBack()    { engine?.skipBack() }

  function handleSetlistItemClick(idx) {
    if (isIdle) {
      // Select song for editing
      const item = show?.setlist[idx]
      if (item?.type === 'song') setSelectedSongId(item.song_id)
    } else {
      // Jump to that setlist position
      engine?.jumpToSetlistItem(idx)
    }
  }

  // ── Runner derived state ──────────────────────────────────────────────────────
  const { currentSetlistIndex, currentSongId, currentSegmentIndex, currentBpm,
          elapsedBarsInSegment, totalBarsInSegment } = runnerState

  // Runner uses activeShow (the last saved/loaded version) for display
  const runShow       = activeShow ?? show
  const currentSong   = runShow?.songs?.[currentSongId] ?? null
  const currentSeg    = currentSong?.segments?.[currentSegmentIndex] ?? null
  const currentScene  = currentSeg?.scene_id ? scenes.find(s => s.scene_id === currentSeg.scene_id) : null
  const nextSeg       = currentSong?.segments?.[currentSegmentIndex + 1] ?? null
  const nextScene     = nextSeg?.scene_id ? scenes.find(s => s.scene_id === nextSeg.scene_id) : null
  const barPct        = totalBarsInSegment > 0 ? Math.min(1, elapsedBarsInSegment / totalBarsInSegment) : 0
  const barsLeft      = Math.max(0, totalBarsInSegment - elapsedBarsInSegment)

  const statusLabel = { stopped: '정지', running: '진행 중', breakpoint: '대기 (멘트)', ended: '공연 종료' }[status] ?? status
  const statusColor = { stopped: 'text-gray-500', running: 'text-accent-green', breakpoint: 'text-yellow-400', ended: 'text-blue-400' }[status] ?? 'text-gray-400'

  const selectedSong = show && selectedSongId ? show.songs[selectedSongId] : null

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-3">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-sm text-white"
          value={show?.show_id ?? ''}
          onChange={e => {
            if (e.target.value === '__new__') handleNewShow()
            else handleSelectShow(e.target.value)
          }}
          disabled={!isIdle}
        >
          <option value="" disabled>— 공연 선택 —</option>
          {shows.map(s => <option key={s.show_id} value={s.show_id}>{s.show_name}</option>)}
          <option value="__new__">＋ 새 공연 만들기</option>
        </select>

        {show && isIdle && (
          <input
            className="flex-1 min-w-[140px] bg-surface-700 border border-surface-600 rounded px-2 py-1 text-sm text-white"
            value={show.show_name}
            onChange={e => updateShow(d => { d.show_name = e.target.value })}
            placeholder="공연명"
          />
        )}

        {show && !isIdle && (
          <span className="flex-1 text-sm text-white font-medium">{show.show_name}</span>
        )}

        <span className={`text-sm font-mono ${statusColor}`}>● {statusLabel}</span>
        {currentBpm > 0 && <span className="text-sm text-gray-400 font-mono">♩ {currentBpm} BPM</span>}

        {show && isIdle && (
          <>
            <button
              onClick={handleSave}
              className={`px-3 py-1 rounded text-sm text-white transition-colors ${
                isDirty
                  ? 'bg-accent-blue hover:bg-blue-600 ring-2 ring-accent-blue/50'
                  : 'bg-surface-600 hover:bg-surface-500'
              }`}
            >
              {isDirty ? '● 저장' : '저장'}
            </button>
            <button onClick={handleDelete} className="px-3 py-1 rounded text-sm bg-red-800 hover:bg-red-700 text-white">삭제</button>
          </>
        )}
      </div>

      {!show ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          공연을 선택하거나 새로 만드세요
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4">

          {/* ── Left: Setlist + Transport ── */}
          <div className="w-64 flex-shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 uppercase tracking-widest">Setlist</span>
              {isIdle && (
                <button onClick={handleAddSong} className="text-xs px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-gray-300">
                  + 곡 추가
                </button>
              )}
            </div>

            {/* Setlist items */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-1">
              {show.setlist.length === 0 && (
                <div className="text-gray-500 text-xs text-center py-8">곡을 추가하세요</div>
              )}

              {show.setlist.map((item, idx) => {
                const isCurrent = idx === currentSetlistIndex
                const isDone    = idx < currentSetlistIndex

                if (item.type === 'song') {
                  const song       = show.songs[item.song_id]
                  const isSelected = isIdle && selectedSongId === item.song_id

                  return (
                    <div key={item.song_id}>
                      <div
                        onClick={() => handleSetlistItemClick(idx)}
                        className={`flex items-center gap-1 p-2 rounded cursor-pointer text-sm transition-colors ${
                          isCurrent   ? 'bg-accent-blue text-white' :
                          isSelected  ? 'bg-accent-blue/60 text-white' :
                          isDone      ? 'bg-surface-800 text-gray-500 hover:bg-surface-700' :
                                        'bg-surface-700 text-gray-200 hover:bg-surface-600'
                        }`}
                      >
                        {!isIdle && (
                          <span className="text-xs w-4 text-center shrink-0">
                            {isDone ? '✓' : isCurrent ? '▶' : ''}
                          </span>
                        )}
                        <span className="flex-1 truncate">♩ {song?.name ?? '(삭제된 곡)'}</span>
                        <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{song?.bpm}</span>
                        {isIdle && (
                          <>
                            <div className="flex flex-col shrink-0">
                              <button onClick={e => { e.stopPropagation(); handleMoveSetlistItem(idx, -1) }} className="text-[10px] leading-none text-gray-400 hover:text-white">▲</button>
                              <button onClick={e => { e.stopPropagation(); handleMoveSetlistItem(idx,  1) }} className="text-[10px] leading-none text-gray-400 hover:text-white">▼</button>
                            </div>
                            <button onClick={e => { e.stopPropagation(); handleRemoveSong(item.song_id) }} className="text-gray-500 hover:text-red-400 text-xs shrink-0">✕</button>
                          </>
                        )}
                      </div>

                      {/* Insert breakpoint button — edit mode only */}
                      {isIdle && (
                        <div className="flex justify-center my-0.5">
                          <button onClick={() => handleAddBreakpoint(idx)} className="text-[10px] text-gray-600 hover:text-yellow-400 px-2" title="멘트 삽입">+ 멘트</button>
                        </div>
                      )}
                    </div>
                  )
                } else {
                  // breakpoint
                  return (
                    <div key={item.breakpoint_id}>
                      {isIdle ? (
                        /* Edit mode: editable breakpoint card */
                        <div className="rounded bg-yellow-900/30 border border-yellow-700/40 px-2 py-1.5 text-xs text-yellow-300 flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <span className="opacity-60">⏸</span>
                            <input
                              className="flex-1 bg-transparent outline-none text-yellow-200 placeholder-yellow-600 font-medium"
                              value={item.name}
                              onChange={e => handleBpField(item.breakpoint_id, 'name', e.target.value)}
                              placeholder="멘트명"
                            />
                            <div className="flex flex-col">
                              <button onClick={() => handleMoveSetlistItem(idx, -1)} className="text-[10px] leading-none text-yellow-600 hover:text-yellow-300">▲</button>
                              <button onClick={() => handleMoveSetlistItem(idx,  1)} className="text-[10px] leading-none text-yellow-600 hover:text-yellow-300">▼</button>
                            </div>
                            <button onClick={() => handleRemoveBreakpoint(item.breakpoint_id)} className="text-yellow-700 hover:text-red-400 ml-1">✕</button>
                          </div>
                          <div className="flex items-center gap-1 pl-3">
                            <select
                              className="flex-1 bg-surface-800 border border-yellow-700/40 rounded px-1 py-0.5 text-yellow-200 text-[11px]"
                              value={item.scene_id ?? ''}
                              onChange={e => handleBpField(item.breakpoint_id, 'scene_id', e.target.value || null)}
                            >
                              <option value="">— 조명 없음 —</option>
                              {scenes.map(sc => <option key={sc.scene_id} value={sc.scene_id}>{sc.name}</option>)}
                            </select>
                            <input
                              type="number" min="0" max="10000" step="50"
                              className="w-14 bg-surface-800 border border-yellow-700/40 rounded px-1 py-0.5 text-yellow-200 text-[11px] text-right"
                              value={item.fade_in_ms ?? 0}
                              onChange={e => handleBpField(item.breakpoint_id, 'fade_in_ms', Math.max(0, Number(e.target.value)))}
                              title="Fade ms"
                            />
                            <span className="text-yellow-600">ms</span>
                          </div>
                        </div>
                      ) : (
                        /* Runner mode: read-only breakpoint row */
                        <div className={`flex items-center gap-2 px-3 py-2 rounded text-xs border transition-colors ${
                          isCurrent ? 'bg-yellow-900/60 border-yellow-500 text-yellow-200' :
                          isDone    ? 'bg-surface-800 border-surface-700 text-gray-600' :
                                      'bg-yellow-900/20 border-yellow-700/40 text-yellow-400'
                        }`}>
                          <span>⏸</span>
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{item.name}</div>
                            {item.scene_id && (
                              <div className="text-[10px] opacity-60 truncate">
                                {scenes.find(s => s.scene_id === item.scene_id)?.name ?? ''}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {isIdle && (
                        <div className="flex justify-center my-0.5">
                          <button onClick={() => handleAddBreakpoint(idx)} className="text-[10px] text-gray-600 hover:text-yellow-400 px-2" title="멘트 삽입">+ 멘트</button>
                        </div>
                      )}
                    </div>
                  )
                }
              })}
            </div>

            {/* ── Transport controls ── */}
            <div className="flex flex-col gap-2 pt-2 border-t border-surface-700">
              {isIdle ? (
                <button
                  onClick={handleStart}
                  disabled={!show.setlist.length}
                  className="w-full py-2.5 rounded-lg bg-accent-green hover:bg-green-500 disabled:bg-surface-700 disabled:text-gray-500 text-white font-bold text-sm transition-colors"
                >▶ START</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={handleStop} className="flex-1 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-white text-sm transition-colors">■ STOP</button>
                  {status === 'running' && (
                    <>
                      <button onClick={handleSkipBack}    className="px-3 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-white text-sm transition-colors">◀</button>
                      <button onClick={handleSkipForward} className="px-3 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-white text-sm transition-colors">▶▶</button>
                    </>
                  )}
                  {status === 'breakpoint' && (
                    <button onClick={handleGo} className="flex-1 py-2 rounded-lg bg-accent-green hover:bg-green-500 text-white font-bold text-sm transition-colors">▶ GO</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Song Editor (idle) or Runner Panel (running) ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto">

            {/* RUNNING: progress panel */}
            {status === 'running' && currentSong && (
              <div className="bg-surface-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">현재 곡</span>
                  <span className="text-white font-medium">{currentSong.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">현재 Segment</span>
                  <span className="text-white">
                    {currentSeg?.name
                      ? <>{currentSeg.name} <span className="text-gray-400">— {currentScene?.name ?? '(Scene 없음)'}</span></>
                      : currentScene?.name ?? '(Scene 없음)'}
                  </span>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>마디 진행</span>
                    <span className="tabular-nums">{elapsedBarsInSegment} / {totalBarsInSegment}마디 (남은 마디: {barsLeft})</span>
                  </div>
                  <div className="h-3 bg-surface-700 rounded-full overflow-hidden">
                    <div className="h-full bg-accent-blue rounded-full transition-all duration-100" style={{ width: `${barPct * 100}%` }} />
                  </div>
                </div>
                {nextSeg && (
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>다음</span>
                    <span>
                      {nextSeg.name ? `${nextSeg.name} — ` : ''}{nextScene?.name ?? '(Scene 없음)'} ({barsLeft}마디 후)
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* BREAKPOINT banner */}
            {status === 'breakpoint' && (() => {
              const bp      = runShow?.setlist[currentSetlistIndex]
              const bpScene = bp?.scene_id ? scenes.find(s => s.scene_id === bp.scene_id) : null
              return (
                <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-xl p-6 flex flex-col items-center gap-3">
                  <div className="text-yellow-300 text-lg font-medium">⏸ {bp?.name ?? '멘트'}</div>
                  {bpScene
                    ? <div className="text-yellow-400 text-sm">조명: {bpScene.name}</div>
                    : <div className="text-yellow-600 text-sm">조명 설정 없음</div>}
                  <div className="text-yellow-500 text-sm">멘트/휴식 구간 — 준비되면 GO를 누르세요</div>
                  <button onClick={handleGo} className="px-8 py-3 rounded-xl bg-accent-green hover:bg-green-500 text-white text-lg font-bold transition-colors">▶ GO</button>
                </div>
              )
            })()}

            {/* ENDED banner */}
            {status === 'ended' && (
              <div className="bg-surface-800 rounded-xl p-6 flex flex-col items-center gap-2">
                <div className="text-blue-400 text-lg">공연이 종료되었습니다</div>
                <div className="text-gray-500 text-sm">처음부터 다시 시작하려면 START를 누르세요</div>
              </div>
            )}

            {/* IDLE: Song Editor */}
            {isIdle && (
              selectedSong ? (
                <>
                  {/* Song meta */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      className="flex-1 min-w-[140px] bg-surface-700 border border-surface-600 rounded px-2 py-1 text-sm text-white"
                      value={selectedSong.name}
                      onChange={e => handleSongField(selectedSongId, 'name', e.target.value)}
                      placeholder="곡명"
                    />
                    <label className="flex items-center gap-1 text-sm text-gray-300">
                      BPM
                      <input
                        type="number" min="40" max="300"
                        className="w-16 bg-surface-700 border border-surface-600 rounded px-2 py-1 text-sm text-white text-right"
                        value={selectedSong.bpm}
                        onChange={e => handleSongField(selectedSongId, 'bpm', Math.max(40, Math.min(300, Number(e.target.value))))}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-sm text-gray-300">
                      박자
                      <select
                        className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-sm text-white"
                        value={selectedSong.beats_per_bar}
                        onChange={e => handleSongField(selectedSongId, 'beats_per_bar', Number(e.target.value))}
                      >
                        {[2,3,4,6,8].map(n => <option key={n} value={n}>{n}/4</option>)}
                      </select>
                    </label>
                    <span className="text-xs text-gray-500">
                      1마디 = {((60000 / selectedSong.bpm) * selectedSong.beats_per_bar / 1000).toFixed(2)}s
                    </span>
                  </div>

                  {/* Segment table */}
                  <div className="text-xs text-gray-400 uppercase tracking-widest">Segments</div>
                  <div className="flex flex-col gap-1">
                    {selectedSong.segments.map((seg, segIdx) => (
                      <div key={seg.segment_id} className="flex items-center gap-2 bg-surface-700 rounded px-3 py-2 text-sm">
                        <span className="text-gray-500 w-5 text-right text-xs shrink-0">{segIdx + 1}</span>
                        <input
                          className="w-24 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
                          value={seg.name ?? ''}
                          onChange={e => handleSegmentField(selectedSongId, seg.segment_id, 'name', e.target.value)}
                          placeholder="Verse…"
                        />
                        <select
                          className="flex-1 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm text-white"
                          value={seg.scene_id ?? ''}
                          onChange={e => handleSegmentField(selectedSongId, seg.segment_id, 'scene_id', e.target.value || null)}
                        >
                          <option value="">— Scene 선택 —</option>
                          {scenes.map(sc => <option key={sc.scene_id} value={sc.scene_id}>{sc.name}</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-gray-400 text-xs whitespace-nowrap">
                          마디
                          <input
                            type="number" min="1" max="999"
                            className="w-14 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm text-white text-right"
                            value={seg.bars}
                            onChange={e => handleSegmentField(selectedSongId, seg.segment_id, 'bars', Math.max(1, Number(e.target.value)))}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-gray-400 text-xs whitespace-nowrap">
                          Fade
                          <input
                            type="number" min="0" max="10000" step="50"
                            className="w-16 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm text-white text-right"
                            value={seg.fade_in_ms}
                            onChange={e => handleSegmentField(selectedSongId, seg.segment_id, 'fade_in_ms', Math.max(0, Number(e.target.value)))}
                          />
                          <span>ms</span>
                        </label>
                        <span className="text-gray-500 text-xs w-14 text-right whitespace-nowrap">
                          {((seg.bars * (60000 / selectedSong.bpm) * selectedSong.beats_per_bar) / 1000).toFixed(1)}s
                        </span>
                        <div className="flex flex-col">
                          <button onClick={() => handleMoveSegment(selectedSongId, segIdx, -1)} className="text-[10px] leading-none text-gray-500 hover:text-white">▲</button>
                          <button onClick={() => handleMoveSegment(selectedSongId, segIdx,  1)} className="text-[10px] leading-none text-gray-500 hover:text-white">▼</button>
                        </div>
                        <button onClick={() => handleRemoveSegment(selectedSongId, seg.segment_id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => handleAddSegment(selectedSongId)}
                      className="text-sm text-gray-400 hover:text-white border border-dashed border-surface-600 hover:border-surface-400 rounded px-3 py-2 transition-colors"
                    >+ Segment 추가</button>
                  </div>

                  {selectedSong.segments.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      총 길이:{' '}
                      {(selectedSong.segments.reduce((s, seg) => s + seg.bars, 0) * (60000 / selectedSong.bpm) * selectedSong.beats_per_bar / 1000).toFixed(1)}s
                      ({selectedSong.segments.reduce((s, seg) => s + seg.bars, 0)}마디)
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 text-sm">
                  <div>Setlist에서 곡을 선택하세요</div>
                  {show.setlist.length > 0 && (
                    <div className="text-xs flex gap-4 text-gray-600">
                      <span>곡 {Object.keys(show.songs).length}개</span>
                      <span>멘트 {show.setlist.filter(i => i.type === 'breakpoint').length}개</span>
                      <span>총 {Object.values(show.songs).reduce((s, song) => s + song.segments.reduce((a, seg) => a + seg.bars, 0), 0)}마디</span>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
