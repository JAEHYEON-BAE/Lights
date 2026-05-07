# How the Lighting Controller Works

This document explains every file in the project and how they fit together into a complete system.

---

## Big Picture

The system has two separate physical components that talk to each other over a USB cable:

```
[PC — Electron App] ──USB Serial 115200 baud──► [Arduino Mega] ──DMX512──► [Stage Lights]
```

- The **PC app** is where all the intelligence lives: color picking, scenes, cue lists, effects.
- The **Arduino** is a dumb relay. It receives simple 5-byte color packets from the PC and writes DMX values to the lights. It knows nothing about scenes or effects.
- **DMX512** is the industry-standard protocol that stage lights speak. It sends 512 channel values over an RS-485 cable.

---

## Project Layout

```
Lights/
├── arduino/
│   └── lighting_controller.ino   ← Arduino firmware
├── lighting-controller/          ← The Electron desktop app
│   ├── src/
│   │   ├── main/                 ← Electron main process (Node.js)
│   │   ├── preload/              ← IPC bridge
│   │   └── renderer/             ← React UI
│   └── resources/
│       ├── fixtures.json         ← Fixture definitions
│       ├── cue-list.json         ← Saved show cue list
│       └── scenes/               ← One JSON file per saved scene
```

---

## The Arduino Firmware (`arduino/lighting_controller/lighting_controller.ino`)

This is the firmware flashed onto the Arduino Mega 2560.

### What it does

1. **Receives 6-byte packets** from the PC over USB at 115200 baud.
2. **Translates each packet** into a DMX channel write using a `fixtureMap` lookup table.
3. **Sends a heartbeat** back to the PC every second so the PC knows the Arduino is alive.

### The serial packet format

Every color command the PC sends is exactly 6 bytes:

```
[0xFF] [fixture_id] [D] [R] [G] [B]
```

- `0xFF` is the start marker that tells the Arduino "a new packet is beginning."
- `fixture_id` is 0–31, identifying which light to update.
- `D` is the individual dimmer value 0–254.
- `R`, `G`, `B` are color values 0–255.

Two special `fixture_id` values exist:
- `0xFE` → **Blackout**: set all DMX channels to 0 immediately.
- `0xFD` → **Reset**: restart the DMX master (used to recover from faults).

### The parser state machine

The Arduino reads bytes one at a time in `loop()`. A simple state machine (`STATE_WAIT_START` → `STATE_READ_ID` → `STATE_READ_DIMMER` → `STATE_READ_R` → `STATE_READ_G` → `STATE_READ_B`) assembles each packet. If it sees `0xFF` in an unexpected position (meaning a packet was corrupted), it re-synchronises by treating it as a new start byte.

### The fixture map

```cpp
uint16_t fixtureMap[MAX_FIXTURES] = {
  1,  // Fixture 0 → DMX channels 1–7
  8,  // Fixture 1 → DMX channels 8–14
  ...
};
```

This maps a logical fixture ID (0–31) to the DMX base channel. Each fixture uses 7 consecutive channels (dimmer, red, green, blue, strobe, mode, speed). **This table must match `resources/fixtures.json`** on the PC side — they are two halves of the same fixture definition.

### The heartbeat

Every 1000ms, the Arduino sends back 8 bytes:
```
[0xAA] [0x01] [dmx_running] [packet_count] [error_count] [0] [0] [0]
```
The PC monitors these. If no heartbeat arrives for 3 seconds, the app shows a "not responding" warning.

---

## The Electron App

Electron is a framework that lets you build desktop applications using web technology (HTML, CSS, JavaScript). It runs two separate JavaScript environments simultaneously:

- **Main process** — a full Node.js environment. It can access the filesystem, USB serial ports, and OS APIs.
- **Renderer process** — a sandboxed Chromium browser tab. This is where the React UI runs.

These two processes cannot call each other's code directly. They communicate through a message-passing system called **IPC** (Inter-Process Communication).

---

## Main Process (`src/main/index.js`)

This is the entry point for the Node.js side of the app.

### What it registers

