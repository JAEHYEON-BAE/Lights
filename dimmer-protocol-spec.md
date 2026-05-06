# Dimmer Channel Protocol Extension — Implementation Spec

## Overview

Extend the serial packet from **5 bytes** to **6 bytes** to carry a hardware dimmer value.  
The Arduino will write this value directly to the `CH_DIMMER` (offset 0) DMX channel of each fixture,
replacing the current hardcoded `255`.

**New packet format:**

```
[0xFF] [fixture_id] [D] [R] [G] [B]
  ^         ^        ^   ^   ^   ^
start     0–31    0–254 0–254 0–254 0–254
```

> `0xFF` (255) is reserved as the start byte, so all data bytes are capped at **254 max**.  
> This is already enforced for R/G/B; D follows the same rule.

---

## Architectural Shift

| | Before | After |
|---|---|---|
| RGB sent to Arduino | `r * masterDimmer` (scaled) | `r` (unscaled, always full color) |
| Dimmer channel on DMX | hardcoded `255` | `Math.round(masterDimmer * 254)` |
| fixtureState stores | pre-dimmer RGB | true color RGB |
| strobe (software) | toggles R/G/B to 0 | toggles D (dimmer) to 0 |

---

## File 1 — `arduino/lighting_controller/lighting_controller.ino`

### 1-a. Comment block (line 8)

**Before:**
```c
 * Packet format (PC → Arduino): [0xFF][fixture_id][R][G][B]
```

**After:**
```c
 * Packet format (PC → Arduino): [0xFF][fixture_id][D][R][G][B]
```

### 1-b. Parser state enum (line 148–154)

Add a new state `STATE_READ_DIMMER` at the end of the enum:

**Before:**
```c
typedef enum {
  STATE_WAIT_START = 0,
  STATE_READ_ID,
  STATE_READ_R,
  STATE_READ_G,
  STATE_READ_B
} ParserState;
```

**After:**
```c
typedef enum {
  STATE_WAIT_START = 0,
  STATE_READ_ID,
  STATE_READ_DIMMER,
  STATE_READ_R,
  STATE_READ_G,
  STATE_READ_B
} ParserState;
```

> D comes immediately after the fixture ID, so `STATE_READ_DIMMER` is inserted before `STATE_READ_R`.

### 1-c. Parser variables (line 157)

**Before:**
```c
uint8_t pkt_id = 0, pkt_r = 0, pkt_g = 0;
```

**After:**
```c
uint8_t pkt_id = 0, pkt_d = 0, pkt_r = 0, pkt_g = 0;
```

(We need to store `d` so it is available when the final byte `B` completes the packet.)

### 1-d. `setFixture()` function signature and body (line 133–145)

**Before:**
```c
void setFixture(uint8_t id, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= MAX_FIXTURES) return;
  uint16_t base = fixtureMap[id];
  if (base == 0 || base + (CHANNELS_PER_FIX - 1) > DMX_CHANNELS) return;
  setChannelValue(base + CH_DIMMER, 255);  // full brightness; PC already scales RGB by dimmer
  setChannelValue(base + CH_RED,    r);
  setChannelValue(base + CH_GREEN,  g);
  setChannelValue(base + CH_BLUE,   b);
  setChannelValue(base + CH_STROBE, 0);
  setChannelValue(base + CH_MODE,   0);
  setChannelValue(base + CH_SPEED,  0);
}
```

**After:**
```c
void setFixture(uint8_t id, uint8_t d, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= MAX_FIXTURES) return;
  uint16_t base = fixtureMap[id];
  if (base == 0 || base + (CHANNELS_PER_FIX - 1) > DMX_CHANNELS) return;
  setChannelValue(base + CH_DIMMER, d);
  setChannelValue(base + CH_RED,    r);
  setChannelValue(base + CH_GREEN,  g);
  setChannelValue(base + CH_BLUE,   b);
  setChannelValue(base + CH_STROBE, 0);
  setChannelValue(base + CH_MODE,   0);
  setChannelValue(base + CH_SPEED,  0);
}
```

### 1-e. `parseSerial()` state machine (line 172–204)

Insert `STATE_READ_DIMMER` between `STATE_READ_ID` and `STATE_READ_R`, and update `STATE_READ_B` to finalize the packet:

**Before:**
```c
      case STATE_READ_ID:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else if (b == 0xFE) { blackoutAll(); parserState = STATE_WAIT_START; packetCount++; }
        else if (b == 0xFD) { dmxDisable(); delay(10); dmxEnable(); parserState = STATE_WAIT_START; }
        else { pkt_id = b; parserState = STATE_READ_R; }
        break;

      case STATE_READ_R:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_r = b; parserState = STATE_READ_G; }
        break;

      case STATE_READ_G:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_g = b; parserState = STATE_READ_B; }
        break;

      case STATE_READ_B:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { setFixture(pkt_id, pkt_r, pkt_g, b); packetCount++; parserState = STATE_WAIT_START; }
        break;
```

