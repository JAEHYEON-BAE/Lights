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
  fixtureState: {},  // { [id]: { d, r, g, b } }  — raw intended values (0–254)
  outputState:  {},  // { [id]: { d, r, g, b } }  — scaled values actually sent to hardware

  // Set a fixture's d, r, g, b in one call.
  // d is raw (0–254); masterDimmer is applied internally before sending to hardware.
  setFixture: (id, d, r, g, b) => {
    const rawD = Math.max(0, Math.min(254, Math.round(d)))
    set(s => ({ fixtureState: { ...s.fixtureState, [id]: { d: rawD, r, g, b } } }))
    if (!(get().fixtureEnabled[id] ?? true)) return
    const scaledD = Math.round(rawD * get().masterDimmer)
    window.api.setFixture(id, scaledD, r, g, b)
    set(s => ({ outputState: { ...s.outputState, [id]: { d: scaledD, r, g, b } } }))
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

  setGroupColor: (groupId, r, g, b) => {
    const { fixtures, fixtureState } = get()
    const targets = groupId === 'all' ? fixtures : fixtures.filter(f => f.group === groupId)
    targets.forEach(f => {
      const d = fixtureState[f.id]?.d ?? 254
      get().setFixture(f.id, d, r, g, b)
    })
  },

  // ── Fixture enabled state ──────────────────────────────────────────────────
  fixtureEnabled: {}, // { [id]: boolean }

  toggleFixtureEnabled: (id) => {
    const next = !(get().fixtureEnabled[id] ?? true)
    set(s => ({ fixtureEnabled: { ...s.fixtureEnabled, [id]: next } }))
    if (!next) {
      window.api.setFixture(id, 0, 0, 0, 0)
      set(s => ({ outputState: { ...s.outputState, [id]: { d: 0, r: 0, g: 0, b: 0 } } }))
    } else {
      const c = get().fixtureState[id] || { d: 254, r: 0, g: 0, b: 0 }
      get().setFixture(id, c.d, c.r, c.g, c.b)
    }
  },

  // ── Groups ─────────────────────────────────────────────────────────────────
  groups: [],

  // ── Master Dimmer ──────────────────────────────────────────────────────────
  masterDimmer: 1.0,

  setMasterDimmer: (value) => {
    set({ masterDimmer: value })
    const { fixtures, fixtureState, fixtureEnabled } = get()
    fixtures.forEach(f => {
      if (!(fixtureEnabled[f.id] ?? true)) return
      const c = fixtureState[f.id] || { d: 254, r: 0, g: 0, b: 0 }
      get().setFixture(f.id, c.d, c.r, c.g, c.b)
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

    const duration = fadeMs ?? scene.fade_in_ms ?? 0

    const effectFixtures = scene.fixtures.filter(f => f.effect)
    const staticFixtures = scene.fixtures.filter(f => !f.effect)

    const applyEffects = (fixtures) => {
      const groups = new Map()
      fixtures.forEach(({ id, effect, effectParams }) => {
        const key = effect + '\0' + JSON.stringify(effectParams ?? {})
        if (!groups.has(key)) groups.set(key, { effect, effectParams: effectParams ?? {}, ids: [] })
        groups.get(key).ids.push(id)
      })
      groups.forEach(({ effect, effectParams, ids }) => {
        get().effectEngine?.setFixtureEffect(ids, effect, effectParams)
        ids.forEach(id => get().setFixtureEffect([id], effect, effectParams))
      })
    }

    // Raw d from fixtureState (before masterDimmer scaling)
    const fromState = id => get().fixtureState[id] ?? { d: 0, r: 0, g: 0, b: 0 }

    if (duration > 0) {
      // Snapshot which fixtures currently run effects (before anything is cleared)
      const prevEffectIds = new Set(Object.keys(get().fixtureEffects).map(Number))

      // fromColors: static→effect fixtures (no old effect, gaining a new one)
      const fromColors = new Map(
        effectFixtures
          .filter(({ id }) => !prevEffectIds.has(id))
          .map(({ id }) => [id, fromState(id)])
      )

      // staticTargets: effect→static fixtures (had an effect, becoming static)
      const staticTargets = new Map(
        staticFixtures
          .filter(({ id }) => prevEffectIds.has(id))
          .map(({ id, dim, r, g, b }) => [id, { d: dim ?? 254, r, g, b }])
      )

      // Hand old effects to the fading layer; clear fixtureEffects for new ones
      get().effectEngine?.beginCrossfade(
        duration,
        fromColors.size  ? fromColors   : null,
        staticTargets.size ? staticTargets : null
      )
      set({ fixtureEffects: {} })

      // Static→static only: FadeEngine (fixtures with no effect on either side)
      staticFixtures
        .filter(({ id }) => !prevEffectIds.has(id))
        .forEach(({ id, dim, r, g, b }) => {
          const from = fromState(id)
          get().fadeEngine?.fadeTo(id, from.d, from.r, from.g, from.b, dim ?? 254, r, g, b, duration)
        })

      // Activate new effects (beginCrossfade already cleared old fixtureEffects)
      if (effectFixtures.length > 0) applyEffects(effectFixtures)

    } else {
      get().effectEngine?.clearAll()
      set({ fixtureEffects: {} })
      staticFixtures.forEach(({ id, dim, r, g, b }) => get().setFixture(id, dim ?? 254, r, g, b))
      applyEffects(effectFixtures)
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
    segmentInfinite: false,
    beatsPerBar: 4,
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

  // ── Metronome settings ─────────────────────────────────────────────────────
  metronomeEnabled:  localStorage.getItem('metronomeEnabled') === 'true',
  metronomeVolume:   parseFloat(localStorage.getItem('metronomeVolume') ?? '0.7'),
  metronomeDeviceId: localStorage.getItem('metronomeDeviceId') ?? '',
  setMetronomeEnabled:  (v) => { localStorage.setItem('metronomeEnabled', v); set({ metronomeEnabled: v }) },
  setMetronomeVolume:   (v) => { localStorage.setItem('metronomeVolume', v); set({ metronomeVolume: v }) },
  setMetronomeDeviceId: (v) => { localStorage.setItem('metronomeDeviceId', v); set({ metronomeDeviceId: v }) },

  // ── Toast ──────────────────────────────────────────────────────────────────
  toast: null, // { message, id }

  showToast: (message) => {
    const id = Date.now()
    set({ toast: { message, id } })
    setTimeout(() => set(s => s.toast?.id === id ? { toast: null } : {}), 2500)
  },

  // ── Dirty screen (unsaved changes guard) ───────────────────────────────────
  dirtyScreen: null, // null | screen id string

  setDirtyScreen:   (screen) => set({ dirtyScreen: screen }),
  clearDirtyScreen: ()       => set({ dirtyScreen: null }),

  // ── UI ─────────────────────────────────────────────────────────────────────
  activeScreen: 'live',
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}))

export default useStore