**Serial IPC handlers** — when the renderer calls `window.api.connect(port)`, it travels through IPC and lands here as `ipcMain.handle('serial:connect', ...)`, which then calls the SerialBridge.

**File IPC handlers** — `fixtures.json`, scene files, and `cue-list.json` are all read/written here. The renderer never touches the filesystem directly.

**Event forwarding** — the SerialBridge emits events (e.g. `connected`, `heartbeat`, `blackout`). This file forwards those events to the renderer window using `win.webContents.send(channel, data)`.

### File storage paths

In development (`npm run dev`): files are read from `lighting-controller/resources/`.

In a packaged app (`.dmg` / `.exe`): files are read from `process.resourcesPath/resources/`, which is inside the app bundle.

---

## The Serial Bridge (`src/main/serial-bridge.js`)

This is the most technically critical file in the project. It runs entirely in the main process (Node.js) and manages the USB serial connection to the Arduino.

### Key concepts

**Dirty flags** — Rather than sending every fixture's color on every frame, the bridge tracks which fixtures have changed since the last frame was sent. Only those "dirty" fixtures are included in the next transmission. This keeps the USB bus from being flooded.

**Frame loop** — A `setInterval` fires 44 times per second (~every 22ms). Each tick, it assembles a single `Buffer` of all dirty fixture packets and writes it to the serial port in one call. Batching into one write is more efficient than one `port.write()` call per fixture.

**Pending vs current state** — The bridge maintains two state arrays:
- `pendingState` — the color the renderer *wants* each fixture to be.
- `currentState` — the color that was last *sent* to the Arduino.

A dirty flag is set when pending ≠ current. The frame loop copies pending → current and clears the flag when a packet is sent.

**Simulate mode** — When there is no Arduino hardware available, `startSimulate()` puts the bridge into a fake-connected state. It still runs the frame loop (so all the same code paths execute), but skips the actual `port.write()` calls. A fake heartbeat is emitted every second. This lets you develop and test scenes, cues, and effects without any hardware.

**Heartbeat watcher** — A separate `setInterval` checks every second whether a real heartbeat has been received in the last 3 seconds. If not, it emits a `heartbeat-timeout` event, which the main process forwards to the renderer.

---

## The Preload Script (`src/preload/index.js`)

Electron's security model does not allow the renderer (browser) to call Node.js APIs directly. The preload script is a thin bridge that runs in a special context with access to both sides.

It uses `contextBridge.exposeInMainWorld('api', {...})` to attach a safe `window.api` object to the renderer's JavaScript environment. Every method on `window.api` is just a wrapper around `ipcRenderer.invoke(...)` (for calls from renderer → main) or `ipcRenderer.on(...)` (for events from main → renderer).

This is the complete list of what the renderer is allowed to do:

```
Serial actions:  listPorts, startSimulate, stopSimulate, connect, disconnect,
                 setFixture, setBlackout, reset, isConnected
Serial events:   onConnected, onDisconnected, onError, onHeartbeat,
                 onHeartbeatTimeout, onBlackout
File actions:    loadFixtures, saveFixtures, loadScenes, saveScene, deleteScene,
                 loadCueList, saveCueList
```

---

## Renderer: The React App

Everything in `src/renderer/src/` is the React UI that the user interacts with.

### App entry (`main.jsx` → `App.jsx`)

`main.jsx` is just the React entry point — it mounts `<App />` into the HTML page.

`App.jsx` is the root component. It does three important things on startup:

1. **Creates the engines** — `FadeEngine` and `EffectEngine` are instantiated here and destroyed when the app unmounts. Both are stored: `EffectEngine` is kept in a `useRef` (passed as a prop to `EffectEngineScreen`) and also in the Zustand store (via `setEffectEngine`) so that `recallScene` can trigger effects from store actions.
2. **Loads initial data** — calls `window.api.loadFixtures()`, `window.api.loadScenes()`, and `window.api.loadCueList()` once on startup to populate the Zustand store.
3. **Registers serial event listeners** — listens for `onConnected`, `onDisconnected`, `onHeartbeat`, `onHeartbeatTimeout` and routes them into the store.

