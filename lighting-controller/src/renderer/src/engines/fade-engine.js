function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class FadeEngine {
  constructor(setFixtureColor, setFixtureDimmer) {
    this.setFixtureColor  = setFixtureColor
    this.setFixtureDimmer = setFixtureDimmer
    this.activeFades = new Map()
    this.ticker = setInterval(() => this._tick(), 16)
  }

  // Fade a single fixture from (fromD, fromR, fromG, fromB) to (toD, toR, toG, toB)
  fadeTo(id, fromD, fromR, fromG, fromB, toD, toR, toG, toB, durationMs) {
    if (durationMs <= 0) {
      this.setFixtureColor(id, toR, toG, toB)
      this.setFixtureDimmer(id, toD)
      return
    }
    this.activeFades.set(id, {
      startD: fromD, startR: fromR, startG: fromG, startB: fromB,
      endD:   toD,   endR:   toR,   endG:   toG,   endB:   toB,
      startTime: Date.now(), duration: durationMs
    })
  }

  stop(id)   { this.activeFades.delete(id) }
  stopAll()  { this.activeFades.clear() }
  destroy()  { clearInterval(this.ticker); this.activeFades.clear() }

  _tick() {
    if (this.activeFades.size === 0) return
    const now = Date.now()
    for (const [id, fade] of this.activeFades) {
      const t = easeInOut(Math.min((now - fade.startTime) / fade.duration, 1.0))
      const r = Math.round(fade.startR + (fade.endR - fade.startR) * t)
      const g = Math.round(fade.startG + (fade.endG - fade.startG) * t)
      const b = Math.round(fade.startB + (fade.endB - fade.startB) * t)
      const d = Math.round(fade.startD + (fade.endD - fade.startD) * t)
      this.setFixtureColor(id, r, g, b)
      this.setFixtureDimmer(id, d)
      if (t >= 1.0) this.activeFades.delete(id)
    }
  }
}
