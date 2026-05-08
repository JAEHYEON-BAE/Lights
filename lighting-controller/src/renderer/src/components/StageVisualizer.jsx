import React from 'react'
import useStore from '../store'

function FixtureLight({ fixture, size = 38, coneHeight = 90 }) {
  const { r = 0, g = 0, b = 0, d = 254 } = useStore(s => s.fixtureState[fixture.id] || { d: 254, r: 0, g: 0, b: 0 })
  const blackout = useStore(s => s.blackoutActive)
  const enabled  = useStore(s => s.fixtureEnabled[fixture.id] ?? true)

  const dr = (blackout || !enabled) ? 0 : Math.round(r * d / 254)
  const dg = (blackout || !enabled) ? 0 : Math.round(g * d / 254)
  const db = (blackout || !enabled) ? 0 : Math.round(b * d / 254)
  const on = dr > 0 || dg > 0 || db > 0

  return (
    <div
      title={fixture.name}
      style={{ position: 'relative', width: size, height: size + coneHeight, flexShrink: 0 }}
    >
      {/* PAR can */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: on
          ? `radial-gradient(circle at 38% 38%, #ffffff 0%, rgb(${dr},${dg},${db}) 48%, rgba(${dr},${dg},${db},0.15) 100%)`
          : '#141420',
        boxShadow: on
          ? `0 0 12px 4px rgba(${dr},${dg},${db},0.8), 0 0 32px 14px rgba(${dr},${dg},${db},0.35), inset 0 1px 2px rgba(255,255,255,0.25)`
          : 'inset 0 0 0 1px #252535',
        transition: 'background 80ms ease, box-shadow 80ms ease',
      }} />

      {/* Light cone */}
      {on && (
        <div style={{
          position: 'absolute',
          top: size - 4,
          left: '50%',
          transform: 'translateX(-50%)',
          width: size * 1.7,
          height: coneHeight,
          background: `linear-gradient(to bottom, rgba(${dr},${dg},${db},0.4) 0%, rgba(${dr},${dg},${db},0) 100%)`,
          clipPath: 'polygon(22% 0%, 78% 0%, 100% 100%, 0% 100%)',
          pointerEvents: 'none',
          transition: 'background 80ms ease',
        }} />
      )}
    </div>
  )
}

export default function StageVisualizer({ compact = false }) {
  const fixtures = useStore(s => s.fixtures)
  const groups   = useStore(s => s.groups)

  if (fixtures.length === 0) return null

  const fixturesByGroup = groups
    .map(g => ({ ...g, fixtures: fixtures.filter(f => f.group === g.id) }))
    .filter(g => g.fixtures.length > 0)

  const ungrouped = fixtures.filter(f => !groups.some(g => g.id === f.group))

  const fixtureSize  = compact ? 26 : 38
  const coneHeight   = compact ? 52 : 90
  const groupGap     = compact ? 10 : 32
  const fixtureGap   = compact ? 6  : 10

  return (
    <div style={{
      position: 'relative',
      background: '#05050a',
      border: '1px solid #1a1a28',
      borderRadius: 12,
      padding: compact ? '8px 10px 20px' : '12px 20px 28px',
      overflow: 'hidden',
    }}>
      {/* Truss bar */}
      <div style={{ height: 4, background: '#252535', borderRadius: 2, marginBottom: compact ? 8 : 12 }} />

      {/* Fixture groups */}
      <div style={{
        display: 'flex',
        flexDirection: compact ? 'column' : 'row',
        justifyContent: compact ? 'flex-start' : 'center',
        alignItems: compact ? 'stretch' : 'flex-start',
        gap: groupGap,
      }}>
        {fixturesByGroup.map(g => (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {compact && (
              <span style={{
                fontSize: 8,
                color: '#333348',
                letterSpacing: '0.15em',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                alignSelf: 'flex-start',
              }}>
                {g.name}
              </span>
            )}
            <div style={{ display: 'flex', gap: fixtureGap, alignItems: 'flex-start', flexWrap: compact ? 'wrap' : 'nowrap' }}>
              {g.fixtures.map(f => <FixtureLight key={f.id} fixture={f} size={fixtureSize} coneHeight={coneHeight} />)}
            </div>
            {!compact && (
              <span style={{
                fontSize: 9,
                color: '#262636',
                letterSpacing: '0.15em',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
              }}>
                {g.name}
              </span>
            )}
          </div>
        ))}

        {ungrouped.length > 0 && (
          <div style={{ display: 'flex', gap: fixtureGap, flexWrap: 'wrap' }}>
            {ungrouped.map(f => <FixtureLight key={f.id} fixture={f} size={fixtureSize} coneHeight={coneHeight} />)}
          </div>
        )}
      </div>

      {/* Stage floor line */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'linear-gradient(to right, transparent, #1a1a28 20%, #1a1a28 80%, transparent)',
      }} />

      {/* Audience label */}
      <div style={{
        position: 'absolute',
        bottom: 6,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 9,
        color: '#1c1c2c',
        letterSpacing: '0.3em',
        fontFamily: 'monospace',
        whiteSpace: 'nowrap',
      }}>
        ▲ AUDIENCE
      </div>
    </div>
  )
}
