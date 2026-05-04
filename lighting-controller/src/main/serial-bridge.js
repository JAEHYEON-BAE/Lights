import { SerialPort } from 'serialport'
import EventEmitter   from 'events'

const START_BYTE     = 0xFF
const CMD_BLACKOUT   = 0xFE
const CMD_RESET      = 0xFD
const FRAME_RATE_HZ  = 44
const FRAME_INTERVAL = Math.floor(1000 / FRAME_RATE_HZ)
const MAX_FIXTURES   = 32

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
  }

  async listAllPorts() {
    return SerialPort.list()
  }

  async connect(portPath) {
    if (this.port && this.port.isOpen) await this.disconnect()

    this.port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false })

    return new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) { reject(err); return }

        this.connected = true
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
    const cr = Math.max(0, Math.min(255, Math.round(r)))
    const cg = Math.max(0, Math.min(255, Math.round(g)))
    const cb = Math.max(0, Math.min(255, Math.round(b)))
    const p  = this.pendingState[id]
    if (p.r !== cr || p.g !== cg || p.b !== cb) {
      p.r = cr; p.g = cg; p.b = cb
      this.dirtyFlags[id] = true
    }
  }

  setBlackout(active) {
    this.blackout = active
    if (active && this.connected && !this.simulateMode && this.port?.isOpen) {
      this.port.write(Buffer.from([START_BYTE, CMD_BLACKOUT, 0, 0, 0]))
    }
    this.emit('blackout', active)
  }

  sendReset() {
    if (this.connected && !this.simulateMode && this.port?.isOpen) {
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
    if (packets.length > 0) this.port.write(Buffer.from(packets))
  }

  _handleIncoming(data) {
    if (data.length >= 5 && data[0] === 0xAA && data[1] === 0x01) {
      this.lastHeartbeat = Date.now()
      this.emit('heartbeat', {
        dmxRunning:  data[2] === 1,
        packetCount: data[3],
        errorCount:  data[4]
      })
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
      if (this.connected && !this.simulateMode && Date.now() - this.lastHeartbeat > 3000) {
        this.emit('heartbeat-timeout')
      }
    }, 1000)
  }

  _stopHeartbeatWatcher() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
  }
}
