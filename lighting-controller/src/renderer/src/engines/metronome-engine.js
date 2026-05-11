// Metronome using Web Audio API lookahead scheduler.
// Schedules oscillator bursts slightly ahead of time for jitter-free clicks.

export class MetronomeEngine {
  constructor() {
    this._ctx          = null
    this._masterGain   = null
    this._bpm          = 120
    this._beatsPerBar  = 4
    this._beat         = 0          // current beat in bar (0 = downbeat)
    this._nextBeatTime = 0          // AudioContext timestamp of next click
    this._schedulerId  = null
    this._deviceId     = ''         // '' = system default
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async start(bpm, beatsPerBar, volume) {
    await this._ensureContext()
    if (this._ctx.state === 'suspended') await this._ctx.resume()
    this._bpm         = bpm
    this._beatsPerBar = beatsPerBar
    if (volume !== undefined) this._masterGain.gain.value = volume
    this._beat         = 0
    this._nextBeatTime = this._ctx.currentTime + 0.05
    this._stopScheduler()
    this._schedulerId = setInterval(() => this._schedule(), 25)
  }

  // Call when BPM/time-sig changes mid-show (restarts from next beat boundary)
  updateBpm(bpm, beatsPerBar) {
    if (this._bpm === bpm && this._beatsPerBar === beatsPerBar) return
    this._bpm         = bpm
    this._beatsPerBar = beatsPerBar
    if (this._schedulerId && this._ctx) {
      this._beat         = 0
      this._nextBeatTime = this._ctx.currentTime + 0.05
    }
  }

  stop() { this._stopScheduler() }

  setVolume(v) {
    if (this._masterGain) this._masterGain.gain.value = Math.max(0, Math.min(1, v))
  }

  async setDevice(deviceId) {
    this._deviceId = deviceId
    if (this._ctx) {
      try { await this._ctx.setSinkId(deviceId) } catch (_) {}
    }
  }

  destroy() {
    this.stop()
    this._ctx?.close()
    this._ctx = null
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  async _ensureContext() {
    if (this._ctx) return
    this._ctx        = new AudioContext()
    this._masterGain = this._ctx.createGain()
    this._masterGain.connect(this._ctx.destination)
    if (this._deviceId) {
      try { await this._ctx.setSinkId(this._deviceId) } catch (_) {}
    }
  }

  _stopScheduler() {
    if (this._schedulerId) { clearInterval(this._schedulerId); this._schedulerId = null }
  }

  _schedule() {
    // Schedule all beats that fall within the next 100 ms
    const lookahead = 0.1
    while (this._nextBeatTime < this._ctx.currentTime + lookahead) {
      this._click(this._nextBeatTime, this._beat === 0)
      this._beat         = (this._beat + 1) % this._beatsPerBar
      this._nextBeatTime += 60.0 / this._bpm
    }
  }

  _click(time, isDownbeat) {
    const osc  = this._ctx.createOscillator()
    const gain = this._ctx.createGain()
    osc.connect(gain)
    gain.connect(this._masterGain)

    // Downbeat: higher pitch + slightly louder
    osc.frequency.value = isDownbeat ? 1200 : 900
    gain.gain.setValueAtTime(isDownbeat ? 1.0 : 0.7, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04)
    osc.start(time)
    osc.stop(time + 0.04)
  }
}

// Enumerate available audio output devices.
// Returns [{deviceId, label}] — label may be empty if permission not granted.
export async function listAudioOutputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
  } catch {
    return []
  }
}
