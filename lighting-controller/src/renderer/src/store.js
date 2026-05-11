import { create } from 'zustand'

function migrateScene(raw) {
  if (!raw) return null
  if (raw.version === '2.0') return raw
  const effectIds = new Set(raw.effectFixtureIds || [])
  return {
    ...raw,
    version: '2.0',
    fixtures: raw.fixtures.map(f => ({
      id: f.id,
      dim: 254,
      r: f.r, g: f.g, b: f.b,
      effect:       effectIds.has(f.id) ? (raw.effect || null) : null,
      effectParams: effectIds.has(f.id) ? (raw.effectParams || {}) : {},
    })),
    effect: undefined,
    effectParams: undefined,
    effectFixtureIds: undefined,
  }
}

const MAX_FIXTURES = 32

const useStore = create((set, get) => ({
  // ── Connection ─────────────────────────────────────────────────────────────
  connected: false,
  connectedPort: null,
  simulateMode: false,
  heartbeat: null,
  heartbeatTimeout: false,

  setConnected:        (port)    => set({ connected: true,  connectedPort: port, heartbeatTimeout: false, simulateMode: port === 'SIMULATE' }),
  setDisconnected:     ()        => set({ connected: false, connectedPort: null, simulateMode: false }),
  setHeartbeat:        (data)    => set({ heartbeat: data, heartbeatTimeout: false }),
  setHeartbeatTimeout: ()        => set({ heartbeatTimeout: true }),

  // ── Fixtures ───────────────────────────────────────────────────────────────
  fixtures: [],
  fixtureState: {},  // { [id]: { d, r, g, b } }  — intended values (editor state)
  outputState:  {},  // { [id]: { d, r, g, b } }  — what was actually sent to hardware

  // Internal: send to hardware and record in outputState
  _sendFixture: (id, d, r, g, b) => {
    window.api.setFixture(id, d, r, g, b)
    set(s => ({ outputState: { ...s.outputState, [id]: { d, r, g, b } } }))
  },

  loadFixtures: (data) => {
    if (!data) return
    const state   = {}
    const enabled = {}
    const output  = {}
    data.fixtures.forEach(f => {
      state[f.id]   = { d: 254, r: 0, g: 0, b: 0 }
      enabled[f.id] = true
      output[f.id]  = { d: 0, r: 0, g: 0, b: 0 }
    })
    set({ fixtures: data.fixtures, groups: data.groups || [], fixtureState: state, fixtureEnabled: enabled, outputState: output })
  },

  saveFixtures: async (data) => {
    await window.api.saveFixtures(data)
    set(s => {
      const next    = {}
      const enabled = {}
      const output  = {}
      data.fixtures.forEach(f => {
        next[f.id]    = s.fixtureState[f.id]  ?? { d: 254, r: 0, g: 0, b: 0 }
        enabled[f.id] = s.fixtureEnabled[f.id] ?? true
        output[f.id]  = s.outputState[f.id]   ?? { d: 0, r: 0, g: 0, b: 0 }
      })
      return { fixtures: data.fixtures, groups: data.groups ?? [], fixtureState: next, fixtureEnabled: enabled, outputState: output }
    })
  },

  setFixtureColor: (id, r, g, b) => {
    const d = Math.round(get().masterDimmer * 254)
    set(s => ({ fixtureState: { ...s.fixtureState, [id]: { d, r, g, b } } }))
    if (get().fixtureEnabled[id] ?? true) {
      get()._sendFixture(id, d, r, g, b)
    }
  },

  setFixtureDimmer: (id, d) => {
    const clamped = Math.max(0, Math.min(254, Math.round(d)))
    set(s => ({ fixtureState: { ...s.fixtureState, [id]: { ...s.fixtureState[id], d: clamped } } }))
    if (!(get().fixtureEnabled[id] ?? true)) return
    const c = get().fixtureState[id] || { r: 0, g: 0, b: 0 }
    get()._sendFixture(id, clamped, c.r, c.g, c.b)
  },

  setGroupColor: (groupId, r, g, b) => {
    const { fixtures } = get()
    const targets = groupId === 'all' ? fixtures : fixtures.filter(f => f.group === groupId)
    targets.forEach(f => get().setFixtureColor(f.id, r, g, b))
  },

  // ── Fixture enabled state ──────────────────────────────────────────────────
  fixtureEnabled: {}, // { [id]: boolean }

  toggleFixtureEnabled: (id) => {
    const next = !(get().fixtureEnabled[id] ?? true)
    set(s => ({ fixtureEnabled: { ...s.fixtureEnabled, [id]: next } }))
    if (!next) {
      get()._sendFixture(id, 0, 0, 0, 0)
    } else {
      const { masterDimmer, fixtureState } = get()
      const d = Math.round(masterDimmer * 254)
      const c = fixtureState[id] || { r: 0, g: 0, b: 0 }
      get()._sendFixture(id, d, c.r, c.g, c.b)
    }
  },

  // ── Groups ─────────────────────────────────────────────────────────────────
  groups: [],

  // ── Blackout ───────────────────────────────────────────────────────────────
  blackoutActive: false,

  toggleBlackout: () => {
    const next = !get().blackoutActive
    set({ blackoutActive: next })
    window.api.setBlackout(next)
    const { fixtures, fixtureState, fixtureEnabled, masterDimmer } = get()
    if (next) {
      // Reflect blackout in outputState
      set(s => {
        const output = { ...s.outputState }
        fixtures.forEach(f => { output[f.id] = { d: 0, r: 0, g: 0, b: 0 } })
        return { outputState: output }
      })
    } else {
      // Re-broadcast current state so hardware and outputState are in sync
      const d = Math.round(masterDimmer * 254)
      fixtures.forEach(f => {
        if (!(fixtureEnabled[f.id] ?? true)) return
        const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
        get()._sendFixture(f.id, d, c.r, c.g, c.b)
      })
    }
  },

  // ── Master Dimmer ──────────────────────────────────────────────────────────
  masterDimmer: 1.0,

  setMasterDimmer: (value) => {
    const d = Math.round(value * 254)
    set({ masterDimmer: value })
    const { fixtures, fixtureState, fixtureEnabled } = get()
    fixtures.forEach(f => {
      if (!(fixtureEnabled[f.id] ?? true)) return
      const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
      get()._sendFixture(f.id, d, c.r, c.g, c.b)
    })
  },

  // ── Scenes ─────────────────────────────────────────────────────────────────
  scenes: [],
  activeSceneId: null,

  loadScenes: (scenes) => set({ scenes }),

  saveScene: async (scene) => {
    await window.api.saveScene(scene)
    set(s => {
      const others = s.scenes.filter(x => x.scene_id !== scene.scene_id)
      return { scenes: [...others, scene].sort((a, b) => a.name.localeCompare(b.name)) }
    })
  },

  deleteScene: async (sceneId) => {
    await window.api.deleteScene(sceneId)
    set(s => ({ scenes: s.scenes.filter(x => x.scene_id !== sceneId) }))
  },

  recallScene: (sceneId, fadeMs = 0) => {
    const raw = get().scenes.find(s => s.scene_id === sceneId)
    const scene = migrateScene(raw)
    if (!scene) return

    get().effectEngine?.clearAll()
    set({ fixtureEffects: {} })

    const duration = fadeMs ?? scene.fade_in_ms ?? 0

    if (duration > 0) {
      get().fadeEngine?.fadeScene(scene, get().masterDimmer, duration)
    } else {
      scene.fixtures.forEach(({ id, dim, r, g, b }) => {
        get().setFixtureColor(id, r, g, b)
        get().setFixtureDimmer(id, dim ?? 254)
      })
    }

    const startEffects = () => {
      const groups = new Map()
      scene.fixtures.forEach(({ id, effect, effectParams }) => {
        if (!effect) return
        const key = effect + '\0' + JSON.stringify(effectParams ?? {})
        if (!groups.has(key)) groups.set(key, { effect, effectParams: effectParams ?? {}, ids: [] })
        groups.get(key).ids.push(id)
      })
      groups.forEach(({ effect, effectParams, ids }) => {
        get().effectEngine?.setFixtureEffect(ids, effect, effectParams)
        ids.forEach(id => get().setFixtureEffect([id], effect, effectParams))
      })
    }

    if (duration > 0) {
      setTimeout(startEffects, duration)
    } else {
      startEffects()
    }

    set({ activeSceneId: sceneId })
  },

  // ── Cue List ───────────────────────────────────────────────────────────────
  cueList: { version: '1.0', show_name: 'Untitled Show', cues: [] },
  currentCueIndex: -1,

  loadCueList: (cl) => set({ cueList: cl }),

  saveCueList: async () => {
    await window.api.saveCueList(get().cueList)
  },

  setCueList: (cl) => {
    set({ cueList: cl })
    window.api.saveCueList(cl)
  },

  goNextCue: () => {
    const { cueList, currentCueIndex } = get()
    const cues = cueList.cues
    const next = Math.min(currentCueIndex + 1, cues.length - 1)
    if (next < 0 || !cues[next]) return
    get().recallScene(cues[next].scene_id, cues[next].fade_in_ms)
    set({ currentCueIndex: next })
  },

  goPrevCue: () => {
    const { cueList, currentCueIndex } = get()
    const cues = cueList.cues
    const prev = Math.max(currentCueIndex - 1, 0)
    if (!cues[prev]) return
    get().recallScene(cues[prev].scene_id, cues[prev].fade_in_ms)
    set({ currentCueIndex: prev })
  },

  // ── Effect Engine ref ──────────────────────────────────────────────────────
  fadeEngine: null,
  setFadeEngine: (engine) => set({ fadeEngine: engine }),

  effectEngine: null,
  setEffectEngine: (engine) => set({ effectEngine: engine }),

  // ── Per-fixture Effects ────────────────────────────────────────────────────
  fixtureEffects: {}, // { [fixtureId]: { effectKey, params } }

  setFixtureEffect: (fixtureIds, effectKey, params) => {
    set(s => {
      const next = { ...s.fixtureEffects }
      fixtureIds.forEach(id => { next[id] = { effectKey, params } })
      return { fixtureEffects: next }
    })
  },

  updateFixtureEffectParams: (fixtureIds, params) => {
    set(s => {
      const next = { ...s.fixtureEffects }
      fixtureIds.forEach(id => {
        if (next[id]) next[id] = { ...next[id], params }
      })
      return { fixtureEffects: next }
    })
  },

  clearFixtureEffect: (fixtureIds) => {
    set(s => {
      const next = { ...s.fixtureEffects }
      fixtureIds.forEach(id => { delete next[id] })
      return { fixtureEffects: next }
    })
  },

  clearAllEffects: () => set({ fixtureEffects: {} }),

  // ── Shows (BPM Sync) ───────────────────────────────────────────────────────
  shows: [],
  activeShowId: null,
  activeShow: null,

  runnerState: {
    status: 'stopped',           // 'stopped' | 'running' | 'breakpoint' | 'ended'
    currentSetlistIndex: -1,
    currentSongId: null,
    currentSegmentIndex: -1,
    currentBpm: 0,
    elapsedBarsInSegment: 0,
    totalBarsInSegment: 0,
  },

  loadShows: (shows) => set({ shows }),

  saveShow: async (show) => {
    await window.api.saveShow(show)
    set(s => {
      const others = s.shows.filter(x => x.show_id !== show.show_id)
      return { shows: [...others, show], activeShow: show, activeShowId: show.show_id }
    })
  },

  deleteShow: async (showId) => {
    await window.api.deleteShow(showId)
    set(s => ({
      shows: s.shows.filter(x => x.show_id !== showId),
      activeShow: s.activeShowId === showId ? null : s.activeShow,
      activeShowId: s.activeShowId === showId ? null : s.activeShowId,
    }))
  },

  setActiveShow: (show) => set({ activeShow: show, activeShowId: show?.show_id ?? null }),

  updateRunnerState: (patch) => set(s => ({ runnerState: { ...s.runnerState, ...patch } })),

  bpmEngine: null,
  setBpmEngine: (engine) => set({ bpmEngine: engine }),

  // ── UI ─────────────────────────────────────────────────────────────────────
  activeScreen: 'live',
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}))

export default useStore
