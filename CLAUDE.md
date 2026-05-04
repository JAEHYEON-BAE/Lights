# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A DAW-independent live stage lighting control system. The PC app (Electron + React) sends RGB commands over USB serial to an Arduino Mega, which writes DMX512 to up to 32 RGB fixtures. All logic lives on the PC side; the Arduino is a dumb packet-to-DMX translator.

## Commands

All commands run from `lighting-controller/`:

```bash
npm run dev       # Start Electron app in dev mode (hot-reload via electron-vite)
npm run build     # Build renderer + main bundles to out/
npm run package   # Build + package into release/ as .dmg (macOS) or .nsis (Windows)
```

There are no tests.

## Architecture

### Process Boundary (Electron IPC)

The app is split across two Electron processes. All serial I/O and file I/O live in the **main process**; the React UI lives in the **renderer process**. They communicate exclusively via `ipcMain.handle` / `ipcRenderer.invoke` calls, exposed through `src/preload/index.js` as `window.api`.

- `src/main/index.js` — registers all IPC handlers (`serial:*`, `file:*`) and wires serial bridge events to `win.webContents.send`
- `src/main/serial-bridge.js` — `SerialBridge` (EventEmitter): manages the serial port, runs a 44 Hz dirty-flag frame loop, handles simulate mode
- `src/preload/index.js` — exposes `window.api` to the renderer via `contextBridge`

### Renderer State (`src/renderer/src/store.js`)

Single Zustand store manages all UI and domain state. `setFixtureColor` is the central write path: it updates React state **and** calls `window.api.setFixture(id, r*dimmer, g*dimmer, b*dimmer)` in one step. Master dimmer is applied here, not in the serial bridge.

### Engines (renderer-side)

- `FadeEngine` (`engines/fade-engine.js`) — runs a `setInterval` at 16ms; uses cubic ease-in-out to interpolate fixture colors over time. Stored in Zustand (`fadeEngine` ref) and used by `recallScene` when `fade_in_ms > 0`.
- `EffectEngine` (`engines/effect-engine.js`) — runs a `setInterval` at 16ms; calls a stateless `tick(fixtures, time, params)` function per effect. Available effects: `chase`, `sinePulse`, `colorWave`, `strobe`, `randomFlicker`.

Both engines are instantiated in `App.jsx` on mount and destroyed on unmount.

### Serial Protocol

5-byte packets: `[0xFF][fixture_id][R][G][B]`. Special IDs: `0xFE` = blackout all, `0xFD` = reset DMX master. Arduino sends an 8-byte heartbeat back every 1000ms (`[0xAA][0x01][dmx_running][pkt_count][err_count][0][0][0]`). The bridge emits `heartbeat-timeout` if no heartbeat arrives for 3 seconds on a real (non-simulate) port.

### Data Files (`resources/`)

- `fixtures.json` — fixture definitions: `id`, `name`, `dmx_base`, `group`. Must stay in sync with `fixtureMap[]` in `arduino/lighting_controller.ino`.
- `scenes/scene_<id>.json` — one file per scene, keyed by `scene_id` (timestamp-based).
- `cue-list.json` — ordered array of cues referencing scene IDs.

In dev, `resourcesDir` resolves to `lighting-controller/resources/`. In packaged builds it resolves to `process.resourcesPath/resources`.

### Global Keyboard Shortcuts

Registered in `App.jsx`: `Space` = toggle blackout, `Enter` = next cue, `Backspace` = previous cue. These are suppressed when focus is on an `<input>` or `<textarea>`.

## Arduino Firmware

`arduino/lighting_controller.ino` targets Arduino Mega 2560 + Conceptinetics DMX Shield. Requires the `Conceptinetics` library from Arduino Library Manager. The `fixtureMap[]` array must match `resources/fixtures.json` — fixture IDs map to DMX base channels. Use `Serial0` (USB) for PC comms at 115200 baud; the Conceptinetics library handles DMX output via timer interrupts.

## macOS Serial Port Note

On macOS, use `/dev/cu.*` paths (not `/dev/tty.*`) when connecting — `tty` devices block on open until a carrier is detected.
