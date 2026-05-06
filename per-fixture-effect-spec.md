# Per-Fixture Effect Assignment — Implementation Spec

## Overview

Allow each fixture to have its own independent color and effect (with params),
and save/recall this configuration as part of a scene.

**Target UX:**
- In the Effects screen, select individual fixtures (or groups) and assign an effect + params
- Save the entire per-fixture configuration as a named scene
- Recalling the scene restores each fixture's color and starts its individual effect

---

## 1. Scene File Format

### Current

```json
{
  "scene_id": "scene_123",
  "name": "My Scene",
  "fade_in_ms": 500,
  "fixtures": [
    { "id": 0, "r": 255, "g": 0, "b": 0 },
    { "id": 1, "r": 0, "g": 255, "b": 0 }
  ],
  "effect": "sinePulse",
  "effectParams": { "speed": 1, "phaseOffset": 45 },
  "effectFixtureIds": [0, 1]
}
```

### New

Each fixture entry carries its own `dim` (hardware dimmer, 0–254) and optional
`effect` / `effectParams`. The top-level `effect` / `effectParams` / `effectFixtureIds`
fields are removed.

Field order within each fixture: `id`, `dim`, `r`, `g`, `b`, `effect`, `effectParams`.

```json
{
  "version": "2.0",
  "scene_id": "scene_123",
  "name": "My Scene",
  "fade_in_ms": 500,
  "fixtures": [
    {
      "id": 0, "dim": 254,
      "r": 0, "g": 0, "b": 255,
      "effect": "sinePulse",
      "effectParams": { "speed": 1, "phaseOffset": 0, "minBrightness": 0 }
    },
    {
      "id": 1, "dim": 200,
      "r": 0, "g": 200, "b": 0,
      "effect": "sinePulse",
      "effectParams": { "speed": 2, "phaseOffset": 45, "minBrightness": 0.2 }
    },
    {
      "id": 2, "dim": 254,
      "r": 255, "g": 80, "b": 0,
      "effect": null
    }
  ]
}
```

### Backward Compatibility

When loading a scene file:
- If `version` is missing or `"1.0"`, migrate the old format on load:

```js
function migrateScene(raw) {
  if (raw.version === '2.0') return raw
  // v1: move top-level effect into each fixture entry; default dim to 254
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
```

Call `migrateScene()` immediately after JSON.parse in `file:load-scenes` IPC handler
(`src/main/index.js`) and in `store.js` `recallScene()`.

---

## 2. `effect-engine.js`

### 2-a. Replace single-fixture-group model with per-fixture map

**Current:**
```js
export class EffectEngine {
  constructor(setFixtureColor, setFixtureDimmer) {
    this.setFixtureColor  = setFixtureColor
    this.setFixtureDimmer = setFixtureDimmer
    this.active    = null   // one effect key
    this.ticker    = null   // one setInterval
    this.startTime = 0
  }

  start(effectKey, fixtureIds, params) { ... }
  stop() { ... }
}
```

**New — unified 16 ms loop, per-fixture effect map:**
```js
export class EffectEngine {
  constructor(setFixtureColor, setFixtureDimmer) {
    this.setFixtureColor  = setFixtureColor
    this.setFixtureDimmer = setFixtureDimmer
    // Map<fixtureId, { effectKey, params, startTime }>
    this.fixtureEffects = new Map()
    this.ticker = null
  }

  // Assign (or remove) an effect for one or more fixture IDs
  setFixtureEffect(fixtureIds, effectKey, params) {
    const effect = EFFECTS[effectKey]
    if (!effect) return
    const startTime = Date.now()
    fixtureIds.forEach(id => {
      this.fixtureEffects.set(id, { effectKey, params, startTime })
    })
    // Run init hook if present (set base color)
    if (effect.init) effect.init(fixtureIds, params, this.setFixtureColor)
    this._ensureTicker()
  }

  clearFixtureEffect(fixtureIds) {
    fixtureIds.forEach(id => this.fixtureEffects.delete(id))
    if (this.fixtureEffects.size === 0) this._stopTicker()
  }

  clearAll() {
    this.fixtureEffects.clear()
    this._stopTicker()
  }

  // Keep old start()/stop() as convenience wrappers for backward compat
  start(effectKey, fixtureIds, params) {
    this.clearAll()
    this.setFixtureEffect(fixtureIds, effectKey, params)
  }

  stop() { this.clearAll() }

  destroy() { this.clearAll() }

  _ensureTicker() {
    if (this.ticker) return
    this.ticker = setInterval(() => this._tick(), 16)
  }

  _stopTicker() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null }
  }

  _tick() {
    if (this.fixtureEffects.size === 0) return
    const now = Date.now()
    // Group fixtures by (effectKey + params identity) to batch tick() calls
    // For simplicity, call tick() per fixture (single-element array)
    this.fixtureEffects.forEach(({ effectKey, params, startTime }, id) => {
      const effect = EFFECTS[effectKey]
      if (!effect) return
      const time = now - startTime
      const results = effect.tick([id], time, params)
      results.forEach(result => {
        if (result.dimmer !== undefined) {
          this.setFixtureDimmer(result.id, result.dimmer)
        } else {
          this.setFixtureColor(result.id, result.r, result.g, result.b)
        }
      })
    })
  }
}
```

