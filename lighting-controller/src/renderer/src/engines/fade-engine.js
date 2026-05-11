function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class FadeEngine {
  constructor(setFixture) {
    this.setFixture   = setFixture
    this.activeFades  = new Map()
    this.ticker       = setInterval(() => this._tick(), 16)
  }

  // Fade fixture from (fromD,fromR,fromG,fromB) to (toD,toR,toG,toB).
  // All d values are raw (0–254); masterDimmer is applied inside setFixture.
  fadeTo(id, fromD, fromR, fromG, fromB, toD, toR, toG, toB, durationMs) {
    if (durationMs <= 0) {
      this.setFixture(id, toD, toR, toG, toB)
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
      this.setFixture(id,
        Math.round(fade.startD + (fade.endD - fade.startD) * t),
        Math.round(fade.startR + (fade.endR - fade.startR) * t),
        Math.round(fade.startG + (fade.endG - fade.startG) * t),
        Math.round(fade.startB + (fade.endB - fade.startB) * t)
      )
      if (t >= 1.0) this.activeFades.delete(id)
    }
  }
}
