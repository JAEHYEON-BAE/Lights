import { create } from 'zustand'

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
  fixtureState: {},   // { [id]: { r, g, b } }

  loadFixtures: (data) => {
    if (!data) return
    const state = {}
    data.fixtures.forEach(f => { state[f.id] = { r: 0, g: 0, b: 0 } })
    set({ fixtures: data.fixtures, groups: data.groups || [], fixtureState: state })
  },

  setFixtureColor: (id, r, g, b) => {
    const dimmer = get().masterDimmer
    set(s => ({ fixtureState: { ...s.fixtureState, [id]: { r, g, b } } }))
    window.api.setFixture(id, Math.round(r * dimmer), Math.round(g * dimmer), Math.round(b * dimmer))
  },

  setGroupColor: (groupId, r, g, b) => {
    const { fixtures } = get()
    const targets = groupId === 'all' ? fixtures : fixtures.filter(f => f.group === groupId)
    targets.forEach(f => get().setFixtureColor(f.id, r, g, b))
  },

  // ── Groups ─────────────────────────────────────────────────────────────────
  groups: [],

  // ── Blackout ───────────────────────────────────────────────────────────────
  blackoutActive: false,

  toggleBlackout: () => {
    const next = !get().blackoutActive
    set({ blackoutActive: next })
    window.api.setBlackout(next)
  },

  // ── Master Dimmer ──────────────────────────────────────────────────────────
  masterDimmer: 1.0,

  setMasterDimmer: (value) => {
    set({ masterDimmer: value })
    const { fixtures, fixtureState } = get()
    fixtures.forEach(f => {
      const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
      window.api.setFixture(f.id, Math.round(c.r * value), Math.round(c.g * value), Math.round(c.b * value))
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
    const scene = get().scenes.find(s => s.scene_id === sceneId)
    if (!scene) return

    if (scene.effect) {
      get().fadeEngine?.stop?.()
      get().effectEngine?.start(scene.effect, scene.effectFixtureIds || [], scene.effectParams || {})
      set({ activeEffect: scene.effect, effectParams: scene.effectParams || {}, effectFixtureIds: scene.effectFixtureIds || [], activeSceneId: sceneId })
      return
    }

    get().effectEngine?.stop()
    set({ activeEffect: null, effectParams: {}, effectFixtureIds: [] })

    const dimmer   = get().masterDimmer
    const duration = fadeMs ?? scene.fade_in_ms ?? 0
    if (duration > 0) {
      get().fadeEngine?.fadeScene(scene, dimmer, duration)
    } else {
      scene.fixtures.forEach(({ id, r, g, b }) => {
        get().setFixtureColor(id, r, g, b)
      })
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

  // ── Active Effect ──────────────────────────────────────────────────────────
  activeEffect: null,
  effectParams: {},
  effectFixtureIds: [],

  setActiveEffect: (effect, params, fixtureIds) => set({ activeEffect: effect, effectParams: params, effectFixtureIds: fixtureIds }),
  clearEffect:     ()               => set({ activeEffect: null, effectParams: {}, effectFixtureIds: [] }),

  // ── UI ─────────────────────────────────────────────────────────────────────
  activeScreen: 'live',
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}))

export default useStore
