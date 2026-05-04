import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Serial
  listPorts:      ()             => ipcRenderer.invoke('serial:list-ports'),
  startSimulate:  ()             => ipcRenderer.invoke('serial:start-simulate'),
  stopSimulate:   ()             => ipcRenderer.invoke('serial:stop-simulate'),
  connect:     (port)         => ipcRenderer.invoke('serial:connect', port),
  disconnect:  ()             => ipcRenderer.invoke('serial:disconnect'),
  setFixture:  (id, r, g, b) => ipcRenderer.invoke('serial:set-fixture', id, r, g, b),
  setBlackout: (active)       => ipcRenderer.invoke('serial:set-blackout', active),
  reset:       ()             => ipcRenderer.invoke('serial:reset'),
  isConnected: ()             => ipcRenderer.invoke('serial:is-connected'),

  // Serial events
  onConnected:        (cb) => ipcRenderer.on('serial:connected',         (_, d) => cb(d)),
  onDisconnected:     (cb) => ipcRenderer.on('serial:disconnected',      ()    => cb()),
  onError:            (cb) => ipcRenderer.on('serial:error',             (_, d) => cb(d)),
  onHeartbeat:        (cb) => ipcRenderer.on('serial:heartbeat',         (_, d) => cb(d)),
  onHeartbeatTimeout: (cb) => ipcRenderer.on('serial:heartbeat-timeout', ()    => cb()),
  onBlackout:         (cb) => ipcRenderer.on('serial:blackout',          (_, d) => cb(d)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),

  // Files
  loadFixtures: (path) => ipcRenderer.invoke('file:load-fixtures', path),
  loadScenes:   ()     => ipcRenderer.invoke('file:load-scenes'),
  saveScene:    (s)    => ipcRenderer.invoke('file:save-scene', s),
  deleteScene:  (id)   => ipcRenderer.invoke('file:delete-scene', id),
  loadCueList:  ()     => ipcRenderer.invoke('file:load-cueList'),
  saveCueList:  (cl)   => ipcRenderer.invoke('file:save-cueList', cl),
})