**After:**
```c
      case STATE_READ_ID:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else if (b == 0xFE) { blackoutAll(); parserState = STATE_WAIT_START; packetCount++; }
        else if (b == 0xFD) { dmxDisable(); delay(10); dmxEnable(); parserState = STATE_WAIT_START; }
        else { pkt_id = b; parserState = STATE_READ_DIMMER; }
        break;

      case STATE_READ_DIMMER:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_d = b; parserState = STATE_READ_R; }
        break;

      case STATE_READ_R:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_r = b; parserState = STATE_READ_G; }
        break;

      case STATE_READ_G:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { pkt_g = b; parserState = STATE_READ_B; }
        break;

      case STATE_READ_B:
        if (b == 0xFF) { errorCount++; parserState = STATE_READ_ID; }
        else { setFixture(pkt_id, pkt_d, pkt_r, pkt_g, b); packetCount++; parserState = STATE_WAIT_START; }
        break;
```

---

## File 2 — `src/main/serial-bridge.js`

### 2-a. State arrays (line 19–20)

**Before:**
```js
this.currentState = Array.from({ length: MAX_FIXTURES }, () => ({ r: 0, g: 0, b: 0 }))
this.pendingState = Array.from({ length: MAX_FIXTURES }, () => ({ r: 0, g: 0, b: 0 }))
```

**After:**
```js
this.currentState = Array.from({ length: MAX_FIXTURES }, () => ({ d: 254, r: 0, g: 0, b: 0 }))
this.pendingState = Array.from({ length: MAX_FIXTURES }, () => ({ d: 254, r: 0, g: 0, b: 0 }))
```

> Default dimmer is `254` (full brightness) so that fixtures are not dark on connect before any dimmer command is sent.

### 2-b. `setFixture()` method (line 79–89)

**Before:**
```js
setFixture(id, r, g, b) {
  if (id < 0 || id >= MAX_FIXTURES) return
  const cr = Math.max(0, Math.min(254, Math.round(r)))
  const cg = Math.max(0, Math.min(254, Math.round(g)))
  const cb = Math.max(0, Math.min(254, Math.round(b)))
  const p  = this.pendingState[id]
  if (p.r !== cr || p.g !== cg || p.b !== cb) {
    p.r = cr; p.g = cg; p.b = cb
    this.dirtyFlags[id] = true
  }
}
```

**After:**
```js
setFixture(id, d = 254, r, g, b) {
  if (id < 0 || id >= MAX_FIXTURES) return
  const cr = Math.max(0, Math.min(254, Math.round(r)))
  const cg = Math.max(0, Math.min(254, Math.round(g)))
  const cb = Math.max(0, Math.min(254, Math.round(b)))
  const cd = Math.max(0, Math.min(254, Math.round(d)))
  const p  = this.pendingState[id]
  if (p.r !== cr || p.g !== cg || p.b !== cb || p.d !== cd) {
    p.d = cd; p.r = cr; p.g = cg; p.b = cb
    this.dirtyFlags[id] = true
  }
}
```

### 2-c. `_sendFrame()` — packet construction (line 123–141)

**Before:**
```js
_sendFrame() {
  if (!this.connected || this.simulateMode || !this.port?.isOpen || this.blackout) return
  const packets = []
  for (let id = 0; id < MAX_FIXTURES; id++) {
    if (!this.dirtyFlags[id]) continue
    const { r, g, b } = this.pendingState[id]
    packets.push(START_BYTE, id, r, g, b)
    this.currentState[id] = { r, g, b }
    this.dirtyFlags[id]   = false
  }
  if (packets.length > 0) {
    if (DEBUG_SERIAL) {
      for (let i = 0; i < packets.length; i += 5) {
        dbg(`fixture ${packets[i+1].toString().padStart(2)}  → R:${packets[i+2].toString().padStart(3)} G:${packets[i+3].toString().padStart(3)} B:${packets[i+4].toString().padStart(3)}`)
      }
    }
    this.port.write(Buffer.from(packets))
  }
}
```

