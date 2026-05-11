function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const map = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i]
  return { r: Math.round(map[0]*255), g: Math.round(map[1]*255), b: Math.round(map[2]*255) }
}

export const EFFECTS = {
  color: {
    name: 'Color',
    static: true,
    defaultParams: { dim: 254, r: 255, g: 255, b: 255 },
    init(fixtures, params, setFixture) {
      fixtures.forEach(id => setFixture(id, params.dim, params.r, params.g, params.b))
    },
    tick() { return [] }
  },
  chase: {
    name: 'Color Chase',
    defaultParams: { speed: 2, r: 255, g: 100, b: 0 },
    tick(fixtures, time, params) {
      const period = 1000 / params.speed
      const active = Math.floor((time / period) % fixtures.length)
      return fixtures.map((id, idx) =>
        idx === active
          ? { id, r: params.r, g: params.g, b: params.b }
          : { id, r: 0, g: 0, b: 0 }
      )
    }
  },
  sinePulse: {
    name: 'Sine Pulse',
    defaultParams: { speed: 1, r: 0, g: 100, b: 255, phaseOffset: 0, minBrightness: 0 },
    init(fixtures, params, setFixture) {
      fixtures.forEach(id => setFixture(id, 254, params.r, params.g, params.b))
    },
    tick(fixtures, time, params) {
      const minDim = Math.round(params.minBrightness * 254)
      return fixtures.map((id, idx) => {
        const phase = (idx * params.phaseOffset * Math.PI) / 180
        const v = (Math.sin(2 * Math.PI * (params.speed / 1000) * time + phase) + 1) / 2
        return { id, dimmer: Math.round(minDim + v * (254 - minDim)) }
      })
    }
  },
  colorWave: {
    name: 'Color Wave',
    defaultParams: { speed: 0.5, phaseOffset: 30, hue1: 180, hue2: 270, direction: 'short', pulseAmount: 0, pulseSpeed: 1 },
    tick(fixtures, time, params) {
      const freq = params.speed / 1000
      const pulseFreq = params.pulseSpeed / 1000
      const cwDelta = ((params.hue2 - params.hue1) % 360 + 360) % 360
      const delta = params.direction === 'short'
        ? (cwDelta <= 180 ? cwDelta : cwDelta - 360)
        : (cwDelta <= 180 ? cwDelta - 360 : cwDelta)
      return fixtures.map((id, idx) => {
        const phase = freq * time * Math.PI * 2 + idx * (params.phaseOffset * Math.PI / 180)
        const t = (Math.sin(phase) + 1) / 2
        const hue = ((params.hue1 + delta * t) % 360 + 360) % 360
        const pulsePhase = pulseFreq * time * Math.PI * 2 + idx * (params.phaseOffset * Math.PI / 180)
        const dimmer = Math.round(((1 - params.pulseAmount) + params.pulseAmount * (Math.sin(pulsePhase) + 1) / 2) * 254)
        return { id, ...hsvToRgb(hue, 1.0, 1.0), dimmer }
      })
    }
  },
  colorStep: {
    name: 'Color Step',
    defaultParams: { speed: 1, phaseOffset: 0, hues: [0, 120, 240] },
    tick(fixtures, time, params) {
      const { speed, phaseOffset, hues } = params
      if (!hues || hues.length === 0) return []
      const period = 1000 / speed
      return fixtures.map((id, idx) => {
        const adjustedTime = time - idx * phaseOffset
        const colorIndex = ((Math.floor(adjustedTime / period) % hues.length) + hues.length) % hues.length
        return { id, ...hsvToRgb(hues[colorIndex], 1.0, 1.0) }
      })
    }
  },
  strobe: {
    name: 'Strobe',
    defaultParams: { speed: 8, phaseOffset: 0, r: 255, g: 255, b: 255 },
    init(fixtures, params, setFixture) {
      fixtures.forEach(id => setFixture(id, 254, params.r, params.g, params.b))
    },
    tick(fixtures, time, params) {
      return fixtures.map((id, idx) => {
        const shiftedTime = time + idx * params.phaseOffset
        const on = Math.floor((shiftedTime / 1000) * params.speed) % 2 === 0
        return { id, dimmer: on ? 254 : 0 }
      })
    }
  },
  randomFlicker: {
    name: 'Random Flicker',
    defaultParams: { speed: 5, r: 255, g: 180, b: 60 },
    tick(fixtures, time, params) {
      const step = Math.floor((time / 1000) * params.speed)
      return fixtures.map((id, idx) => {
        const seed = (step * 31 + idx * 17) % 7
        const bright = seed < 4 ? 1 : seed < 6 ? 0.5 : 0.1
        return {
          id,
          r: Math.round(params.r * bright),
          g: Math.round(params.g * bright),
          b: Math.round(params.b * bright)
        }
      })
    }
  }
}

