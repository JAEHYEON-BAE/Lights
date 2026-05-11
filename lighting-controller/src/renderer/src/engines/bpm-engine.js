export class BpmEngine {
  constructor({ onRecallScene, onBreakpoint, onShowEnd, onStateUpdate }) {
    this._onRecallScene  = onRecallScene
    this._onBreakpoint   = onBreakpoint
    this._onShowEnd      = onShowEnd
    this._onStateUpdate  = onStateUpdate

    this._show                = null
    this._status              = 'stopped'
    this._currentSetlistIndex = -1
    this._currentSong         = null
    this._currentSegmentIndex = -1
    this._segmentStartTime    = null  // ideal start time of current segment
    this._songStartTime       = null  // real clock time when current song began (or was re-anchored)
    this._ticker              = null
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  load(show) {
    this.stop()
    this._show = show
  }

  start() {
    if (!this._show || this._show.setlist.length === 0) return
    this._currentSetlistIndex = 0
    this._advanceSetlist()
  }

  resume() {
    if (this._status !== 'breakpoint') return
    this._currentSetlistIndex++
    this._advanceSetlist()
  }

  stop() {
    this._stopTicker()
    this._status              = 'stopped'
    this._currentSetlistIndex = -1
    this._currentSong         = null
    this._currentSegmentIndex = -1
    this._segmentStartTime    = null
    this._songStartTime       = null
    this._pushState()
  }

  // Jump to a specific setlist item index and start from its first segment
  jumpToSetlistItem(index) {
    if (!this._show) return
    const setlist = this._show.setlist
    if (index < 0 || index >= setlist.length) return
    this._currentSetlistIndex = index
    this._processCurrentSetlistItem()
  }

  // Immediately advance to the next segment (manual — re-anchors timeline)
  skipForward() {
    if (this._status !== 'running') return
    this._advanceSegment(true)
  }

  // Restart current segment, or go back to previous segment (manual — re-anchors timeline)
  skipBack() {
    if (this._status !== 'running') return
    const prevSeg = this._currentSegmentIndex - 1
    this._startSegment(this._currentSong, prevSeg >= 0 ? prevSeg : 0, true)
  }

  destroy() {
    this.stop()
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _startTicker() {
    this._stopTicker()
    this._ticker = setInterval(() => this._tick(), 16)
  }

  _stopTicker() {
    if (this._ticker) { clearInterval(this._ticker); this._ticker = null }
  }

  _tick() {
    if (this._status !== 'running' || !this._currentSong) return
    const segment = this._currentSong.segments[this._currentSegmentIndex]
    if (!segment) return

    const barDurationMs = (60000 / this._currentSong.bpm) * this._currentSong.beats_per_bar
    const elapsedMs     = performance.now() - this._segmentStartTime
    const elapsedBars   = Math.floor(elapsedMs / barDurationMs)

    // Push progress update (throttled — only when bar count changes)
    if (elapsedBars !== this._lastElapsedBars) {
      this._lastElapsedBars = elapsedBars
      this._pushState({ elapsedBarsInSegment: elapsedBars })
    }

    if (elapsedBars >= segment.bars) {
      this._advanceSegment()
    }
  }

  // fromManual=true: re-anchor the song timeline to now (skipForward, skipBack, jumpTo)
  // fromManual=false (default): derive ideal start from _songStartTime to prevent drift
  _startSegment(song, segmentIndex, fromManual = false) {
    const barDurationMs = (60000 / song.bpm) * song.beats_per_bar

    // Cumulative duration of all segments before this one
    const idealOffset = song.segments
      .slice(0, segmentIndex)
      .reduce((sum, seg) => sum + seg.bars * barDurationMs, 0)

    if (segmentIndex === 0 || fromManual) {
      // Anchor the song timeline so this segment's ideal start == now
      this._songStartTime = performance.now() - idealOffset
    }

    this._currentSong         = song
    this._currentSegmentIndex = segmentIndex
    // Ideal absolute start time — not performance.now(), so tick jitter never propagates
    this._segmentStartTime    = this._songStartTime + idealOffset
    this._lastElapsedBars     = -1

    const segment = song.segments[segmentIndex]
    this._onRecallScene(segment.scene_id, segment.fade_in_ms ?? 0)
    this._pushState({ elapsedBarsInSegment: 0 })
  }

  _advanceSegment(fromManual = false) {
    const nextSeg = this._currentSegmentIndex + 1
    if (nextSeg < this._currentSong.segments.length) {
      this._startSegment(this._currentSong, nextSeg, fromManual)
    } else {
      this._currentSetlistIndex++
      this._advanceSetlist()
    }
  }

  _advanceSetlist() {
    const setlist = this._show?.setlist ?? []

    while (this._currentSetlistIndex < setlist.length) {
      const item = setlist[this._currentSetlistIndex]

      if (item.type === 'song') {
        const song = this._show.songs[item.song_id]
        if (song && song.segments.length > 0) {
          this._status = 'running'
          this._startTicker()
          this._startSegment(song, 0)
          return
        }
        // Invalid/empty song — skip
      } else if (item.type === 'breakpoint') {
        this._status = 'breakpoint'
        this._stopTicker()
        // Recall the breakpoint's scene if set
        if (item.scene_id) this._onRecallScene(item.scene_id, item.fade_in_ms ?? 0)
        this._pushState()
        this._onBreakpoint?.(item)
        return
      }

      this._currentSetlistIndex++
    }

    // Exhausted setlist
    this._status = 'ended'
    this._stopTicker()
    this._pushState()
    this._onShowEnd?.()
  }

  _processCurrentSetlistItem() {
    const setlist = this._show?.setlist ?? []
    const item    = setlist[this._currentSetlistIndex]
    if (!item) return

    if (item.type === 'song') {
      const song = this._show.songs[item.song_id]
      if (song && song.segments.length > 0) {
        this._status = 'running'
        this._startTicker()
        this._startSegment(song, 0)
      }
    } else if (item.type === 'breakpoint') {
      this._status = 'breakpoint'
      this._stopTicker()
      this._pushState()
      this._onBreakpoint?.(item)
    }
  }

  _pushState(extra = {}) {
    const song    = this._currentSong
    const segment = song ? song.segments[this._currentSegmentIndex] : null
    this._onStateUpdate?.({
      status:               this._status,
      currentSetlistIndex:  this._currentSetlistIndex,
      currentSongId:        song?.song_id ?? null,
      currentSegmentIndex:  this._currentSegmentIndex,
      currentBpm:           song?.bpm ?? 0,
      totalBarsInSegment:   segment?.bars ?? 0,
      elapsedBarsInSegment: this._lastElapsedBars ?? 0,
      ...extra,
    })
  }
}