**After:**
```js
_sendFrame() {
  if (!this.connected || this.simulateMode || !this.port?.isOpen || this.blackout) return
  const packets = []
  for (let id = 0; id < MAX_FIXTURES; id++) {
    if (!this.dirtyFlags[id]) continue
    const { r, g, b, d } = this.pendingState[id]
    packets.push(START_BYTE, id, d, r, g, b)
    this.currentState[id] = { d, r, g, b }
    this.dirtyFlags[id]   = false
  }
  if (packets.length > 0) {
    if (DEBUG_SERIAL) {
      for (let i = 0; i < packets.length; i += 6) {
        dbg(`fixture ${packets[i+1].toString().padStart(2)}  → D:${packets[i+2].toString().padStart(3)} R:${packets[i+3].toString().padStart(3)} G:${packets[i+4].toString().padStart(3)} B:${packets[i+5].toString().padStart(3)}`)
      }
    }
    this.port.write(Buffer.from(packets))
  }
}
```

> Packet stride changes from `5` to `6` — update the debug log loop accordingly.

---

## File 3 — `src/main/index.js`

### 3-a. IPC handler (line 52)

**Before:**
```js
ipcMain.handle('serial:set-fixture',  (_, id, r, g, b)  => bridge.setFixture(id, r, g, b))
```

**After:**
```js
ipcMain.handle('serial:set-fixture',  (_, id, d, r, g, b)  => bridge.setFixture(id, d, r, g, b))
```

---

## File 4 — `src/preload/index.js`

### 4-a. `setFixture` API exposure (line 10)

**Before:**
```js
setFixture:  (id, r, g, b) => ipcRenderer.invoke('serial:set-fixture', id, r, g, b),
```

**After:**
```js
setFixture:  (id, d, r, g, b) => ipcRenderer.invoke('serial:set-fixture', id, d, r, g, b),
```

---

## File 5 — `src/renderer/src/store.js`

This file has the most significant logic changes.

### 5-a. `loadFixtures()` — initialize dimmer state (line 22–27)

**Before:**
```js
loadFixtures: (data) => {
  if (!data) return
  const state = {}
  data.fixtures.forEach(f => { state[f.id] = { r: 0, g: 0, b: 0 } })
  set({ fixtures: data.fixtures, groups: data.groups || [], fixtureState: state })
},
```

**After:**
```js
loadFixtures: (data) => {
  if (!data) return
  const state = {}
  data.fixtures.forEach(f => { state[f.id] = { d: 254, r: 0, g: 0, b: 0 } })
  set({ fixtures: data.fixtures, groups: data.groups || [], fixtureState: state })
},
```

### 5-b. `setFixtureColor()` — remove RGB scaling, pass dimmer as hardware channel (line 29–33)

**Before:**
```js
setFixtureColor: (id, r, g, b) => {
  const dimmer = get().masterDimmer
  set(s => ({ fixtureState: { ...s.fixtureState, [id]: { r, g, b } } }))
  window.api.setFixture(id, Math.round(r * dimmer), Math.round(g * dimmer), Math.round(b * dimmer))
},
```

**After:**
```js
setFixtureColor: (id, r, g, b) => {
  const d = Math.round(get().masterDimmer * 254)
  set(s => ({ fixtureState: { ...s.fixtureState, [id]: { r, g, b, d } } }))
  window.api.setFixture(id, d, r, g, b)
},
```

> RGB is now sent unscaled. The hardware dimmer channel carries the brightness.

### 5-c. `setMasterDimmer()` — update all fixtures via dimmer channel (line 56–63)

**Before:**
```js
setMasterDimmer: (value) => {
  set({ masterDimmer: value })
  const { fixtures, fixtureState } = get()
  fixtures.forEach(f => {
    const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
    window.api.setFixture(f.id, Math.round(c.r * value), Math.round(c.g * value), Math.round(c.b * value))
  })
},
```

**After:**
```js
setMasterDimmer: (value) => {
  const d = Math.round(value * 254)
  set({ masterDimmer: value })
  const { fixtures, fixtureState } = get()
  fixtures.forEach(f => {
    const c = fixtureState[f.id] || { r: 0, g: 0, b: 0 }
    window.api.setFixture(f.id, d, c.r, c.g, c.b)
  })
},
```

> Only the dimmer channel changes when the master fader moves — RGB values are untouched.

---

## File 6 — `src/renderer/src/engines/effect-engine.js`

### 6-a. `EffectEngine` constructor — accept `setFixtureDimmer` (line 79–85)

Add a second callback so strobe can control only the dimmer channel without overwriting color:

**Before:**
```js
export class EffectEngine {
  constructor(setFixtureColor) {
    this.setFixtureColor = setFixtureColor
    this.active = null
    this.ticker = null
    this.startTime = 0
  }
```

**After:**
```js
export class EffectEngine {
  constructor(setFixtureColor, setFixtureDimmer) {
    this.setFixtureColor  = setFixtureColor
    this.setFixtureDimmer = setFixtureDimmer
    this.active = null
    this.ticker = null
    this.startTime = 0
  }
```

### 6-b. `strobe` — control dimmer instead of RGB (line 47–59)

