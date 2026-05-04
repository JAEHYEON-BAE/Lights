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
    defaultParams: { speed: 1, r: 0, g: 100, b: 255 },
    tick(fixtures, time, params) {
      const brightness = (Math.sin(2 * Math.PI * (params.speed / 1000) * time) + 1) / 2
      return fixtures.map(id => ({
        id,
        r: Math.round(params.r * brightness),
        g: Math.round(params.g * brightness),
        b: Math.round(params.b * brightness)
      }))
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
    defaultParams: { speed: 8, r: 255, g: 255, b: 255 },
    tick(fixtures, time, params) {
      const on = Math.floor((time / 1000) * params.speed) % 2 === 0
      return fixtures.map(id => ({
        id,
        r: on ? params.r : 0,
        g: on ? params.g : 0,
        b: on ? params.b : 0
      }))
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
  constructor(setFixtureColor) {
    this.setFixtureColor = setFixtureColor
    this.active = null
    this.ticker = null
    this.startTime = 0
  }

  start(effectKey, fixtureIds, params) {
    this.stop()
    const effect = EFFECTS[effectKey]
    if (!effect) return
    this.startTime = Date.now()
    this.ticker = setInterval(() => {
      const time = Date.now() - this.startTime
      const results = effect.tick(fixtureIds, time, params)
      results.forEach(({ id, r, g, b }) => this.setFixtureColor(id, r, g, b))
    }, 16)
    this.active = effectKey
  }

  stop() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null }
    this.active = null
  }

  destroy() {
    this.stop()
  }
}