> **Note:** `tick([id], time, params)` passes a single-element array. All existing
> `tick()` implementations use `fixtures.map((id, idx) => ...)` where `idx` will
> always be `0` per fixture. For phase-offset effects like `sinePulse` this means
> per-fixture phase is encoded in `params.phaseOffset` directly (the offset for
> that specific fixture), not derived from `idx`. See section 5 for how the UI
> handles this.

---

## 3. `src/renderer/src/store.js`

### 3-a. Replace single active-effect state with per-fixture map

**Remove these state fields:**
```js
activeEffect: null,
effectParams: {},
effectFixtureIds: [],
setActiveEffect: ...,
clearEffect: ...,
```

**Add:**
```js
// { [fixtureId]: { effectKey, params } }  — mirrors EffectEngine.fixtureEffects
fixtureEffects: {},

setFixtureEffect: (fixtureIds, effectKey, params) => {
  set(s => {
    const next = { ...s.fixtureEffects }
    fixtureIds.forEach(id => { next[id] = { effectKey, params } })
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
```

### 3-b. Update `recallScene()`

**Current logic (simplified):**
```js
recallScene: (sceneId, fadeMs) => {
  const scene = get().scenes.find(s => s.scene_id === sceneId)
  if (scene.effect) {
    get().effectEngine?.start(scene.effect, scene.effectFixtureIds, scene.effectParams)
    ...
    return
  }
  get().effectEngine?.stop()
  // set fixture colors via fade or immediate
}
```

**New logic:**
```js
recallScene: (sceneId, fadeMs) => {
  const scene = migrateScene(get().scenes.find(s => s.scene_id === sceneId))
  if (!scene) return

  get().effectEngine?.clearAll()
  set({ fixtureEffects: {} })

  const dimmer = get().masterDimmer
  const duration = fadeMs ?? scene.fade_in_ms ?? 0

  // 1. Set base colors + per-fixture dimmer (via fade or immediate)
  if (duration > 0) {
    get().fadeEngine?.fadeScene(scene, dimmer, duration)
  } else {
    scene.fixtures.forEach(({ id, dim, r, g, b }) => {
      get().setFixtureColor(id, r, g, b)
      get().setFixtureDimmer(id, dim ?? 254)
    })
  }

  // 2. Start per-fixture effects after fade (or immediately if no fade)
  const startEffects = () => {
    scene.fixtures.forEach(({ id, effect, effectParams }) => {
      if (!effect) return
      get().effectEngine?.setFixtureEffect([id], effect, effectParams ?? {})
      get().setFixtureEffect([id], effect, effectParams ?? {})
    })
  }

  if (duration > 0) {
    setTimeout(startEffects, duration)
  } else {
    startEffects()
  }

  set({ activeSceneId: sceneId })
},
```

### 3-c. Update `saveScene()`

The scene object passed to `saveScene()` must now include per-fixture effect data.
No change needed in `saveScene()` itself — it just writes whatever object is passed.
The caller (UI) is responsible for building the correct structure (see section 5).

---

## 4. `src/main/index.js`

### 4-a. Add migration on scene load

```js
ipcMain.handle('file:load-scenes', () => {
  const dir = join(resourcesDir, 'scenes')
  ensureDir(dir)
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return migrateScene(JSON.parse(readFileSync(join(dir, f), 'utf-8'))) }
      catch { return null }
    })
    .filter(Boolean)
})
```

Add the same `migrateScene()` function from section 1 to this file.

---

## 5. `src/renderer/src/screens/EffectEngineScreen.jsx`

This screen needs the most significant redesign. The new layout has three columns:

```
┌──────────────┬──────────────────────────────┬─────────────────────┐
│ Fixture List │   Effect + Params Editor      │  Live Preview       │
│              │                              │  (StageVisualizer)  │
│ [✓] SL 1 ●  │  Effect: [sinePulse ▼]       │                     │
│ [ ] SL 2    │  Color:  [████] R G B        │                     │
│ [✓] SL 3 ●  │  Speed:  ────────── 1.0      │                     │
│ [ ] SR 1    │  Phase:  ────────── 45°      │                     │
│ [✓] SR 2 ●  │  MinBri: ────────── 20%      │                     │
│             │                              │                     │
│             │  [Apply to selected]          │                     │
│             │  [Clear selected]             │                     │
│             │                              │                     │
│             │  ──────────────────           │                     │
│             │  [Save as Scene...]           │                     │
└──────────────┴──────────────────────────────┴─────────────────────┘
```

### Key state

```js
const [selectedIds, setSelectedIds] = useState([])   // fixture IDs checked in list
const [effectKey, setEffectKey]     = useState('sinePulse')
const [params, setParams]           = useState(EFFECTS['sinePulse'].defaultParams)
```

