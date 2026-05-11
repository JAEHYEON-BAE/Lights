import React, { useEffect, useRef } from 'react'
import useStore from './store'
import { FadeEngine }   from './engines/fade-engine'
import { EffectEngine } from './engines/effect-engine'
import { BpmEngine }       from './engines/bpm-engine'
import { MetronomeEngine } from './engines/metronome-engine'
import Sidebar          from './components/Sidebar'
import StatusBar        from './components/StatusBar'
import BlackoutButton   from './components/BlackoutButton'
import Toast           from './components/Toast'
import StageVisualizer  from './components/StageVisualizer'
import SceneBrowserScreen  from './screens/SceneBrowserScreen'
import CueListScreen       from './screens/CueListScreen'
import LiveScreen          from './screens/LiveScreen'
import SettingsScreen      from './screens/SettingsScreen'
import FixtureEditorScreen from './screens/FixtureEditorScreen'
import ShowScreen          from './screens/ShowScreen'

export default function App() {
  const activeScreen       = useStore(s => s.activeScreen)
  const setConnected       = useStore(s => s.setConnected)
  const setDisconnected    = useStore(s => s.setDisconnected)
  const setHeartbeat       = useStore(s => s.setHeartbeat)
  const setHeartbeatTimeout = useStore(s => s.setHeartbeatTimeout)
  const loadFixtures       = useStore(s => s.loadFixtures)
  const loadScenes         = useStore(s => s.loadScenes)
  const loadCueList        = useStore(s => s.loadCueList)
  const setFadeEngine      = useStore(s => s.setFadeEngine)
  const setEffectEngine    = useStore(s => s.setEffectEngine)
  const setBpmEngine       = useStore(s => s.setBpmEngine)
  const loadShows          = useStore(s => s.loadShows)
  const updateRunnerState  = useStore(s => s.updateRunnerState)
  const recallScene        = useStore(s => s.recallScene)
  const clearAllEffects    = useStore(s => s.clearAllEffects)
  const toggleBlackout     = useStore(s => s.toggleBlackout)
  const goNextCue          = useStore(s => s.goNextCue)
  const goPrevCue          = useStore(s => s.goPrevCue)

  const effectEngineRef   = useRef(null)
  const bpmEngineRef      = useRef(null)
  const metronomeRef      = useRef(null)
  const prevRunnerStatus  = useRef('stopped')

  // Bootstrap
  useEffect(() => {
    const { setFixture } = useStore.getState()

    const fadeEng = new FadeEngine(setFixture)
    setFadeEngine(fadeEng)

    const effectEng = new EffectEngine(setFixture)
    effectEngineRef.current = effectEng
    setEffectEngine(effectEng)

    const metro = new MetronomeEngine()
    metronomeRef.current = metro

    const bpmEng = new BpmEngine({
      onRecallScene: (sceneId, fadeMs) => recallScene(sceneId, fadeMs),
      onBreakpoint: (item) => {
        if (!item.scene_id) {
          // No scene assigned — stop all effects, then apply static white at 50% dimmer
          const state = useStore.getState()
          state.effectEngine?.clearAll()
          state.clearAllEffects()
          state.fixtures.forEach(f => state.setFixture(f.id, 127, 255, 255, 255))
        }
      },
      onShowEnd: () => {
        const state = useStore.getState()
        state.effectEngine?.clearAll()
        state.clearAllEffects()
        state.fixtures.forEach(f => state.setFixture(f.id, 0, 0, 0, 0))
      },
      onStateUpdate: (patch) => {
        updateRunnerState(patch)
        const { metronomeEnabled, metronomeVolume } = useStore.getState()
        const status = patch.status ?? 'stopped'
        const bpm    = patch.currentBpm ?? 0
        const bpb    = patch.beatsPerBar ?? 4
        if (metronomeEnabled && status === 'running' && bpm > 0) {
          if (prevRunnerStatus.current !== 'running') {
            metro.start(bpm, bpb, metronomeVolume)
          } else {
            metro.updateBpm(bpm, bpb)
          }
        } else if (prevRunnerStatus.current === 'running' && status !== 'running') {
          metro.stop()
        }
        prevRunnerStatus.current = status
      },
    })
    bpmEngineRef.current = bpmEng
    setBpmEngine(bpmEng)

    // Load initial data
    window.api.loadFixtures().then(loadFixtures)
    window.api.loadScenes().then(loadScenes)
    window.api.loadCueList().then(loadCueList)
    window.api.loadShows().then(loadShows)

    // Serial events
    window.api.onConnected(setConnected)
    window.api.onDisconnected(setDisconnected)
    window.api.onHeartbeat(setHeartbeat)
    window.api.onHeartbeatTimeout(setHeartbeatTimeout)

    return () => {
      fadeEng.destroy()
      effectEng.destroy()
      bpmEng.destroy()
      metro.destroy()
    }
  }, [])

  // Global keyboard shortcuts — capture phase, stopPropagation prevents double-fire
  // when a BUTTON/BlackoutButton has focus (Space would both toggle blackout AND click the button)
  useEffect(() => {
    const handler = (e) => {
      if (e.repeat) return
      const tag = e.target.tagName
      const isText = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.code === 'Space' && !isText) {
        e.preventDefault()
        e.stopPropagation()           // stops event reaching focused button → no double-toggle
        e.stopImmediatePropagation()  // stops other window-level capture listeners
        useStore.getState().toggleBlackout()
        return
      }
      if (isText || tag === 'SELECT' || tag === 'BUTTON') return
      // Cue navigation only fires on screens where it makes sense
      const screen = useStore.getState().activeScreen
      if (screen !== 'live' && screen !== 'cues') return
      if (e.code === 'Enter')     { e.preventDefault(); goNextCue() }
      if (e.code === 'Backspace') { e.preventDefault(); goPrevCue() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [goNextCue, goPrevCue])

  const screens = {
    live:     <LiveScreen effectEngine={effectEngineRef} />,
    scenes:   <SceneBrowserScreen />,
    cues:     <CueListScreen />,
    show:     <ShowScreen bpmEngine={bpmEngineRef} />,
    fixtures: <FixtureEditorScreen />,
    settings: <SettingsScreen />,
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-900 text-white">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar />
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-auto p-4">
            {screens[activeScreen]}
          </div>
          {activeScreen !== 'settings' && activeScreen !== 'fixtures' && (
            <div className="w-56 flex-shrink-0 flex flex-col gap-3 p-3 border-l border-surface-700 overflow-y-auto">
              <StageVisualizer compact />
            </div>
          )}
          <BlackoutButton />
        </div>
      </div>
      <Toast />
    </div>
  )
}
