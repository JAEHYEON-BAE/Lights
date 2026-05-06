function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const map = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i]
  return { r: Math.round(map[0]*255), g: Math.round(map[1]*255), b: Math.round(map[2]*255) }
}

export const EFFECTS = {
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
    defaultParams: { speed: 1, r: 0, g: 100, b: 255, phaseOffset: 0, minBrightness: 1 },
    init(fixtures, params, setFixtureColor) {
      fixtures.forEach(id => setFixtureColor(id, params.r, params.g, params.b))
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
    defaultParams: { speed: 0.5, phaseOffset: 30 },
    tick(fixtures, time, params) {
      const freq = params.speed / 1000
      return fixtures.map((id, idx) => {
        const hue = ((freq * time * 360 + idx * params.phaseOffset) % 360 + 360) % 360
        return { id, ...hsvToRgb(hue, 1.0, 1.0) }
      })
    }
  },
  strobe: {
    name: 'Strobe',
    defaultParams: { speed: 8, phaseOffset: 0, r: 255, g: 255, b: 255 },
    init(fixtures, params, setFixtureColor) {
      fixtures.forEach(id => setFixtureColor(id, params.r, params.g, params.b))
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

export class EffectEngine {
  constructor(setFixtureColor, setFixtureDimmer) {
    this.setFixtureColor  = setFixtureColor
    this.setFixtureDimmer = setFixtureDimmer
    this.fixtureEffects   = new Map() // Map<fixtureId, { effectKey, params, startTime }>
    this.ticker           = null
  }

  setFixtureEffect(fixtureIds, effectKey, params) {
    const effect = EFFECTS[effectKey]
    if (!effect) return
    const startTime = Date.now()
    const groupId   = Symbol()
    fixtureIds.forEach(id => this.fixtureEffects.set(id, { effectKey, params, startTime, groupId }))
    if (effect.init) effect.init(fixtureIds, params, this.setFixtureColor)
    this._ensureTicker()
  }

  clearFixtureEffect(fixtureIds) {
    fixtureIds.forEach(id => this.fixtureEffects.delete(id))
    if (this.fixtureEffects.size === 0) this._stopTicker()
  }

  clearAll() {
    this.fixtureEffects.clear()
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

    groups.forEach(({ entry: { effectKey, params, startTime }, ids }) => {
      const effect = EFFECTS[effectKey]
      if (!effect) return
      const results = effect.tick(ids, now - startTime, params)
      results.forEach(result => {
        if (result.dimmer !== undefined) {
          this.setFixtureDimmer(result.id, result.dimmer)
        } else {
          this.setFixtureColor(result.id, result.r, result.g, result.b)
        }
      })
    })
  }
}
