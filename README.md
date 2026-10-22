# Lighting Controller

A DAW-independent live stage lighting control application for Windows and macOS.  
Controls up to 32 RGB DMX fixtures via USB serial through an Arduino Mega.



### [Visit Our Notion Page!](https://jaehyeon-bae.notion.site/Lights-Stage-Lighting-Controller-3593bacdd9ea809b8948fb5bafb7c3d4)
---



## Download

> **Latest release: v1.1.0**

| Platform | File | 
|---|---|
| macOS (Apple Silicon) | [Lighting Controller-1.1.0-arm64.dmg](https://github.com/JAEHYEON-BAE/Lights/releases/download/v1.1.0/Lighting.Controller-1.1.0-arm64.dmg) |
| Windows | [Lighting Controller Setup 1.1.0.exe](https://github.com/JAEHYEON-BAE/Lights/releases/download/v1.1.0/Lighting.Controller.Setup.1.1.0.exe) |

Or browse all releases: [Releases page](https://github.com/JAEHYEON-BAE/Lights/releases)

---

## Installation

### macOS
1. Download the `.dmg` file above.
2. Open the `.dmg` and drag **Lighting Controller** to your Applications folder.
3. On first launch, macOS may block the app because it is not signed with an Apple Developer certificate. Follow the steps below based on the error message you see:

**"Unidentified developer" warning:**  
Right-click the app → **Open** → **Open** again to confirm.

**"Damaged and can't be opened" error (macOS Ventura / Sonoma):**  
Run the following command in Terminal, then try launching the app again:
```bash
xattr -cr /Applications/Lighting\ Controller.app
```

### Windows
1. Download the `.exe` installer above.
2. Run the installer. If Windows SmartScreen shows a warning:  
   Click **More info** → **Run anyway**.
3. Launch **Lighting Controller** from the Start menu.

---

## Hardware Requirements

| Component | Details |
|---|---|
| Arduino Mega 2560 | USB connection to PC |
| MAX485 (RS-485) module | Wired to the Arduino — see the pin table below |
| RGB DMX Fixtures | Up to 32, RGB PAR 3ch / 4ch / 7ch or RGBA 8ch |

**MAX485 wiring (Mega 2560):**

| MAX485 | Arduino Mega |
|---|---|
| DI | pin 18 (TX1) |
| DE + RE | pin 2 (direction control) |
| RO | pin 19 (RX1, unused) |
| A / B | DMX+ / DMX− |

> **No hardware?** Use **Simulate mode** (Settings → Start Simulate) to run the full app without any physical devices.

### Arduino Setup
1. Flash `arduino/lighting_controller/lighting_controller.ino` onto your Arduino Mega 2560.
   No external library is required — the firmware drives USART1 directly, which is
   exactly why it does *not* use the Conceptinetics DMX library (both claim the same
   interrupt vector as `HardwareSerial` and will not link together).
2. Connect the Arduino to your PC via USB.

---

## Features

### Live Control
- Per-fixture RGB color picker with individual dimmer control
- Group control — change all fixtures in a group at once
- Master dimmer slider
- Per-fixture **ON/OFF** toggle — a disabled fixture stays dark even while an effect runs

### Scenes
- Save the current lighting state as a named scene
- Recall scenes instantly or with a smooth **fade transition**
- Per-fixture effect assignments saved with the scene

### Cue List
- Build a sequential show cue list from saved scenes
- Per-cue configurable fade time
- Navigate cues with keyboard shortcuts during performance

### Show (BPM Sync)
- Build a setlist of songs, each with its own BPM and time signature
- Split a song into segments that hold a scene for a set number of bars
- Lighting advances automatically on the beat — no GO button during a song
- **Breakpoints** pause the run for intermissions until the operator resumes
- Optional **metronome** click on a selectable audio output device

### Effect Engine
- Apply real-time effects per fixture, with a cross-fade when effects change:
  - **Color** — static solid color
  - **Color Chase** — sequential color sweep across fixtures
  - **Sine Pulse** — smooth brightness pulsing
  - **Color Wave** — rolling hue wave between two hues
  - **Color Step** — steps through a list of hues
  - **Strobe** — configurable strobe flash
  - **Random Flicker** — organic flicker simulation

### Fixture Editor
- Add, edit, and delete fixtures and groups directly in the app
- Supports RGB PAR 3ch, 4ch, 7ch, and RGBA 8ch presets
- DMX channel overlap detection
- Changes are saved to disk immediately

---

## Keyboard Shortcuts

| Screen | Key | Action |
|---|---|---|
| Live, Cue List | `Enter` | Next cue |
| Live, Cue List | `Backspace` | Previous cue |
| Show | `Enter` / `→` | Resume from a breakpoint, or skip forward one segment |
| Show | `Backspace` / `←` | Skip back one segment |

Shortcuts are suppressed when a text input, select, or button is focused.

---

## Serial Connection

On macOS, use `/dev/cu.*` ports (not `/dev/tty.*`) when connecting in the Settings screen.

---

## Development

```bash
cd lighting-controller
npm install
npm run dev        # Start in dev mode (hot-reload)
npm run build      # Build renderer + main bundles
npm run package    # Build + package into release/
```

New developers cloning the repo will have no `resources/` folder.  
The app falls back to `resources-default/` on first dev run, giving a clean starting state.  
Your local show data lives in `lighting-controller/resources/` and is gitignored.
