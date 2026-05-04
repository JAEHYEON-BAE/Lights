#!/usr/bin/env node
/**
 * Serial signal monitor — decodes PC→Arduino packets and Arduino→PC heartbeats.
 * Run:  node monitor.js [port]  (e.g. node monitor.js /dev/cu.usbmodem14201)
 * If no port is given, lists available ports and exits.
 *
 * Modes:
 *   --listen   Open port and display decoded packets (acts as fake Arduino)
 *   --send     Send test packets to a real Arduino and show responses
 *              (default: --listen)
 */

const { SerialPort } = require('serialport')

const START_BYTE  = 0xFF
const CMD_BLACKOUT = 0xFE
const CMD_RESET    = 0xFD
const MAX_FIXTURES = 32

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const ESC   = '\x1b['
const clear  = () => process.stdout.write('\x1bc')
const home   = () => process.stdout.write(`${ESC}H`)
const moveTo = (r, c) => process.stdout.write(`${ESC}${r};${c}H`)
const bold   = s  => `${ESC}1m${s}${ESC}0m`
const dim    = s  => `${ESC}2m${s}${ESC}0m`
const col    = (r, g, b, s) => `${ESC}38;2;${r};${g};${b}m${s}${ESC}0m`
const bgCol  = (r, g, b, s) => `${ESC}48;2;${r};${g};${b}m${ESC}38;2;${r+g+b>300?0:255};${r+g+b>300?0:255};${r+g+b>300?0:255}m${s}${ESC}0m`
const hideCursor = () => process.stdout.write(`${ESC}?25l`)
const showCursor = () => process.stdout.write(`${ESC}?25h`)

// ── State ─────────────────────────────────────────────────────────────────────
const fixtureState = Array.from({ length: MAX_FIXTURES }, () => ({ r: 0, g: 0, b: 0 }))
let packetCount    = 0
let errorCount     = 0
let blackoutActive = false
let lastPacketTime = Date.now()
let heartbeatCount = 0
let startTime      = Date.now()

// ── Packet parser (mirrors Arduino state machine) ─────────────────────────────
let parserState = 'WAIT_START'
let pkt_id, pkt_r, pkt_g

function parseByte(byte) {
  switch (parserState) {
    case 'WAIT_START':
      if (byte === START_BYTE) parserState = 'READ_ID'
      break

    case 'READ_ID':
      if (byte === START_BYTE) { errorCount++; parserState = 'READ_ID' }
      else if (byte === CMD_BLACKOUT) {
        blackoutActive = true
        fixtureState.forEach(f => { f.r = 0; f.g = 0; f.b = 0 })
        packetCount++
        parserState = 'WAIT_START'
        logEvent('BLACKOUT ALL')
      } else if (byte === CMD_RESET) {
        logEvent('RESET')
        parserState = 'WAIT_START'
      } else {
        blackoutActive = false
        pkt_id = byte
        parserState = 'READ_R'
      }
      break

    case 'READ_R':
      if (byte === START_BYTE) { errorCount++; parserState = 'READ_ID' }
      else { pkt_r = byte; parserState = 'READ_G' }
      break

    case 'READ_G':
      if (byte === START_BYTE) { errorCount++; parserState = 'READ_ID' }
      else { pkt_g = byte; parserState = 'READ_B' }
      break

    case 'READ_B':
      if (byte === START_BYTE) { errorCount++; parserState = 'READ_ID' }
      else {
        if (pkt_id < MAX_FIXTURES) {
          fixtureState[pkt_id] = { r: pkt_r, g: pkt_g, b: byte }
        }
        packetCount++
        lastPacketTime = Date.now()
        parserState = 'WAIT_START'
      }
      break
  }
}

// ── Heartbeat parser (Arduino → PC) ──────────────────────────────────────────
let hbBuf = []
let lastHeartbeat = null

function parseHeartbeat(data) {
  for (const byte of data) {
    hbBuf.push(byte)
    if (hbBuf.length >= 8) {
      if (hbBuf[0] === 0xAA && hbBuf[1] === 0x01) {
        lastHeartbeat = {
          dmxRunning:  hbBuf[2] === 1,
          packetCount: hbBuf[3],
          errorCount:  hbBuf[4]
        }
        heartbeatCount++
      }
      hbBuf = []
    }
  }
}

// ── Event log ─────────────────────────────────────────────────────────────────
const eventLog = []
function logEvent(msg) {
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false })
  eventLog.unshift(`${dim(t)}  ${msg}`)
  if (eventLog.length > 8) eventLog.pop()
}

// ── Render ────────────────────────────────────────────────────────────────────
function bar(r, g, b, width = 20) {
  const brightness = Math.round(((r + g + b) / 765) * width)
  const filled = '█'.repeat(brightness)
  const empty  = '░'.repeat(width - brightness)
  return col(r, g, b, filled) + dim(empty)
}

function colorSwatch(r, g, b) {
  return bgCol(r, g, b, `  #${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}  `)
}

