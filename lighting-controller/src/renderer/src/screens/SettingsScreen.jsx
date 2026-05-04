import React, { useState, useEffect } from 'react'
import useStore from '../store'

export default function SettingsScreen() {
  const connected      = useStore(s => s.connected)
  const connectedPort  = useStore(s => s.connectedPort)
  const setConnected   = useStore(s => s.setConnected)
  const setDisconnected = useStore(s => s.setDisconnected)
  const loadFixtures   = useStore(s => s.loadFixtures)

  const [ports, setPorts]           = useState([])
  const [selectedPort, setSelectedPort] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError]           = useState('')
  const [fixturePath, setFixturePath] = useState('')
  const [fixtureStatus, setFixtureStatus] = useState('')

  const refreshPorts = async () => {
    const list = await window.api.listPorts()
    setPorts(list)
    if (list.length > 0 && !selectedPort) setSelectedPort(list[0].path)
  }

  useEffect(() => { refreshPorts() }, [])

  const handleConnect = async () => {
    if (!selectedPort) return
    setConnecting(true)
    setError('')
    try {
      await window.api.connect(selectedPort)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await window.api.disconnect()
  }

  const handleLoadFixtures = async () => {
    const data = await window.api.loadFixtures(fixturePath || null)
    if (data) {
      loadFixtures(data)
      setFixtureStatus(`Loaded ${data.fixtures.length} fixture(s)`)
    } else {
      setFixtureStatus('Failed to load fixture file.')
    }
  }

  const handleReset    = () => window.api.reset()
  const handleSimulate = () => window.api.startSimulate()
  const handleStopSim  = () => window.api.stopSimulate()

  const isSimulate = connectedPort === 'SIMULATE'

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* No-hardware simulate banner */}
      {!connected && (
        <div className="bg-surface-700 border border-surface-600 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-sm mb-0.5">No Arduino? Use Simulate mode</div>
            <div className="text-xs text-gray-500">
              Runs the full app without hardware — scenes, cues, and effects all work normally.
            </div>
          </div>
          <button onClick={handleSimulate}
            className="px-4 py-2 rounded-xl bg-accent-purple text-white text-sm font-semibold whitespace-nowrap hover:opacity-90">
            Start Simulate
          </button>
        </div>
      )}

      {isSimulate && (
        <div className="bg-accent-purple/20 border border-accent-purple/40 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm text-purple-300">Simulate mode active</div>
            <div className="text-xs text-gray-400 mt-0.5">No DMX output — GUI only.</div>
          </div>
          <button onClick={handleStopSim}
            className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm">
            Stop
          </button>
        </div>
      )}

      {/* Serial port */}
      <section className="bg-surface-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
          Serial Connection
        </h2>
        <div className="flex gap-2 mb-3">
          <select
            value={selectedPort}
            onChange={e => setSelectedPort(e.target.value)}
            className="flex-1 bg-surface-700 rounded-lg px-3 py-2 text-sm outline-none border border-surface-600 focus:border-accent-blue"
          >
            <option value="">Select port…</option>
            {ports.map(p => (
              <option key={p.path} value={p.path}>
                {p.path} {p.manufacturer ? `— ${p.manufacturer}` : ''}
              </option>
            ))}
          </select>
          <button onClick={refreshPorts}
            className="px-3 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm">
            ↻
          </button>
        </div>

        {error && <p className="text-accent-red text-sm mb-3">{error}</p>}

        <div className="flex gap-2">
          {connected ? (
            <>
              <span className="flex-1 text-accent-green text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent-green inline-block" />
                Connected to {connectedPort}
              </span>
              <button onClick={handleReset}
                className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm">
                Reset Arduino
              </button>
              <button onClick={handleDisconnect}
                className="px-4 py-1.5 rounded-lg bg-accent-red/20 hover:bg-accent-red/40 text-accent-red text-sm">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={handleConnect} disabled={connecting || !selectedPort}
              className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </section>

      {/* Fixture file */}
      <section className="bg-surface-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
          Fixture Configuration
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Leave blank to use the default <code className="bg-surface-700 px-1 rounded">resources/fixtures.json</code>.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="/path/to/fixtures.json"
            value={fixturePath}
            onChange={e => setFixturePath(e.target.value)}
            className="flex-1 bg-surface-700 rounded-lg px-3 py-2 text-sm outline-none border border-surface-600 focus:border-accent-blue font-mono"
          />
          <button onClick={handleLoadFixtures}
            className="px-4 py-2 rounded-lg bg-accent-blue hover:bg-blue-600 text-white text-sm">
            Load
          </button>
        </div>
        {fixtureStatus && (
          <p className={`text-sm ${fixtureStatus.startsWith('Failed') ? 'text-accent-red' : 'text-accent-green'}`}>
            {fixtureStatus}
          </p>
        )}
      </section>

      {/* Keyboard shortcuts */}
      <section className="bg-surface-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
          Keyboard Shortcuts
        </h2>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          {[
            ['SPACE',     'Toggle Blackout'],
            ['ENTER',     'Go (next cue)'],
            ['BACKSPACE', 'Back (prev cue)'],
          ].map(([key, action]) => (
            <React.Fragment key={key}>
              <span className="font-mono bg-surface-700 rounded px-2 py-0.5 text-xs w-fit">{key}</span>
              <span className="text-gray-400">{action}</span>
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  )
}
