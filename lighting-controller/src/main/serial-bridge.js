import { SerialPort } from 'serialport'
import EventEmitter   from 'events'

const START_BYTE     = 0xFF
const CMD_BLACKOUT   = 0xFE
const CMD_RESET      = 0xFD
const FRAME_RATE_HZ  = 44
const FRAME_INTERVAL = Math.floor(1000 / FRAME_RATE_HZ)
const MAX_FIXTURES   = 32

// Set DEBUG_SERIAL=1 in your shell to log every outgoing packet and incoming heartbeat.
// e.g.:  DEBUG_SERIAL=1 npm run dev
const DEBUG_SERIAL = process.env.DEBUG_SERIAL === '1'
function dbg(...args) { if (DEBUG_SERIAL) console.log('[serial]', ...args) }

export class SerialBridge extends EventEmitter {
  constructor() {
    super()
    this.currentState = Array.from({ length: MAX_FIXTURES }, () => ({ r: 0, g: 0, b: 0 }))
    this.pendingState = Array.from({ length: MAX_FIXTURES }, () => ({ r: 0, g: 0, b: 0 }))
    this.dirtyFlags   = new Array(MAX_FIXTURES).fill(false)
    this.port         = null
    this.frameTimer   = null
    this.blackout     = false
    this.connected    = false
    this.heartbeatTimer = null
    this.lastHeartbeat  = Date.now()
    this._rxBuf        = Buffer.alloc(0)
  }

  async listAllPorts() {
    const ports = await SerialPort.list()
    return ports.map(p => ({
      ...p,
      path: p.path.replace(/^\/dev\/tty\./, '/dev/cu.')
    }))
  }

  async connect(portPath) {
    if (this.port && this.port.isOpen) await this.disconnect()

    this.port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false })

    return new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) { reject(err); return }

        this.connected = true
        this.lastHeartbeat = Date.now()
        this._rxBuf = Buffer.alloc(0)
        this.emit('connected', portPath)
        this._startFrameLoop()
        this._startHeartbeatWatcher()
        this._broadcastFullState()

        this.port.on('data',  (data) => this._handleIncoming(data))
        this.port.on('close', ()     => {
          this.connected = false
          this._stopFrameLoop()
          this._stopHeartbeatWatcher()
          this.emit('disconnected')
        })
        this.port.on('error', (err) => this.emit('error', err.message))

        resolve()
      })
    })
  }

  async disconnect() {
    this._stopFrameLoop()
    this._stopHeartbeatWatcher()
    if (this.port && this.port.isOpen) {
      await new Promise((resolve) => this.port.close(resolve))
    }
    this.connected = false
  }

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

  setBlackout(active) {
    this.blackout = active
    if (active && this.connected && !this.simulateMode && this.port?.isOpen) {
      dbg('BLACKOUT  → FF FE 00 00 00')
      this.port.write(Buffer.from([START_BYTE, CMD_BLACKOUT, 0, 0, 0]))
    }
    this.emit('blackout', active)
  }

  sendReset() {
    if (this.connected && !this.simulateMode && this.port?.isOpen) {
      dbg('RESET     → FF FD 00 00 00')
      this.port.write(Buffer.from([START_BYTE, CMD_RESET, 0, 0, 0]))
    }
  }

  _broadcastFullState() {
    this.dirtyFlags.fill(true)
    for (let i = 0; i < MAX_FIXTURES; i++) {
      this.pendingState[i] = { ...this.currentState[i] }
    }
  }

  _startFrameLoop() {
    this._stopFrameLoop()
    this.frameTimer = setInterval(() => this._sendFrame(), FRAME_INTERVAL)
  }

  _stopFrameLoop() {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null }
  }

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

  _handleIncoming(data) {
    dbg(`raw ← [${Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}]`)
    this._rxBuf = Buffer.concat([this._rxBuf, data])
    while (this._rxBuf.length >= 8) {
      const i = this._rxBuf.indexOf(0xAA)
      if (i === -1) { this._rxBuf = Buffer.alloc(0); break }
      if (i > 0)    { this._rxBuf = this._rxBuf.slice(i); continue }
      if (this._rxBuf[1] !== 0x01) { this._rxBuf = this._rxBuf.slice(1); continue }
      this.lastHeartbeat = Date.now()
      const hb = { dmxRunning: this._rxBuf[2] === 1, packetCount: this._rxBuf[3], errorCount: this._rxBuf[4] }
      dbg(`heartbeat ← dmxRunning:${hb.dmxRunning} pkt:${hb.packetCount} err:${hb.errorCount}`)
      this.emit('heartbeat', hb)
      this._rxBuf = this._rxBuf.slice(8)
    }
  }

  // Simulate mode: no real serial port, just echoes packets back as fake heartbeats
  startSimulate() {
    this.connected    = true
    this.simulateMode = true
    this.emit('connected', 'SIMULATE')
    this._startFrameLoop()
    this._startHeartbeatWatcher()
    this._broadcastFullState()
    // Send a fake heartbeat every second
    this._simHeartbeat = setInterval(() => {
      this.lastHeartbeat = Date.now()
      this.emit('heartbeat', { dmxRunning: true, packetCount: 0, errorCount: 0 })
    }, 1000)
  }

  stopSimulate() {
    if (!this.simulateMode) return
    this._stopFrameLoop()
    this._stopHeartbeatWatcher()
    clearInterval(this._simHeartbeat)
    this.connected    = false
    this.simulateMode = false
    this.emit('disconnected')
  }

  _startHeartbeatWatcher() {
    this._stopHeartbeatWatcher()
    this.heartbeatTimer = setInterval(() => {
      // Only warn if using a real port (not simulate mode)
      if (this.connected && !this.simulateMode && Date.now() - this.lastHeartbeat > 5000) {
        this.emit('heartbeat-timeout')
      }
    }, 1000)
  }

  _stopHeartbeatWatcher() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
  }
}
