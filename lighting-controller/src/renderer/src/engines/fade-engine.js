function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export class FadeEngine {
  constructor(setFixtureColor) {
    this.setFixtureColor = setFixtureColor
    this.activeFades = new Map()
    this.ticker = setInterval(() => this._tick(), 16)
  }

  fadeTo(id, fromR, fromG, fromB, toR, toG, toB, durationMs) {
    if (durationMs <= 0) {
      this.setFixtureColor(id, toR, toG, toB)
      return
    }
    this.activeFades.set(id, {
      startR: fromR, startG: fromG, startB: fromB,
      endR: toR,     endG: toG,     endB: toB,
      startTime: Date.now(), duration: durationMs
    })
  }

  fadeScene(scene, dimmer, durationMs) {
    scene.fixtures.forEach(({ id, r, g, b }) => {
      this.fadeTo(id, 0, 0, 0, r, g, b, durationMs)
    })
  }

  stop(id) {
    this.activeFades.delete(id)
  }

  stopAll() {
    this.activeFades.clear()
  }

  destroy() {
    clearInterval(this.ticker)
    this.activeFades.clear()
  }

  _tick() {
    if (this.activeFades.size === 0) return
    const now = Date.now()
    for (const [id, fade] of this.activeFades) {
      const progress = Math.min((now - fade.startTime) / fade.duration, 1.0)
      const t = easeInOut(progress)
      this.setFixtureColor(
        id,
        Math.round(fade.startR + (fade.endR - fade.startR) * t),
        Math.round(fade.startG + (fade.endG - fade.startG) * t),
        Math.round(fade.startB + (fade.endB - fade.startB) * t)
      )
      if (progress >= 1.0) this.activeFades.delete(id)
    }
  }
}
