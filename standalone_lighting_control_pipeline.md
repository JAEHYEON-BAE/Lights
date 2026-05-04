# Standalone Live Performance Lighting Control Pipeline
## PC → Arduino → DMX → Fixtures (DAW-Independent)

> **Version:** 1.0  
> **Target Environment:** Live performance, stage, or installation  
> **Author:** Design Reference Document  
> **Last Updated:** 2026-05-04

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Hardware Architecture](#2-hardware-architecture)
3. [Communication Protocol Design](#3-communication-protocol-design)
4. [Arduino Firmware](#4-arduino-firmware)
5. [PC-Side Software Architecture](#5-pc-side-software-architecture)
6. [Serial Bridge Layer](#6-serial-bridge-layer)
7. [GUI Control Application](#7-gui-control-application)
8. [Fixture & Scene Management](#8-fixture--scene-management)
9. [Real-Time Performance Considerations](#9-real-time-performance-considerations)
10. [Error Handling & Fault Tolerance](#10-error-handling--fault-tolerance)
11. [Development Roadmap](#11-development-roadmap)
12. [Dependency Summary](#12-dependency-summary)

---

## 1. System Overview

### 1.1 Design Philosophy

This pipeline is designed as a **fully DAW-independent**, modular lighting control system for live performance contexts. The architecture follows a strict separation of concerns:

- **Arduino** is a dumb terminal. It receives a minimal, well-defined serial packet and writes DMX values accordingly. It has zero knowledge of scenes, effects, or timing.
- **PC software** owns all logic: scene management, effects, timing, user interaction, and state persistence.
- **The serial link** is a stateless command channel. Any lost packet is simply overwritten by the next frame.

This separation ensures that the Arduino firmware remains stable and rarely requires updates, while all creative and operational changes happen on the PC side.

### 1.2 Full Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PC APPLICATION                              │
│                                                                     │
│  ┌──────────────┐   ┌─────────────────┐   ┌─────────────────────┐  │
│  │  GUI Layer   │   │  Scene / FX      │   │   Fixture Database  │  │
│  │  (Electron / │──▶│  Engine          │──▶│   (JSON config)     │  │
│  │   PyQt6)     │   │                 │   │                     │  │
│  └──────────────┘   └────────┬────────┘   └─────────────────────┘  │
│                              │                                      │
│                    ┌─────────▼────────┐                             │
│                    │  Serial Bridge   │                             │
│                    │  (Node.js /      │                             │
│                    │   Python)        │                             │
│                    └─────────┬────────┘                             │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ USB Serial (115200 baud)
                    ┌──────────▼──────────┐
                    │     Arduino Uno /   │
                    │     Mega / ESP32    │
                    │                    │
                    │  [Serial RX]        │
                    │       ↓             │
                    │  [Packet Parser]    │
                    │       ↓             │
                    │  [DMX Write]        │
                    └──────────┬──────────┘
                               │ DMX512 (RS-485, 3-pin or 5-pin XLR)
                    ┌──────────▼──────────┐
                    │   DMX Shield /      │
                    │   RS-485 Module     │
                    │  (MAX485 / SN75176) │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────▼──────┐    ┌────────▼──────┐    ┌───────▼──────┐
   │  Fixture 0  │    │  Fixture 1    │    │  Fixture N   │
   │  (RGB PAR)  │    │  (Moving Head)│    │  (LED Strip) │
   └─────────────┘    └───────────────┘    └──────────────┘
```

### 1.3 Technology Stack Summary

| Layer | Technology | Rationale |
|---|---|---|
| GUI | Electron + React, or PyQt6 | Cross-platform, rich UI, active ecosystem |
| Serial Bridge | Node.js (`serialport`) or Python (`pyserial`) | Low-latency, event-driven I/O |
| Firmware | Arduino C++ (Uno/Mega) or ESP32 Arduino | Stable, widely documented |
| DMX Driver | `Conceptinetics` library (preferred) | Interrupt-driven, reliable timing |
| Fixture Config | JSON files | Human-readable, version-controllable |
| Scene Storage | JSON files | Portable, easily backed up |

---

## 2. Hardware Architecture

### 2.1 Arduino Platform Selection

| Platform | Pros | Cons | Recommendation |
|---|---|---|---|
| Arduino Uno | Cheap, widely available, simple | Only 1 hardware UART (shared with USB), limited RAM | Acceptable for small rigs (<16 fixtures) |
| Arduino Mega 2560 | Multiple hardware UARTs, more RAM/Flash | Larger, slightly more expensive | **Recommended for most use cases** |
| ESP32 | Fast CPU, WiFi/BT, native UART | More complex toolchain, 3.3V logic | Best for wireless or advanced builds |

> **Recommendation:** Use an **Arduino Mega 2560** for wired USB builds. Use **Serial1** (pins 18/19) for DMX output, keeping **Serial0** (USB) exclusively for PC communication, which avoids any UART contention.

### 2.2 DMX Hardware Module

The Arduino outputs UART TTL signals; DMX512 requires RS-485 differential signaling. A dedicated module is mandatory.

**Option A — CTC-DRA-10-R Shield (Conceptinetics)**
- Plug-and-play shield for Arduino Uno/Mega
- Supports both DMX Master and Slave modes
- Directly compatible with the `Conceptinetics` Arduino library
- XLR 5-pin connector (adaptable to 3-pin)

**Option B — DIY MAX485 Module**
- Uses a MAX485 or SN75176 RS-485 transceiver IC
- Wired to a hardware UART pin + a direction control pin (DE/RE)
- More flexible for custom PCB integration
- Compatible with `DMXSerial` or custom UART ISR

**Wiring Diagram (Mega + MAX485):**

```
Arduino Mega          MAX485 Module         XLR 5-pin
─────────────         ──────────────        ────────────
TX1 (pin 18) ───────▶ DI                    
pin 2 (DIR)  ───────▶ DE                    
pin 2 (DIR)  ───────▶ RE (inverted, tie)    
5V           ───────▶ VCC                   
GND          ───────▶ GND                   
                       A  ─────────────────▶ Pin 3 (+)
                       B  ─────────────────▶ Pin 2 (-)
                      GND ─────────────────▶ Pin 1 (GND/Shield)
```

> Pin 4 and 5 on XLR 5-pin are typically unused in 3-channel RGB fixtures. For 3-pin XLR adapters, connect pins 1→1, 2→2, 3→3.

### 2.3 DMX Channel Mapping Strategy

DMX512 provides 512 channels, each carrying a value of 0–255. Fixtures occupy a contiguous block of channels starting at their **base address** (set via DIP switches on the fixture).

**Standard RGB Fixture (3 channels):**

| Channel Offset | Function |
|---|---|
| +0 | Red (0–255) |
| +1 | Green (0–255) |
| +2 | Blue (0–255) |

**Extended RGBW Fixture (4 channels):**

| Channel Offset | Function |
|---|---|
| +0 | Red |
| +1 | Green |
| +2 | Blue |
| +3 | White |

**Moving Head Fixture (example, 8 channels):**

| Channel Offset | Function |
|---|---|
| +0 | Pan (0–255) |
| +1 | Tilt (0–255) |
| +2 | Red |
| +3 | Green |
| +4 | Blue |
| +5 | Dimmer |
| +6 | Strobe |
| +7 | Mode |

The base address for each fixture is stored in the PC-side fixture database JSON file (see Section 5.3). Arduino only receives `(fixture_id, r, g, b)` tuples and looks up the DMX base address from a local fixture map loaded at boot time.

---

## 3. Communication Protocol Design

### 3.1 Protocol Goals

- **Robustness:** Must tolerate occasional byte loss or corruption without causing permanent desync.
- **Simplicity:** The Arduino parser must be minimal and reliable.
- **Throughput:** Must sustain at least 40 update packets/second across 32 fixtures simultaneously.

### 3.2 Packet Format

All communication is **PC → Arduino** only (unidirectional by default). Each packet is exactly **5 bytes**:

```
Byte 0:  0xFF        — Start byte / sync marker
Byte 1:  fixture_id  — Fixture logical ID (0–127)
Byte 2:  R           — Red channel value (0–255)
Byte 3:  G           — Green channel value (0–255)
Byte 4:  B           — Blue channel value (0–255)
```

**Why `0xFF` as a start byte?**  
- `0xFF` cannot appear in `fixture_id` (valid range: 0–127, MSB always 0).
- `0xFF` can theoretically appear in R, G, B values (maximum brightness). The parser must therefore treat `0xFF` as a start marker **only** when it appears in the expected position within the state machine.
- If synchronization is lost, the parser discards bytes until it sees `0xFF`, then re-synchronizes.

### 3.3 Special Command Packets

To support special operations (e.g., blackout, reset), two reserved `fixture_id` values are defined:

| fixture_id | Meaning | R/G/B payload |
|---|---|---|
| `0xFE` (254) | **BLACKOUT ALL** — set all channels to 0 immediately | Ignored |
| `0xFD` (253) | **RESET** — reinitialize DMX master | Ignored |

> These special IDs must be excluded from the valid fixture ID range in the PC-side configuration.

### 3.4 Baud Rate Selection

Use **115200 baud** as the standard.

**Throughput calculation:**

- At 115200 baud with 10 bits/byte (1 start + 8 data + 1 stop): **11,520 bytes/second**
- Each packet = 5 bytes → maximum **2,304 packets/second**
- For 32 fixtures at 44 FPS: 32 × 44 = 1,408 packets/second — well within budget.

### 3.5 Optional: Bidirectional Status Channel

For production-grade deployments, a simple **acknowledgement / status** channel can be added:

```
Arduino → PC (8 bytes, periodic heartbeat every 1000ms):
Byte 0:  0xAA           — Heartbeat start byte
Byte 1:  0x01           — Message type: STATUS
Byte 2:  dmx_running    — 1 if DMX master active, 0 if fault
Byte 3:  packet_count   — Low byte of packets received since last heartbeat
Byte 4:  error_count    — Number of parser errors since last heartbeat
Bytes 5–7: 0x00         — Reserved
```

This allows the PC GUI to display a live connection indicator and detect serial link failures.

---

## 4. Arduino Firmware

### 4.1 Firmware Architecture

```
setup()
 ├─ Serial.begin(115200)          // USB serial (PC communication)
 ├─ Serial1.begin(250000)         // DMX UART (250kbps is DMX standard)
 ├─ dmx_master.enable()           // Start DMX transmission
 ├─ loadFixtureMap()              // Load fixture_id → DMX base address table
 └─ blackoutAll()                 // Initialize all channels to 0

loop()
 └─ parseSerial()
      ├─ [state: WAIT_START]  → wait for 0xFF
      ├─ [state: READ_ID]     → read fixture_id
      ├─ [state: READ_R]      → read R
      ├─ [state: READ_G]      → read G
      └─ [state: READ_B]      → read B, dispatch setFixture()
```

### 4.2 Complete Firmware Code

```cpp
/*
 * lighting_controller.ino
 * Arduino Mega 2560 + Conceptinetics DMX Shield
 *
 * Packet format: [0xFF][fixture_id][R][G][B]
 * Special IDs:   0xFE = BLACKOUT ALL, 0xFD = RESET
 *
 * DMX library: Conceptinetics (install via Arduino Library Manager)
 * https://github.com/sakadream/Arduino-DMX-lib
 */

#include <Conceptinetics.h>

// ─── Configuration ────────────────────────────────────────────────────────────

#define SERIAL_BAUD         115200
#define DMX_CHANNELS        512
#define DMX_MASTER_PIN      2        // Direction control pin for RS-485
#define MAX_FIXTURES        32       // Maximum number of addressable fixtures
#define CHANNELS_PER_FIX    3        // RGB = 3 channels per fixture

// ─── Packet Parser State Machine ─────────────────────────────────────────────

typedef enum {
  STATE_WAIT_START = 0,
  STATE_READ_ID,
  STATE_READ_R,
  STATE_READ_G,
  STATE_READ_B
} ParserState;

// ─── Fixture Map ──────────────────────────────────────────────────────────────
// Maps logical fixture ID (0–31) to DMX base channel (1–510)
// Must match the fixture configuration in the PC-side JSON database.
// Edit this table to match your physical rig.

uint16_t fixtureMap[MAX_FIXTURES] = {
  1,   // Fixture 0 → DMX channels 1,2,3
  4,   // Fixture 1 → DMX channels 4,5,6
  7,   // Fixture 2 → DMX channels 7,8,9
  10,  // Fixture 3 → DMX channels 10,11,12
  // ... extend as needed, max 32 entries
  // Unused entries: 0 (disabled)
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};

// ─── Global State ─────────────────────────────────────────────────────────────

DMX_Master dmx_master(DMX_CHANNELS, DMX_MASTER_PIN);

ParserState parserState = STATE_WAIT_START;
uint8_t     pkt_id      = 0;
uint8_t     pkt_r       = 0;
uint8_t     pkt_g       = 0;

uint32_t    packetCount = 0;
uint32_t    errorCount  = 0;
uint32_t    lastHeartbeat = 0;

// ─── Utility Functions ────────────────────────────────────────────────────────

void blackoutAll() {
  for (int ch = 1; ch <= DMX_CHANNELS; ch++) {
    dmx_master.setChannelValue(ch, 0);
  }
}

void setFixture(uint8_t id, uint8_t r, uint8_t g, uint8_t b) {
  if (id >= MAX_FIXTURES) return;
  uint16_t base = fixtureMap[id];
  if (base == 0) return;  // Fixture not configured
  if (base + 2 > DMX_CHANNELS) return;  // Out of DMX range

  dmx_master.setChannelValue(base,     r);
  dmx_master.setChannelValue(base + 1, g);
  dmx_master.setChannelValue(base + 2, b);
}

void sendHeartbeat() {
  // Optional: sends status back to PC
  uint8_t hb[8] = {
    0xAA, 0x01,
    0x01,                          // DMX running
    (uint8_t)(packetCount & 0xFF), // Packet count (low byte)
    (uint8_t)(errorCount & 0xFF),  // Error count
    0x00, 0x00, 0x00
  };
  Serial.write(hb, 8);
  packetCount = 0;
  errorCount  = 0;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

void parseSerial() {
  while (Serial.available() > 0) {
    uint8_t byte = (uint8_t)Serial.read();

    switch (parserState) {

      case STATE_WAIT_START:
        if (byte == 0xFF) {
          parserState = STATE_READ_ID;
        }
        // Discard all other bytes silently
        break;

      case STATE_READ_ID:
        if (byte == 0xFF) {
          // Another start byte: resync (previous packet was incomplete)
          errorCount++;
          parserState = STATE_READ_ID;
        } else if (byte == 0xFE) {
          // Special: BLACKOUT ALL
          blackoutAll();
          parserState = STATE_WAIT_START;
          packetCount++;
        } else if (byte == 0xFD) {
          // Special: RESET
          dmx_master.disable();
          delay(10);
          dmx_master.enable();
          parserState = STATE_WAIT_START;
        } else {
          pkt_id = byte;
          parserState = STATE_READ_R;
        }
        break;

      case STATE_READ_R:
        if (byte == 0xFF) {
          errorCount++;
          parserState = STATE_READ_ID;
        } else {
          pkt_r = byte;
          parserState = STATE_READ_G;
        }
        break;

      case STATE_READ_G:
        if (byte == 0xFF) {
          errorCount++;
          parserState = STATE_READ_ID;
        } else {
          pkt_g = byte;
          parserState = STATE_READ_B;
        }
        break;

      case STATE_READ_B:
        if (byte == 0xFF) {
          errorCount++;
          parserState = STATE_READ_ID;
        } else {
          setFixture(pkt_id, pkt_r, pkt_g, byte);
          packetCount++;
          parserState = STATE_WAIT_START;
        }
        break;
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(SERIAL_BAUD);   // USB → PC
  dmx_master.enable();
  blackoutAll();
}

void loop() {
  parseSerial();

  // Send heartbeat every 1000ms (optional)
  uint32_t now = millis();
  if (now - lastHeartbeat >= 1000) {
    sendHeartbeat();
    lastHeartbeat = now;
  }
}
```

### 4.3 DMX Library: `Conceptinetics` vs Alternatives

| Library | Interrupt-driven | Mega Support | Notes |
|---|---|---|---|
| **Conceptinetics** | ✅ Yes | ✅ Yes | Most reliable for production use |
| DmxSimple | ❌ No (bit-bang) | Partial | Prone to interrupt conflicts |
| DMXSerial | ✅ Yes | ✅ Yes | Good alternative, simpler API |
| ArduinoDMX (UART) | ✅ Yes | ✅ Yes | Native UART, very clean |

> **Install:** Arduino IDE → Library Manager → search `Conceptinetics`

---

## 5. PC-Side Software Architecture

### 5.1 Application Architecture Overview

The PC application is structured as a layered system:

```
┌───────────────────────────────────────────────────┐
│                   GUI Layer                       │
│  • Fixture view (color pickers per fixture)       │
│  • Scene browser (list/grid of saved scenes)      │
│  • Cue list (ordered sequence of scenes)          │
│  • Effect panel (built-in effect generators)      │
│  • Master dimmer slider                           │
│  • Blackout button (keyboard shortcut: SPACE)     │
└───────────────────────────┬───────────────────────┘
                            │ calls
┌───────────────────────────▼───────────────────────┐
│               Application Core                    │
│  • FixtureEngine   — current DMX state per fx     │
│  • SceneManager    — load/save/recall scenes      │
│  • CueListEngine   — sequential scene playback    │
│  • EffectEngine    — generates time-varying vals  │
│  • MasterDimmer    — global multiply factor       │
└───────────────────────────┬───────────────────────┘
                            │ emits
┌───────────────────────────▼───────────────────────┐
│               Serial Bridge                       │
│  • Maintains serial port connection               │
│  • Buffers output at fixed frame rate (44 Hz)     │
│  • Sends only dirty (changed) channels            │
└───────────────────────────────────────────────────┘
```

### 5.2 Recommended Technology: Electron + React

**Why Electron?**
- Single codebase for macOS, Windows, Linux
- Node.js backend has excellent `serialport` library with native USB serial support
- React frontend enables reactive, component-based UI
- No browser networking restrictions (unlike a pure web app)

**Alternatives:**

| Stack | Pros | Cons |
|---|---|---|
| **Electron + React** | Cross-platform, rich UI ecosystem | ~150MB binary, higher RAM usage |
| **PyQt6 + Python** | Lightweight, easy serial integration | UI development slower, less polished |
| **Tauri + React** | Smaller binary than Electron | Rust backend, steeper learning curve |
| **TouchDesigner** | Built-in serial output, no coding for basics | Commercial license for production use, proprietary |

For a purpose-built live tool with a professional UI, **Electron + React** is the recommended choice.

### 5.3 Fixture Database Schema (JSON)

```json
{
  "version": "1.0",
  "fixtures": [
    {
      "id": 0,
      "name": "Stage Left PAR 1",
      "type": "rgb_par",
      "dmx_base": 1,
      "channels": {
        "red":   0,
        "green": 1,
        "blue":  2
      },
      "group": "stage_left",
      "notes": "Chauvet SlimPAR Pro H, set to DMX address 001"
    },
    {
      "id": 1,
      "name": "Stage Right PAR 1",
      "type": "rgb_par",
      "dmx_base": 4,
      "channels": {
        "red":   0,
        "green": 1,
        "blue":  2
      },
      "group": "stage_right"
    }
  ],
  "groups": [
    { "id": "stage_left",  "name": "Stage Left",  "color": "#3B82F6" },
    { "id": "stage_right", "name": "Stage Right", "color": "#EF4444" },
    { "id": "all",         "name": "All Fixtures", "color": "#10B981" }
  ]
}
```

> This file is loaded both by the PC application and should also match the `fixtureMap` array embedded in the Arduino firmware.

### 5.4 Scene Schema (JSON)

```json
{
  "version": "1.0",
  "scene_id": "scene_001",
  "name": "Warm Red Wash",
  "description": "All stage left red, all stage right deep red",
  "fade_in_ms": 500,
  "fade_out_ms": 0,
  "fixtures": [
    { "id": 0, "r": 255, "g": 20,  "b": 0 },
    { "id": 1, "r": 180, "g": 0,   "b": 0 },
    { "id": 2, "r": 255, "g": 20,  "b": 0 }
  ]
}
```

### 5.5 Cue List Schema (JSON)

```json
{
  "version": "1.0",
  "show_name": "Concert 2026-05-04",
  "cues": [
    {
      "cue_number": 1,
      "name": "House to Black",
      "scene_id": "scene_blackout",
      "trigger": "manual",
      "fade_in_ms": 2000
    },
    {
      "cue_number": 2,
      "name": "Intro Wash",
      "scene_id": "scene_001",
      "trigger": "manual",
      "fade_in_ms": 500
    },
    {
      "cue_number": 3,
      "name": "Verse 1",
      "scene_id": "scene_002",
      "trigger": "manual",
      "fade_in_ms": 0
    }
  ]
}
```

---

## 6. Serial Bridge Layer

### 6.1 Responsibilities

The Serial Bridge layer runs as a background service within the PC application (as an Electron main-process module or a standalone Python daemon). Its responsibilities are:

1. **Port discovery** — enumerate available serial ports and identify the Arduino
2. **Connection management** — open, monitor, reconnect on disconnect
3. **Frame-rate-limited output** — maintain a fixed output rate (recommended: 44 Hz)
4. **Dirty-channel tracking** — only send packets for fixtures whose values have changed
5. **Priority queue** — urgent commands (BLACKOUT) jump the queue
6. **Heartbeat monitoring** — detect Arduino disconnects via heartbeat timeout

### 6.2 Node.js Implementation

```javascript
// serial-bridge.js
// Runs in Electron main process or as a standalone Node.js service

const { SerialPort } = require('serialport');
const EventEmitter   = require('events');

const START_BYTE      = 0xFF;
const CMD_BLACKOUT    = 0xFE;
const CMD_RESET       = 0xFD;
const FRAME_RATE_HZ   = 44;
const FRAME_INTERVAL  = Math.floor(1000 / FRAME_RATE_HZ); // ~22ms
const MAX_FIXTURES    = 32;

class SerialBridge extends EventEmitter {
  constructor() {
    super();

    // Current DMX state: Array of {r, g, b} objects
    this.currentState = Array.from({ length: MAX_FIXTURES }, () => ({
      r: 0, g: 0, b: 0
    }));
    this.pendingState = Array.from({ length: MAX_FIXTURES }, () => ({
      r: 0, g: 0, b: 0
    }));
    this.dirtyFlags   = new Array(MAX_FIXTURES).fill(false);

    this.port         = null;
    this.frameTimer   = null;
    this.blackout     = false;
    this.connected    = false;
  }

  // ── Port Management ──────────────────────────────────────────────────────

  async listPorts() {
    const ports = await SerialPort.list();
    // Filter to likely Arduino ports
    return ports.filter(p =>
      p.manufacturer?.toLowerCase().includes('arduino') ||
      p.vendorId === '2341' ||  // Arduino Uno/Mega VID
      p.path.includes('usbmodem') ||
      p.path.includes('ttyUSB') ||
      p.path.includes('ttyACM')
    );
  }

  async connect(portPath) {
    if (this.port && this.port.isOpen) {
      await this.disconnect();
    }

    this.port = new SerialPort({
      path: portPath,
      baudRate: 115200,
      autoOpen: false
    });

    return new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) {
          reject(err);
          return;
        }

        this.connected = true;
        this.emit('connected', portPath);
        this._startFrameLoop();

        // Handle incoming data (heartbeat responses)
        this.port.on('data', (data) => this._handleIncoming(data));

        // Handle disconnect
        this.port.on('close', () => {
          this.connected = false;
          this._stopFrameLoop();
          this.emit('disconnected');
        });

        this.port.on('error', (err) => {
          this.emit('error', err);
        });

        resolve();
      });
    });
  }

  async disconnect() {
    this._stopFrameLoop();
    if (this.port && this.port.isOpen) {
      await new Promise((resolve) => this.port.close(resolve));
    }
    this.connected = false;
  }

  // ── State Updates ─────────────────────────────────────────────────────────

  setFixture(id, r, g, b) {
    if (id < 0 || id >= MAX_FIXTURES) return;

    const clamped_r = Math.max(0, Math.min(255, Math.round(r)));
    const clamped_g = Math.max(0, Math.min(255, Math.round(g)));
    const clamped_b = Math.max(0, Math.min(255, Math.round(b)));

    const pending = this.pendingState[id];

    if (pending.r !== clamped_r || pending.g !== clamped_g || pending.b !== clamped_b) {
      pending.r = clamped_r;
      pending.g = clamped_g;
      pending.b = clamped_b;
      this.dirtyFlags[id] = true;
    }
  }

  setAll(r, g, b) {
    for (let id = 0; id < MAX_FIXTURES; id++) {
      this.setFixture(id, r, g, b);
    }
  }

  setBlackout(active) {
    this.blackout = active;
    if (active && this.connected) {
      // Send immediate BLACKOUT command
      const packet = Buffer.from([START_BYTE, CMD_BLACKOUT, 0, 0, 0]);
      this.port.write(packet);
    }
    this.emit('blackout', active);
  }

  // ── Frame Loop ────────────────────────────────────────────────────────────

  _startFrameLoop() {
    this._stopFrameLoop();
    this.frameTimer = setInterval(() => this._sendFrame(), FRAME_INTERVAL);
  }

  _stopFrameLoop() {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  _sendFrame() {
    if (!this.connected || !this.port.isOpen || this.blackout) return;

    const packets = [];

    for (let id = 0; id < MAX_FIXTURES; id++) {
      if (!this.dirtyFlags[id]) continue;

      const { r, g, b } = this.pendingState[id];
      packets.push(START_BYTE, id, r, g, b);

      // Mark as sent
      this.currentState[id] = { r, g, b };
      this.dirtyFlags[id] = false;
    }

    if (packets.length > 0) {
      this.port.write(Buffer.from(packets));
    }
  }

  // ── Incoming Data ─────────────────────────────────────────────────────────

  _handleIncoming(data) {
    // Parse Arduino heartbeat: [0xAA][0x01][dmx_running][pkt_count][err_count]...
    if (data.length >= 5 && data[0] === 0xAA && data[1] === 0x01) {
      this.emit('heartbeat', {
        dmxRunning:  data[2] === 1,
        packetCount: data[3],
        errorCount:  data[4]
      });
    }
  }
}

module.exports = SerialBridge;
```

---

## 7. GUI Control Application

### 7.1 Core Screens

The application should expose the following primary screens, accessible via a persistent sidebar or tab bar:

**① Live Control Screen**
- Grid of fixture tiles (one per fixture), each showing current color as background
- Click on tile → open color picker (HSV wheel + RGB sliders)
- Group selector: apply color to all fixtures in a group simultaneously
- Master dimmer: global brightness slider (0–100%), multiplies all output values
- Blackout button (large, red): keyboard shortcut `SPACE`
- Flash button: temporarily set all fixtures to full white while held

**② Scene Browser Screen**
- List or grid of all saved scenes
- Thumbnail preview (miniature fixture grid showing colors)
- Double-click or `GO` button to recall a scene with configured fade time
- Right-click → Edit / Duplicate / Delete
- Drag-to-reorder (also reflects order in exported cue list)

**③ Cue List Screen**
- Table of cues: Number, Name, Scene, Fade In, Trigger
- Current cue highlighted in blue
- `GO` button (or `ENTER` key) advances to next cue
- `BACK` button returns to previous cue
- Option to display cue notes/annotations (useful for following a setlist)

**④ Effect Engine Screen**
- Library of generative effects: Chase, Color Fade, Strobe, Color Wave, Sine Pulse
- Each effect has parameters (speed, color 1, color 2, direction)
- Apply effect to a group or to specific fixtures
- Effects layer on top of base scene values

**⑤ Settings Screen**
- Serial port selector (dropdown of detected Arduino ports)
- Baud rate configuration (default: 115200)
- Fixture configuration file path (load/reload)
- Frame rate (default: 44 Hz)
- Show name and file management

### 7.2 React Component Structure

```
App
├── Sidebar
│   ├── NavButton (Live)
│   ├── NavButton (Scenes)
│   ├── NavButton (Cue List)
│   ├── NavButton (Effects)
│   └── NavButton (Settings)
├── StatusBar
│   ├── ConnectionIndicator    ← green/red dot, port name
│   ├── HeartbeatDisplay       ← packet/error rate from Arduino
│   └── MasterDimmerSlider
├── BlackoutButton             ← always visible, keyboard shortcut
│
├── LiveControlScreen
│   ├── GroupSelector
│   ├── FixtureGrid
│   │   └── FixtureTile × N
│   │       └── ColorPickerModal (on click)
│   └── FlashButton
│
├── SceneBrowserScreen
│   ├── SceneSearchBar
│   └── SceneGrid
│       └── SceneCard × N
│
├── CueListScreen
│   ├── CueListTable
│   │   └── CueRow × N
│   ├── GoButton
│   └── BackButton
│
├── EffectEngineScreen
│   ├── EffectLibraryPanel
│   └── EffectParameterPanel
│
└── SettingsScreen
    ├── SerialPortSelector
    ├── FixtureFileLoader
    └── GeneralSettings
```

### 7.3 State Management (Zustand)

```javascript
// store.js — using Zustand for lightweight state management

import { create } from 'zustand';

const useLightingStore = create((set, get) => ({

  // ── Fixture State ──────────────────────────────────────────────────────────
  fixtures: [],             // Loaded from fixture JSON
  fixtureState: {},         // { [id]: { r, g, b } } — current values in UI

  setFixtureColor: (id, r, g, b) => {
    set(state => ({
      fixtureState: { ...state.fixtureState, [id]: { r, g, b } }
    }));
    // Push to serial bridge
    window.serialBridge.setFixture(id, r, g, b);
  },

  setGroupColor: (groupId, r, g, b) => {
    const { fixtures } = get();
    fixtures
      .filter(f => f.group === groupId)
      .forEach(f => get().setFixtureColor(f.id, r, g, b));
  },

  // ── Blackout ───────────────────────────────────────────────────────────────
  blackoutActive: false,

  toggleBlackout: () => {
    const next = !get().blackoutActive;
    set({ blackoutActive: next });
    window.serialBridge.setBlackout(next);
  },

  // ── Master Dimmer ──────────────────────────────────────────────────────────
  masterDimmer: 1.0,   // 0.0 – 1.0

  setMasterDimmer: (value) => {
    set({ masterDimmer: value });
    // Re-broadcast all current fixture states with new dimmer applied
    const { fixtures, fixtureState } = get();
    fixtures.forEach(f => {
      const color = fixtureState[f.id] || { r: 0, g: 0, b: 0 };
      window.serialBridge.setFixture(
        f.id,
        Math.round(color.r * value),
        Math.round(color.g * value),
        Math.round(color.b * value)
      );
    });
  },

  // ── Scene Management ───────────────────────────────────────────────────────
  scenes: [],
  activeSceneId: null,

  recallScene: (sceneId) => {
    const scene = get().scenes.find(s => s.scene_id === sceneId);
    if (!scene) return;

    const dimmer = get().masterDimmer;
    scene.fixtures.forEach(({ id, r, g, b }) => {
      get().setFixtureColor(id, r * dimmer, g * dimmer, b * dimmer);
    });
    set({ activeSceneId: sceneId });
  },

  // ── Cue List ───────────────────────────────────────────────────────────────
  cues: [],
  currentCueIndex: -1,

  goNextCue: () => {
    const { cues, currentCueIndex } = get();
    const nextIndex = Math.min(currentCueIndex + 1, cues.length - 1);
    const cue = cues[nextIndex];
    if (cue) {
      get().recallScene(cue.scene_id);
      set({ currentCueIndex: nextIndex });
    }
  },

  goPrevCue: () => {
    const { cues, currentCueIndex } = get();
    const prevIndex = Math.max(currentCueIndex - 1, 0);
    const cue = cues[prevIndex];
    if (cue) {
      get().recallScene(cue.scene_id);
      set({ currentCueIndex: prevIndex });
    }
  },

}));

export default useLightingStore;
```

---

## 8. Fixture & Scene Management

### 8.1 Fade Engine

Scene transitions should support configurable fade times. A simple linear fade implementation:

```javascript
// fade-engine.js

class FadeEngine {
  constructor(bridge) {
    this.bridge    = bridge;
    this.activeFades = new Map();  // fixtureId → fade state
    this.ticker    = null;
    this._start();
  }

  _start() {
    this.ticker = setInterval(() => this._tick(), 16); // ~60fps tick
  }

  fadeTo(fixtureId, targetR, targetG, targetB, durationMs) {
    const current = this.bridge.currentState[fixtureId] || { r: 0, g: 0, b: 0 };

    this.activeFades.set(fixtureId, {
      startR: current.r, startG: current.g, startB: current.b,
      endR: targetR,     endG: targetG,     endB: targetB,
      startTime: Date.now(),
      duration: durationMs
    });
  }

  _tick() {
    const now = Date.now();
    for (const [id, fade] of this.activeFades.entries()) {
      const elapsed  = now - fade.startTime;
      const progress = Math.min(elapsed / fade.duration, 1.0);
      const t        = easeInOut(progress);

      const r = Math.round(fade.startR + (fade.endR - fade.startR) * t);
      const g = Math.round(fade.startG + (fade.endG - fade.startG) * t);
      const b = Math.round(fade.startB + (fade.endB - fade.startB) * t);

      this.bridge.setFixture(id, r, g, b);

      if (progress >= 1.0) {
        this.activeFades.delete(id);
      }
    }
  }
}

// Ease in-out cubic
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

### 8.2 Built-in Effect Library

The Effect Engine generates time-varying RGB values at the application's tick rate and feeds them into the serial bridge like any other color update.

**Effect: Color Chase**
```javascript
// Cycles a color across fixtures in sequence
function colorChase(fixtures, time, speed, r, g, b) {
  const period = 1000 / speed;
  const activeIndex = Math.floor((time / period) % fixtures.length);
  fixtures.forEach((id, idx) => {
    if (idx === activeIndex) return { id, r, g, b };
    return { id, r: 0, g: 0, b: 0 };
  });
}
```

**Effect: Sine Pulse**
```javascript
// Pulses brightness in and out using a sine wave
function sinePulse(fixtures, time, speed, r, g, b) {
  const frequency = speed / 1000;
  const brightness = (Math.sin(2 * Math.PI * frequency * time) + 1) / 2;
  return fixtures.map(id => ({
    id,
    r: Math.round(r * brightness),
    g: Math.round(g * brightness),
    b: Math.round(b * brightness)
  }));
}
```

**Effect: Color Wave**
```javascript
// Propagates a hue wave across fixtures
function colorWave(fixtures, time, speed, phase_offset_deg) {
  const frequency = speed / 1000;
  return fixtures.map((id, idx) => {
    const hue = ((frequency * time * 360 + idx * phase_offset_deg) % 360 + 360) % 360;
    return { id, ...hsvToRgb(hue, 1.0, 1.0) };
  });
}
```

---

## 9. Real-Time Performance Considerations

### 9.1 Frame Rate and Latency Budget

| Stage | Budget |
|---|---|
| GUI → Application Core (React state update) | < 2 ms |
| Application Core → Serial Bridge (dirty flag set) | < 1 ms |
| Serial Bridge frame timer jitter | ±2 ms |
| USB Serial transmission (5 bytes @ 115200 baud) | ~0.43 ms |
| Arduino parser + DMX write | < 1 ms |
| DMX frame period (44 Hz refresh) | ~22.7 ms |
| **Total end-to-end latency** | **< 30 ms** |

30 ms latency is imperceptible in a live performance context. Human perception of lighting change begins around 100 ms.

### 9.2 Preventing Frame Rate Jitter in Node.js

Node.js `setInterval` can experience jitter under CPU load. Mitigation strategies:

- Use `setImmediate` inside the interval callback for back-to-back flush cycles.
- Avoid blocking operations on the main thread; use Worker threads for heavy computation (e.g., complex effect generation).
- In Electron, consider running the serial bridge in the main process (not the renderer process) to isolate it from UI rendering load.

### 9.3 USB Serial Reliability

- On macOS, use `/dev/cu.*` paths (not `/dev/tty.*`) for outgoing connections; `tty` blocks on open until a connection is made.
- On Windows, ensure the `CH340` or `FTDI` driver is installed for non-genuine Arduino boards.
- Set a `writeTimeout` on the serialport instance to prevent blocking on a stalled connection.

### 9.4 Avoiding DMX Timing Issues on Arduino

- Do **not** use `delay()` anywhere in the Arduino loop. It blocks the parser.
- If using Conceptinetics, DMX transmission is handled by timer interrupts and does not interfere with `loop()`.
- Serial input buffer on Arduino Mega is 64 bytes by default. At 44 Hz × 32 fixtures × 5 bytes = 7,040 bytes/second, this buffer can fill in under 10 ms. The `parseSerial()` function must drain the buffer on every `loop()` iteration, which it does with the `while (Serial.available() > 0)` loop.

---

## 10. Error Handling & Fault Tolerance

### 10.1 Arduino-Side Error Recovery

| Failure Mode | Detection | Recovery |
|---|---|---|
| Partial packet received (PC crash mid-send) | `0xFF` appearing in unexpected position | Parser resets to `STATE_WAIT_START`, increments `errorCount` |
| USB disconnect | Arduino continues outputting last valid DMX state | No action needed; DMX fixtures hold last values |
| Serial buffer overflow | Bytes discarded silently by Arduino hardware | Parser will resync on next start byte; full state re-broadcast by PC on reconnect |
| DMX output fault | Heartbeat `dmx_running` flag = 0 | PC triggers `CMD_RESET` packet, then performs full state re-broadcast |

### 10.2 PC-Side Error Recovery

| Failure Mode | Detection | Recovery |
|---|---|---|
| Arduino USB disconnect | `port.close` event fires | Emit `disconnected`, show UI indicator, poll for reconnection every 2 seconds |
| Arduino not responding (no heartbeat for > 3 seconds) | Heartbeat timeout | Show warning in UI, attempt `CMD_RESET` |
| Serial write error | `port.write` callback error | Log error, attempt port re-open |
| Application crash during performance | N/A | Arduino holds last DMX output indefinitely — fixtures stay in last known state (safe fail) |

### 10.3 Full State Re-broadcast on Reconnect

When the serial bridge reconnects after a disconnect, it must immediately re-broadcast the full fixture state, since the Arduino may have been reset:

```javascript
this.port.on('open', () => {
  // Mark all fixtures dirty to force full re-broadcast
  this.dirtyFlags.fill(true);
  // Copy pending state from current UI state
  for (let i = 0; i < MAX_FIXTURES; i++) {
    this.pendingState[i] = { ...this.currentState[i] };
  }
});
```

---

## 11. Development Roadmap

### Phase 1 — Minimal Viable Pipeline (MVP)

- [ ] Arduino firmware: packet parser + DMX output (Conceptinetics)
- [ ] Serial bridge: Node.js basic `setFixture()` and `setBlackout()` 
- [ ] PC GUI: fixture grid with color pickers, blackout button
- [ ] Fixture JSON configuration file loader
- [ ] Serial port selector in settings

**Deliverable:** Fully functional live color control for up to 32 RGB fixtures from a GUI.

### Phase 2 — Scene and Show Management

- [ ] Scene save / load (JSON)
- [ ] Scene browser UI
- [ ] Cue list with `GO` / `BACK` controls
- [ ] Keyboard shortcut map (`SPACE` = blackout, `ENTER` = go, arrow keys = prev/next cue)
- [ ] Fade engine (linear + ease-in-out)

**Deliverable:** A complete show can be pre-programmed and played back live.

### Phase 3 — Effect Engine

- [ ] Color Chase
- [ ] Sine Pulse
- [ ] Color Wave
- [ ] Strobe
- [ ] Random Flicker
- [ ] Effect parameter UI panel
- [ ] Effect-per-group assignment

**Deliverable:** Dynamic, generative effects available for live use without pre-programming.

### Phase 4 — Advanced Features

- [ ] MIDI controller input (MIDI CC → fixture color / scene recall)
- [ ] Audio reactivity (Web Audio API RMS / beat detection → brightness)
- [ ] OSC server input (receive `/fixture/{id}/rgb` messages from TouchDesigner, etc.)
- [ ] Multi-universe support (multiple Arduino instances or a USB–DMX dongle)
- [ ] Show file export / import (full show as a single JSON bundle)

---

## 12. Dependency Summary

### Arduino

| Dependency | Source | Notes |
|---|---|---|
| `Conceptinetics` | Arduino Library Manager | DMX master output |
| Arduino Mega 2560 | Hardware | Recommended platform |
| MAX485 / CTC-DRA-10-R | Hardware | RS-485 transceiver |

### PC Application (Node.js / Electron)

| Package | Version | Purpose |
|---|---|---|
| `electron` | latest | Desktop application shell |
| `react` | 18.x | UI framework |
| `zustand` | 4.x | State management |
| `serialport` | 12.x | USB serial communication |
| `@serialport/list` | bundled | Port enumeration |
| `electron-builder` | latest | Application packaging |

### Installation

```bash
# Create project
npm create electron-vite@latest lighting-controller -- --template react

cd lighting-controller

# Install runtime dependencies
npm install serialport zustand

# Install dev dependencies
npm install --save-dev electron-builder
```

### Optional PC Packages

| Package | Purpose |
|---|---|
| `midi` (`node-midi`) | MIDI controller input |
| `node-osc` | OSC protocol input receiver |
| `meyda` | Audio feature extraction (beat detection) |
| `chroma-js` | Color space conversion (HSV ↔ RGB ↔ Kelvin) |

---

*End of document.*