function render(portPath) {
  home()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const pps = (packetCount / Math.max(elapsed, 0.1)).toFixed(1)
  const idle = Date.now() - lastPacketTime

  // Header
  process.stdout.write(`${bold('DMX Serial Monitor')}  ${dim('─'.repeat(50))}\n`)
  process.stdout.write(`Port: ${col(100,200,255, portPath)}   `)
  process.stdout.write(`Packets: ${bold(packetCount)}  `)
  process.stdout.write(`Errors: ${errorCount > 0 ? col(255,80,80, errorCount) : dim(errorCount)}  `)
  process.stdout.write(`Rate: ${bold(pps)} pkt/s  `)
  process.stdout.write(`Uptime: ${dim(elapsed + 's')}\n`)

  if (blackoutActive) {
    process.stdout.write(`${ESC}41m${ESC}1m  *** BLACKOUT ACTIVE ***  ${ESC}0m\n`)
  } else if (idle > 2000) {
    process.stdout.write(`${col(255,200,0,'⚠ No packets for ' + (idle/1000).toFixed(1) + 's')}\n`)
  } else {
    process.stdout.write(`${col(80,200,80,'● Live')}  ${dim('last packet ' + idle + 'ms ago')}\n`)
  }

  // Heartbeat from Arduino
  process.stdout.write(`\n${bold('Arduino Heartbeat:')}  `)
  if (lastHeartbeat) {
    process.stdout.write(
      `DMX ${lastHeartbeat.dmxRunning ? col(80,255,80,'running') : col(255,80,80,'FAULT')}  ` +
      `rx ${lastHeartbeat.packetCount}pkt  err ${lastHeartbeat.errorCount}  ` +
      `(${heartbeatCount} beats)\n`
    )
  } else {
    process.stdout.write(dim('waiting…\n'))
  }

  // Fixture grid
  process.stdout.write(`\n${bold('Fixture States:')}  ${dim('(ID · RGB · bar · swatch)')}\n`)
  process.stdout.write(dim('─'.repeat(72)) + '\n')

  const active = fixtureState.filter((f, i) => i < MAX_FIXTURES && (f.r || f.g || f.b))
  const showCount = Math.min(MAX_FIXTURES, 16)

  for (let id = 0; id < showCount; id++) {
    const { r, g, b } = fixtureState[id]
    const idStr  = id.toString().padStart(2, ' ')
    const rStr   = col(255,80,80,  r.toString().padStart(3))
    const gStr   = col(80,255,80,  g.toString().padStart(3))
    const bStr   = col(80,120,255, b.toString().padStart(3))
    const isOdd  = id % 2

    process.stdout.write(
      `  ${dim(idStr)}  ${rStr} ${gStr} ${bStr}  ${bar(r, g, b)}  ${colorSwatch(r, g, b)}` +
      (isOdd ? '\n' : '   ')
    )
  }

  // Event log
  process.stdout.write(`\n\n${bold('Event Log:')}\n`)
  eventLog.forEach(e => process.stdout.write('  ' + e + '\n'))
  if (eventLog.length === 0) process.stdout.write(dim('  (no events yet)\n'))

  process.stdout.write(`\n${dim('Press Ctrl+C to exit')}\n`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args     = process.argv.slice(2)
  const portArg  = args.find(a => !a.startsWith('--'))
  const modeSend = args.includes('--send')

  // List ports if no port given
  if (!portArg) {
    const ports = await SerialPort.list()
    console.log('\nAvailable serial ports:\n')
    if (ports.length === 0) {
      console.log('  (none found)')
    } else {
      ports.forEach(p => {
        console.log(`  ${p.path.padEnd(30)} ${p.manufacturer || ''}`)
      })
    }
    console.log('\nUsage:  node monitor.js <port> [--send]\n')
    process.exit(0)
  }

  const port = new SerialPort({ path: portArg, baudRate: 115200 })

  port.on('open', () => {
    logEvent(`Connected to ${portArg}`)
    clear()
    hideCursor()
    setInterval(() => render(portArg), 100)

    if (modeSend) {
      // Send test sweep: cycle through all fixtures
      let id = 0, hue = 0
      setInterval(() => {
        const r = Math.round(127 + 127 * Math.sin((hue + id * 30) * Math.PI / 180))
        const g = Math.round(127 + 127 * Math.sin((hue + id * 30 + 120) * Math.PI / 180))
        const b = Math.round(127 + 127 * Math.sin((hue + id * 30 + 240) * Math.PI / 180))
        port.write(Buffer.from([0xFF, id, r, g, b]))
        parseByte(0xFF); parseByte(id); parseByte(r); parseByte(g); parseByte(b)
        id = (id + 1) % 8
        hue = (hue + 2) % 360
      }, 23) // ~44 Hz
    }
  })

  port.on('data', (data) => {
    // Parse incoming data as either:
    // - PC→Arduino packets (if we're in listen mode, echoed back or loopback)
    // - Arduino→PC heartbeats
    for (const byte of data) parseByte(byte)
    parseHeartbeat(data)
  })

  port.on('error', (err) => {
    showCursor()
    console.error('\nSerial error:', err.message)
    process.exit(1)
  })

  process.on('SIGINT', () => {
    showCursor()
    port.close()
    console.log('\n\nMonitor closed.\n')
    process.exit(0)
  })
}

main().catch(err => { console.error(err); process.exit(1) })