It also registers the **global keyboard shortcuts**:
- `Space` → toggle blackout
- `Enter` → go to next cue
- `Backspace` → go to previous cue

The layout is: `<Sidebar>` on the left, `<StatusBar>` on top, one of the five screens in the main area, a `<StageVisualizer>` panel on the right (hidden on the `settings` and `fixtures` screens), and `<BlackoutButton>` overlaid on the right edge.

---

## State Management (`src/renderer/src/store.js`)

All shared state lives in a single **Zustand** store. Zustand is a minimal React state library — you read from it with `useStore(s => s.someField)` and update it by calling actions.

The store is divided into these sections:

| Section | What it holds |
|---|---|
| **Connection** | `connected`, `connectedPort`, `simulateMode`, `heartbeat`, `heartbeatTimeout` |
| **Fixtures** | `fixtures` (the definitions), `fixtureState` (current colors as `{[id]: {d,r,g,b}}`) |
| **Groups** | The group definitions loaded from fixtures.json |
| **Blackout** | `blackoutActive` flag |
| **Master Dimmer** | `masterDimmer` (0.0–1.0 multiplier) |
| **Scenes** | `scenes` array, `activeSceneId` |
| **Cue List** | `cueList` object, `currentCueIndex` |
| **Engines** | `fadeEngine` ref, `effectEngine` ref |
| **Per-fixture Effects** | `fixtureEffects` (`{[fixtureId]: {effectKey, params}}`) |
| **UI** | `activeScreen` (which of the 5 screens is shown) |

### The central write path

`setFixtureColor(id, r, g, b)` is called by every part of the app that wants to change a light's color. It:
1. Updates `fixtureState` in React (so the UI re-renders), storing `{d, r, g, b}` where `d` is the current master dimmer scaled to 0–254.
2. Calls `window.api.setFixture(id, r*dimmer, g*dimmer, b*dimmer)` to send the command to the main process (which forwards it to the Arduino).

`setFixtureDimmer(id, d)` updates only the individual dimmer channel for a fixture without changing its RGB color.

The **master dimmer** is applied at `setFixtureColor` time. The store stores the "true" color, but only the dimmer-scaled color is ever sent to the Arduino.

---

## The Engines

### Fade Engine (`src/renderer/src/engines/fade-engine.js`)

Handles smooth color transitions over time. When `recallScene` is called with a non-zero `fade_in_ms`, it uses this engine instead of jumping instantly.

It runs its own `setInterval` at 16ms (≈60fps). For each active fade, it interpolates from the start color to the end color using a **cubic ease-in-out** curve, then calls `setFixtureColor` with the intermediate value. When the fade completes, it removes that fixture from the active fades map.

### Effect Engine (`src/renderer/src/engines/effect-engine.js`)

Generates time-varying RGB values to create animated lighting effects. It also runs a `setInterval` at 16ms.

Each effect is defined as a pure `tick(fixtures, time, params)` function — given a list of fixture IDs, the elapsed time in milliseconds, and some parameters, it returns an array of `{id, r, g, b}` results. The engine calls `setFixtureColor` with these results on every tick.

Unlike the global group-level effects in earlier versions, the engine now supports **per-fixture effect assignment**: each fixture can independently run a different effect (or a static color) at the same time.

The five built-in effects are:

| Effect | What it does |
|---|---|
| **Color** | Static solid color with individual dimmer control. |
| **Chase** | One fixture is lit at a time; the active fixture cycles through all of them at the given speed. |
| **Sine Pulse** | All fixtures pulse in brightness together, following a sine wave. |
| **Color Wave** | A full rainbow hue cycle propagates across the fixtures with a configurable phase offset between each one. |
| **Strobe** | All fixtures flash on and off at the given speed. |
| **Random Flicker** | Fixtures independently flicker to simulate fire or candles. Uses a deterministic seed so the pattern isn't just random noise. |

---

## The Five Screens

### Live Control (`screens/EffectEngineScreen.jsx`) — screen key: `live`

The primary performance screen. Shows a grid of **fixture tiles**, one per fixture. Each tile's background color reflects the fixture's current color. Clicking a tile selects it for editing.

