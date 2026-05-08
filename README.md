# Lighting Controller

A DAW-independent live stage lighting control application for Windows and macOS.  
Controls up to 32 RGB DMX fixtures via USB serial through an Arduino Mega.



### [Visit Our Notion Page!](https://jaehyeon-bae.notion.site/Lights-Stage-Lighting-Controller-3593bacdd9ea809b8948fb5bafb7c3d4)
---



## Download

> **Latest release: v1.0.1**

| Platform | File | 
|---|---|
| macOS (Apple Silicon) | [Lighting Controller-1.0.1-arm64.dmg](https://github.com/JAEHYEON-BAE/Lights/releases/download/v1.0.1/Lighting.Controller-1.0.1-arm64.dmg) |
| Windows | [Lighting Controller Setup 1.0.1.exe](https://github.com/JAEHYEON-BAE/Lights/releases/download/v1.0.1/Lighting.Controller.Setup.1.0.1.exe) |

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
| Conceptinetics DMX Shield | Mounted on the Arduino |
| RGB DMX Fixtures | Up to 32, any 3ch / 7ch / 4ch RGB PAR type |

> **No hardware?** Use **Simulate mode** (Settings → Start Simulate) to run the full app without any physical devices.

### Arduino Setup
1. Install the `Conceptinetics` library from the Arduino Library Manager.
2. Flash `arduino/lighting_controller.ino` onto your Arduino Mega 2560.
3. Connect the Arduino to your PC via USB.

---

## Features

### Live Control
- Per-fixture RGB color picker with individual dimmer control
- Group control — change all fixtures in a group at once
- Master dimmer slider
- **Instant blackout** toggle

### Scenes
- Save the current lighting state as a named scene
- Recall scenes instantly or with a smooth **fade transition**
- Per-fixture effect assignments saved with the scene

### Cue List
- Build a sequential show cue list from saved scenes
- Per-cue configurable fade time
- Navigate cues with keyboard shortcuts during performance

### Effect Engine
- Apply real-time effects to individual fixtures or groups:
  - **Chase** — sequential color sweep across fixtures
  - **Sine Pulse** — smooth brightness pulsing
  - **Color Wave** — rolling hue wave
  - **Strobe** — configurable strobe flash
  - **Random Flicker** — organic flicker simulation

### Fixture Editor
- Add, edit, and delete fixtures and groups directly in the app
- Supports RGB PAR 3ch, 4ch, 7ch, and RGBA 8ch presets
- DMX channel overlap detection
- Changes are saved to disk immediately

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Toggle blackout |
| `Enter` | Next cue |
| `Backspace` | Previous cue |

Shortcuts are suppressed when a text input is focused.

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
