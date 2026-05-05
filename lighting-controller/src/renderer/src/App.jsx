import React, { useEffect, useRef } from 'react'
import useStore from './store'
import { FadeEngine }   from './engines/fade-engine'
import { EffectEngine } from './engines/effect-engine'
import Sidebar          from './components/Sidebar'
import StatusBar        from './components/StatusBar'
import BlackoutButton   from './components/BlackoutButton'
import StageVisualizer  from './components/StageVisualizer'
import LiveControlScreen   from './screens/LiveControlScreen'
import SceneBrowserScreen  from './screens/SceneBrowserScreen'
import CueListScreen       from './screens/CueListScreen'
import EffectEngineScreen  from './screens/EffectEngineScreen'
import SettingsScreen      from './screens/SettingsScreen'

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
  const setFixtureColor    = useStore(s => s.setFixtureColor)
  const toggleBlackout     = useStore(s => s.toggleBlackout)
  const goNextCue          = useStore(s => s.goNextCue)
  const goPrevCue          = useStore(s => s.goPrevCue)

  const effectEngineRef = useRef(null)

  // Bootstrap
  useEffect(() => {
    const fadeEng = new FadeEngine(setFixtureColor)
    setFadeEngine(fadeEng)

    const effectEng = new EffectEngine(setFixtureColor)
    effectEngineRef.current = effectEng
    setEffectEngine(effectEng)

    // Load initial data
    window.api.loadFixtures().then(loadFixtures)
    window.api.loadScenes().then(loadScenes)
    window.api.loadCueList().then(loadCueList)

    // Serial events
    window.api.onConnected(setConnected)
    window.api.onDisconnected(setDisconnected)
    window.api.onHeartbeat(setHeartbeat)
    window.api.onHeartbeatTimeout(setHeartbeatTimeout)

    return () => {
      fadeEng.destroy()
      effectEng.destroy()
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); toggleBlackout() }
      if (e.code === 'Enter') { e.preventDefault(); goNextCue() }
      if (e.code === 'Backspace') { e.preventDefault(); goPrevCue() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const screens = {
    live:     <LiveControlScreen />,
    scenes:   <SceneBrowserScreen />,
    cues:     <CueListScreen />,
    effects:  <EffectEngineScreen effectEngine={effectEngineRef} />,
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
          {activeScreen !== 'settings' && (
            <div className="w-56 flex-shrink-0 flex flex-col gap-3 p-3 border-l border-surface-700 overflow-y-auto">
              <StageVisualizer compact />
            </div>
          )}
          <BlackoutButton />
        </div>
      </div>
    </div>
  )
}
