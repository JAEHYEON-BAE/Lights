import React from 'react'
import useStore from '../store'

export default function StatusBar() {
  const connected        = useStore(s => s.connected)
  const connectedPort    = useStore(s => s.connectedPort)
  const simulateMode     = useStore(s => s.simulateMode)
  const heartbeat        = useStore(s => s.heartbeat)
  const heartbeatTimeout = useStore(s => s.heartbeatTimeout)
  const masterDimmer     = useStore(s => s.masterDimmer)
  const setMasterDimmer  = useStore(s => s.setMasterDimmer)
  const blackoutActive   = useStore(s => s.blackoutActive)

  const statusColor = !connected
    ? 'bg-gray-600'
    : simulateMode
      ? 'bg-accent-purple'
      : heartbeatTimeout
        ? 'bg-yellow-500 animate-pulse'
        : 'bg-accent-green'

  return (
    <div className="h-10 flex items-center gap-4 px-4 bg-surface-800 border-b border-surface-700 flex-shrink-0 text-sm" style={{ WebkitAppRegion: 'drag' }}>
      <div className="w-16 flex-shrink-0" />

      {/* Connection */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-gray-400">
          {connected
            ? simulateMode ? 'Simulate mode' : connectedPort
            : 'Not connected'}
        </span>
      </div>

      {/* Heartbeat stats */}
      {heartbeat && connected && (
        <span className="text-gray-600 text-xs">
          {heartbeat.packetCount}pkt  {heartbeat.errorCount}err
        </span>
      )}
      {heartbeatTimeout && !simulateMode && (
        <span className="text-yellow-400 text-xs">⚠ Arduino not responding</span>
      )}

      <div className="flex-1" />

      {/* Blackout indicator */}
      {blackoutActive && (
        <span className="text-accent-red font-bold tracking-widest text-xs animate-pulse">
          BLACKOUT
        </span>
      )}

      {/* Master Dimmer */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
        <span className="text-gray-500 text-xs whitespace-nowrap">MASTER</span>
        <input
          type="range" min="0" max="1" step="0.01"
          value={masterDimmer}
          onChange={e => setMasterDimmer(parseFloat(e.target.value))}
          className="w-28"
        />
        <span className="text-gray-400 text-xs w-8 text-right">
          {Math.round(masterDimmer * 100)}%
        </span>
      </div>
    </div>
  )
}