function easeInOut(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2
}

export class EffectEngine {
  constructor(setFixture) {
    this.setFixture        = setFixture
    this.fixtureEffects    = new Map()
    this.ticker            = null
    this._envelopeStart    = null
    this._envelopeDuration = 0
    this._fromColors       = null
  }

  // Crossfade from fromColors (Map<id,{d,r,g,b}>) to new effect output over durationMs.
  startFadeIn(durationMs, fromColors = null) {
    this._envelopeStart    = performance.now()
    this._envelopeDuration = durationMs
    this._fromColors       = fromColors  // Map<id, {d,r,g,b}> | null
  }

  _getEnvelope() {
    if (this._envelopeStart === null) return 1
    const t = Math.min((performance.now() - this._envelopeStart) / this._envelopeDuration, 1)
    if (t >= 1) { this._envelopeStart = null; this._fromColors = null; return 1 }
    return easeInOut(t)
  }

  setFixtureEffect(fixtureIds, effectKey, params) {
    const effect = EFFECTS[effectKey]
    if (!effect) return
    const startTime = Date.now()
    const groupId   = Symbol()
    fixtureIds.forEach(id => this.fixtureEffects.set(id, { effectKey, params, startTime, groupId }))
    if (effect.init) effect.init(fixtureIds, params, this.setFixture)
    this._ensureTicker()
  }

  updateFixtureEffectParams(fixtureIds, params) {
    fixtureIds.forEach(id => {
      const entry = this.fixtureEffects.get(id)
      if (!entry) return
      entry.params = params
      const effect = EFFECTS[entry.effectKey]
      if (effect?.static && effect?.init) {
        effect.init([id], params, this.setFixture)
      }
    })
  }

  clearFixtureEffect(fixtureIds) {
    fixtureIds.forEach(id => this.fixtureEffects.delete(id))
    if (this.fixtureEffects.size === 0) this._stopTicker()
  }

  clearAll() {
    this.fixtureEffects.clear()
    this._envelopeStart = null
    this._fromColors    = null
    this._stopTicker()
  }

  // Backward-compat wrappers
  start(effectKey, fixtureIds, params) {
    this.clearAll()
    this.setFixtureEffect(fixtureIds, effectKey, params)
  }

  stop() { this.clearAll() }

  destroy() { this.clearAll() }

  _ensureTicker() {
    if (this.ticker) return
    this.ticker = setInterval(() => this._tick(), 16)
  }

  _stopTicker() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null }
  }

  _tick() {
    if (this.fixtureEffects.size === 0) return
    const now = Date.now()

    // Group fixtures by groupId so group-aware effects (e.g. chase) receive
    // the full fixture list in one tick() call instead of one call per fixture.
    const groups = new Map()
    this.fixtureEffects.forEach((entry, id) => {
      if (!groups.has(entry.groupId)) groups.set(entry.groupId, { entry, ids: [] })
      groups.get(entry.groupId).ids.push(id)
    })

    const envelope = this._getEnvelope()

    groups.forEach(({ entry: { effectKey, params, startTime }, ids }) => {
      const effect = EFFECTS[effectKey]
      if (!effect) return
      const results = effect.tick(ids, now - startTime, params)
      results.forEach(({ id, r, g, b, dimmer }) => {
        // Resolve target channels:
        // - colour: tick output, or effect params for dimmer-only effects (sinePulse, strobe)
        // - dimmer: tick output, or 254 (full) for colour-only effects (brightness baked in RGB)
        const toR = r       !== undefined ? r       : params.r
        const toG = r       !== undefined ? g       : params.g
        const toB = r       !== undefined ? b       : params.b
        const toD = dimmer  !== undefined ? dimmer  : 254

        if (toR === undefined) return  // no colour info at all — skip

        if (envelope >= 1) {
          this.setFixture(id, toD, toR, toG, toB)
          return
        }
        // Crossfade: lerp every channel from captured prior state to new effect output
        const from = this._fromColors?.get(id) ?? { d: 0, r: 0, g: 0, b: 0 }
        this.setFixture(id,
          Math.round(from.d + (toD - from.d) * envelope),
          Math.round(from.r + (toR - from.r) * envelope),
          Math.round(from.g + (toG - from.g) * envelope),
          Math.round(from.b + (toB - from.b) * envelope)
        )
      })
    })
  }
}