The right panel shows the **effect editor** for the selected fixture(s). You can assign any of the built-in effects (or a static color) to each fixture independently. Clicking **Apply** commits the effect to the selected fixtures; **Clear** removes it and returns those fixtures to manual color control.

**Group selector buttons** at the top let you select all fixtures in a group at once. The **Save Scene** button snapshots the current colors and active effect assignments into a named scene file.

Parameter changes while an effect is running immediately update the engine with new values — no need to stop and restart.

### Scene Browser (`screens/SceneBrowserScreen.jsx`) — screen key: `scenes`

A library of saved lighting states. Each scene card shows a **thumbnail** — a miniature colored grid of the first 8 fixtures in the scene.

**Saving a scene** takes a snapshot of the current `fixtureState` and per-fixture effect assignments from the store, prompts for a name, and writes it to `resources/scenes/<scene_id>.json` via `window.api.saveScene()`. The scene ID is a timestamp (`scene_<Date.now()>`).

**Recalling a scene** (double-click, or click GO) calls `store.recallScene(sceneId)`, which either instantly sets all fixture colors or fades to them using the scene's `fade_in_ms` setting. Per-fixture effect assignments saved with the scene are also restored. Right-clicking a scene card opens a context menu with Recall and Delete options.

### Cue List (`screens/CueListScreen.jsx`) — screen key: `cues`

A sequenced show playback tool. A **cue list** is an ordered table of cues, each linking a scene to a fade time and a cue number.

The **GO button** (or `Enter` key) advances `currentCueIndex` and recalls the next cue's scene. **BACK** (or `Backspace`) goes back one cue. Clicking any row in the table jumps directly to that cue.

Cue names can be edited by double-clicking them. The associated scene and fade time are editable inline. All changes are immediately saved to `cue-list.json` via `window.api.saveCueList()`.

### Fixture Editor (`screens/FixtureEditorScreen.jsx`) — screen key: `fixtures`

A dedicated screen for managing the physical lighting rig configuration.

The left column lists all defined fixtures and groups. Clicking **Add Fixture** or **Add Group** opens a form panel on the right. Clicking an existing fixture or group opens it for editing.

**Fixture fields**: name, type preset (RGB PAR 3ch / 4ch / 7ch, RGBA 8ch), DMX base channel, group assignment.

**DMX conflict detection** — the editor highlights any fixtures whose DMX channel ranges overlap, preventing accidental channel collisions before they reach the hardware.

All changes are committed by clicking **Save** in the edit panel, which writes the updated `fixtures.json` to disk via `window.api.saveFixtures()` and reloads the fixture definitions into the store.

### Settings (`screens/SettingsScreen.jsx`) — screen key: `settings`

Configuration screen for hardware connection.

**Serial connection** — lists all detected serial ports. You select a port and click Connect. The connection goes through `window.api.connect(port)` → IPC → `SerialBridge.connect()`.

**Simulate mode** — if you have no Arduino, "Start Simulate" enables the fake-connected mode so you can use all features of the app (scenes, cues, effects) without hardware.

**Fixture configuration** — lets you load a custom `fixtures.json` from a different file path, or reload the default one. This is how you would point the app at a fixtures file located outside the app bundle (e.g., a show-specific rig file).

---

## Shared UI Components

### Sidebar (`components/Sidebar.jsx`)

The narrow left navigation column with 5 icon buttons. Calls `store.setActiveScreen(id)` on click. The small dot at the top glows green when connected to an Arduino.

### StatusBar (`components/StatusBar.jsx`)

The thin bar across the top of the app. Shows:
- **Connection dot**: gray = disconnected, green = connected, purple = simulate mode, yellow (pulsing) = heartbeat timeout.
- **Heartbeat stats**: packet count and error count from the last Arduino heartbeat.
- **BLACKOUT** text (red, pulsing) when blackout is active.
- **Master Dimmer slider**: a range input that calls `store.setMasterDimmer(value)`. Changing the master dimmer immediately re-broadcasts all current fixture colors scaled by the new value.