### Fixture list (left column)

Render every fixture as a checkbox row. Show a colored dot if that fixture currently
has an active effect (`fixtureEffects[id]` exists in store). Clicking a fixture
populates the editor with that fixture's current effect/params (if any).

```jsx
{fixtures.map(f => {
  const hasEffect = !!fixtureEffects[f.id]
  const checked   = selectedIds.includes(f.id)
  return (
    <label key={f.id} className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked}
        onChange={() => toggleSelect(f.id)} />
      <span>{f.name}</span>
      {hasEffect && <span className="w-2 h-2 rounded-full bg-accent-blue" />}
    </label>
  )
})}
```

### "Apply to selected" button

```js
const applyToSelected = () => {
  if (selectedIds.length === 0) return
  effectEngine.current?.setFixtureEffect(selectedIds, effectKey, params)
  store.setFixtureEffect(selectedIds, effectKey, params)
}
```

### "Clear selected" button

```js
const clearSelected = () => {
  effectEngine.current?.clearFixtureEffect(selectedIds)
  store.clearFixtureEffect(selectedIds)
}
```

### "Save as Scene" button

Collect the current live state of all fixtures and build a v2 scene object:

```js
const saveAsScene = async () => {
  const scene = {
    version: '2.0',
    scene_id: `scene_${Date.now()}`,
    name: sceneName,      // from a text input
    fade_in_ms: 0,
    fixtures: fixtures.map(f => {
      const color  = fixtureState[f.id] || { d: 254, r: 0, g: 0, b: 0 }
      const entry  = fixtureEffects[f.id] || null
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
  await store.saveScene(scene)
}
```

### Remove from this screen

- The old group-selector `<select>` (replaced by fixture checkbox list)
- The old global START / STOP buttons (replaced by Apply / Clear per selection)
- The `activeEffect` / `effectFixtureIds` store references

---

## 6. `src/renderer/src/App.jsx`

### 6-a. Remove store references to deleted fields

Remove:
```js
const setEffectEngine = useStore(s => s.setEffectEngine)  // keep this
// Remove any references to setActiveEffect, clearEffect, activeEffect
```

No change to EffectEngine construction — `setFixtureColor` and `setFixtureDimmer`
are still injected the same way.

---

## 7. Anywhere `activeEffect` / `effectFixtureIds` is read

Search the entire `src/renderer/` tree for:
- `s.activeEffect`
- `s.effectFixtureIds`
- `s.effectParams`
- `clearEffect`
- `setActiveEffect`

Replace with reads from `s.fixtureEffects` where needed (e.g., `Sidebar` or
`StatusBar` may show an "effect running" indicator — update to check
`Object.keys(fixtureEffects).length > 0`).

---

## 8. `src/renderer/src/screens/SceneBrowserScreen.jsx`

### 8-a. Scene thumbnail

The `SceneThumbnail` component renders a row of fixture color swatches.
No change needed for colors (`f.r`, `f.g`, `f.b` are still present).

Optionally, show a small effect indicator dot on fixtures that have an effect:

Apply `dim` to the displayed color so the thumbnail reflects saved brightness:

```jsx
{Array.from({ length: 8 }, (_, i) => {
  const f = scene.fixtures.find(x => x.id === i)
  const dim = (f?.dim ?? 254) / 254
  const color = f
    ? rgbToHex(Math.round(f.r * dim), Math.round(f.g * dim), Math.round(f.b * dim))
    : '#111'
  return (
    <div key={i} style={{ background: color }} className="h-full relative">
      {f?.effect && (
        <span className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-white opacity-60" />
      )}
    </div>
  )
})}
```

---

## Change Summary

| File | Change |
|---|---|
| `resources/scenes/*.json` | New v2 format: per-fixture `dim`, `effect`, `effectParams`; old files migrated on load (dim defaults to 254) |
| `effect-engine.js` | `EffectEngine` replaced with per-fixture map + unified 16ms loop; `start()`/`stop()` kept as wrappers |
| `store.js` | Remove `activeEffect/effectParams/effectFixtureIds`; add `fixtureEffects` map + `setFixtureEffect` / `clearFixtureEffect` / `clearAllEffects`; rewrite `recallScene()` |
| `main/index.js` | Add `migrateScene()` to scene load handler |
| `EffectEngineScreen.jsx` | Full redesign: fixture checkbox list + per-selection effect editor + Save as Scene |
| `App.jsx` | Remove dead store references |
| `SceneBrowserScreen.jsx` | Optional: effect indicator dot on thumbnail swatches |
| Other screens | Search and remove all `activeEffect` / `effectFixtureIds` references |

## Implementation Order

1. `effect-engine.js` — core engine, no UI dependency
2. `store.js` — state shape + `recallScene()`
3. `main/index.js` — migration on load
4. `EffectEngineScreen.jsx` — new UI
5. `App.jsx` + other screens — cleanup dead references
6. Manual test: assign two different sinePulse colors, save scene, reload, recall