**Before:**
```js
strobe: {
  name: 'Strobe',
  defaultParams: { speed: 8, r: 255, g: 255, b: 255 },
  tick(fixtures, time, params) {
    const on = Math.floor((time / 1000) * params.speed) % 2 === 0
    return fixtures.map(id => ({
      id,
      r: on ? params.r : 0,
      g: on ? params.g : 0,
      b: on ? params.b : 0
    }))
  }
},
```

**After:**
```js
strobe: {
  name: 'Strobe',
  defaultParams: { speed: 8, phaseOffset: 0 },
  tick(fixtures, time, params) {
    return fixtures.map((id, idx) => {
      const shiftedTime = time + idx * params.phaseOffset
      const on = Math.floor((shiftedTime / 1000) * params.speed) % 2 === 0
      return { id, dimmer: on ? 254 : 0 }
    })
  }
},
```

> - Strobe no longer needs R/G/B — it only toggles the dimmer channel.  
> - `phaseOffset` (ms) gives per-fixture phase offset for free.  
> - The fixture's current color is preserved because RGB channels are not touched.

### 6-c. `EffectEngine.start()` — route dimmer-only results to `setFixtureDimmer` (line 87–98)

**Before:**
```js
start(effectKey, fixtureIds, params) {
  this.stop()
  const effect = EFFECTS[effectKey]
  if (!effect) return
  this.startTime = Date.now()
  this.ticker = setInterval(() => {
    const time = Date.now() - this.startTime
    const results = effect.tick(fixtureIds, time, params)
    results.forEach(({ id, r, g, b }) => this.setFixtureColor(id, r, g, b))
  }, 16)
  this.active = effectKey
}
```

**After:**
```js
start(effectKey, fixtureIds, params) {
  this.stop()
  const effect = EFFECTS[effectKey]
  if (!effect) return
  this.startTime = Date.now()
  this.ticker = setInterval(() => {
    const time = Date.now() - this.startTime
    const results = effect.tick(fixtureIds, time, params)
    results.forEach(result => {
      if (result.dimmer !== undefined) {
        this.setFixtureDimmer(result.id, result.dimmer)
      } else {
        this.setFixtureColor(result.id, result.r, result.g, result.b)
      }
    })
  }, 16)
  this.active = effectKey
}
```

---

## File 7 — `src/renderer/src/App.jsx`

### 7-a. `EffectEngine` instantiation

Wherever `EffectEngine` is constructed, pass both `setFixtureColor` and a new `setFixtureDimmer` callback.
`setFixtureDimmer` needs to be added to the store (see below).

**Before (approximate):**
```js
const engine = new EffectEngine(store.setFixtureColor)
```

**After:**
```js
const engine = new EffectEngine(store.setFixtureColor, store.setFixtureDimmer)
```

---

## File 8 — `src/renderer/src/store.js` (addendum)

### 8-a. Add `setFixtureDimmer()` action

Add this new action alongside `setFixtureColor`:

```js
setFixtureDimmer: (id, d) => {
  const clamped = Math.max(0, Math.min(254, Math.round(d)))
  set(s => ({
    fixtureState: {
      ...s.fixtureState,
      [id]: { ...s.fixtureState[id], d: clamped }
    }
  }))
  const c = get().fixtureState[id] || { r: 0, g: 0, b: 0 }
  window.api.setFixture(id, clamped, c.r, c.g, c.b)
},
```

> This lets the strobe effect toggle only the dimmer channel, leaving RGB state intact.

---

## Change Summary

| File | Change |
|---|---|
| `lighting_controller.ino` | New `STATE_READ_DIMMER`, `pkt_d` variable, `setFixture()` gains `d` as second param |
| `serial-bridge.js` | State `{ d,r,g,b }`, `setFixture(id,d,r,g,b)`, 6-byte packets |
| `main/index.js` | IPC handler forwards `d` argument |
| `preload/index.js` | `setFixture` API gains `d` param |
| `store.js` | `setFixtureColor` sends unscaled RGB + hardware dimmer; `setMasterDimmer` updates dimmer channel only; new `setFixtureDimmer` action |
| `effect-engine.js` | `strobe` returns `{ id, dimmer }` instead of RGB; `EffectEngine` routes dimmer results separately |
| `App.jsx` | Pass `setFixtureDimmer` to `EffectEngine` constructor |

## Backward Compatibility

- Existing scene files (`scene_*.json`) are **unaffected** — they store RGB values only.
- `masterDimmer` behavior from the user's perspective is **identical** — only the internal mechanism changes.
- All non-strobe effects (`chase`, `sinePulse`, `colorWave`, `randomFlicker`) are **unaffected** — they still return `{ id, r, g, b }`.