### StageVisualizer (`components/StageVisualizer.jsx`)

A miniature overhead view of the stage rig, shown in a narrow right panel on all screens except `settings` and `fixtures`. Fixtures are arranged by group, and each fixture tile glows with its current color in real time. Accepts a `compact` prop that scales down sizes for the sidebar layout.

### ColorPicker (`components/ColorPicker.jsx`)

A modal color picker with four input methods:
- **Hue slider** — a rainbow gradient range input (0–359°).
- **Saturation and Brightness sliders** — HSV controls.
- **R/G/B sliders** — direct channel control (0–255 each).
- **Hex input** — type a color code directly.
- **Preset swatches** — 12 common colors for quick access.

All four inputs are kept in sync. Internally it stores state as HSV (hue, saturation, value), converts to RGB on every change, and calls `onChange(r, g, b)` — which ultimately calls `store.setFixtureColor()`.

### BlackoutButton (`components/BlackoutButton.jsx`)

A large persistent button on the right edge of the screen. Calls `store.toggleBlackout()`, which sends the `0xFE` special command to the Arduino via `window.api.setBlackout()`. The same blackout toggle is bound to the `Space` key globally.

---

## Data Files (`resources/`)

### `fixtures.json`

Defines the physical lighting rig. Each fixture has:
- `id` — the logical ID used in all packets (0–31). Must match `fixtureMap[]` in the Arduino.
- `name` — human-readable label shown in the UI.
- `type` — fixture preset key (e.g. `rgb_par_7ch`) that defines the channel layout.
- `dmx_base` — the DMX start channel on the physical fixture (set via DIP switches on the light).
- `channels` — channel offset map derived from the type preset (e.g. `{dimmer: 0, red: 1, green: 2, blue: 3}`).
- `group` — group name for bulk control.

Groups are also defined here and control what appears in the group selector buttons.

### `scenes/scene_<timestamp>.json`

Each saved scene is its own file. A scene stores:
- `scene_id`, `name`, `fade_in_ms`, `fade_out_ms`
- `fixtures` — an array of `{id, dim, r, g, b, effect, effectParams}` snapshots for every fixture at the time the scene was saved.

### `cue-list.json`

A single file for the whole show. Contains:
- `show_name` — displayed in the Cue List screen header.
- `cues` — ordered array of `{cue_number, name, scene_id, trigger, fade_in_ms}`.

`scene_id` links a cue to a scene file. The cue's `fade_in_ms` overrides the scene's default fade time.

---

## Data Flow Summary

Here is what happens when you click a color on a fixture tile and the light changes:

```
1. User drags a slider in ColorPicker
        ↓
2. ColorPicker calls onChange(r, g, b)
        ↓
3. EffectEngineScreen calls store.setFixtureColor(id, r, g, b)
        ↓
4. store.js updates fixtureState → React re-renders the fixture tile with new background color
   store.js calls window.api.setFixture(id, d, r, g, b)
        ↓
5. preload/index.js: ipcRenderer.invoke('serial:set-fixture', id, d, r, g, b)
        ↓  [IPC boundary — crosses from renderer to main process]
6. main/index.js: ipcMain.handle('serial:set-fixture', ...) calls bridge.setFixture(id, d, r, g, b)
        ↓
7. serial-bridge.js: updates pendingState[id], sets dirtyFlags[id] = true
        ↓  [next 44Hz frame tick, ~0–22ms later]
8. serial-bridge.js: _sendFrame() sees the dirty flag, builds packet [0xFF, id, d, r, g, b],
   writes to the serial port
        ↓  [USB serial, ~0.4ms]
9. Arduino: receives 6 bytes, parser assembles the packet,
   calls setFixture(id, d, r, g, b)
        ↓
10. Arduino: setChannelValue(dmxBase + CH_DIMMER, d), setChannelValue(dmxBase + CH_RED, r) — and same for g, b
        ↓  [DMX512 frame, ~22.7ms]
11. Stage light: receives its DMX channel values, changes color
```

End-to-end latency from slider drag to light changing: **under 50ms**.
