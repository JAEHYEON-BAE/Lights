import { app, BrowserWindow, ipcMain } from 'electron'
import { join }        from 'path'
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { SerialBridge } from './serial-bridge'

const bridge = new SerialBridge()

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  1100,
    minHeight: 700,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const send = (ch, data) => { if (!win.isDestroyed()) win.webContents.send(ch, data) }

  bridge.on('connected',         (port)   => send('serial:connected', port))
  bridge.on('disconnected',      ()       => send('serial:disconnected'))
  bridge.on('error',             (msg)    => send('serial:error', msg))
  bridge.on('heartbeat',         (data)   => send('serial:heartbeat', data))
  bridge.on('heartbeat-timeout', ()       => send('serial:heartbeat-timeout'))
  bridge.on('blackout',          (active) => send('serial:blackout', active))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Serial IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('serial:list-ports',     ()                => bridge.listAllPorts())
ipcMain.handle('serial:start-simulate', ()                => bridge.startSimulate())
ipcMain.handle('serial:stop-simulate',  ()                => bridge.stopSimulate())
ipcMain.handle('serial:connect',      (_, port)         => bridge.connect(port))
ipcMain.handle('serial:disconnect',   ()                => bridge.disconnect())
ipcMain.handle('serial:set-fixture',  (_, id, r, g, b)  => bridge.setFixture(id, r, g, b))
ipcMain.handle('serial:set-blackout', (_, active)       => bridge.setBlackout(active))
ipcMain.handle('serial:reset',        ()                => bridge.sendReset())
ipcMain.handle('serial:is-connected', ()                => bridge.connected)

// ── File IPC ─────────────────────────────────────────────────────────────────

const resourcesDir = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(__dirname, '../../resources')

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

ipcMain.handle('file:load-fixtures', (_, filePath) => {
  try {
    const p = filePath || join(resourcesDir, 'fixtures.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { return null }
})

ipcMain.handle('file:load-scenes', () => {
  const dir = join(resourcesDir, 'scenes')
  ensureDir(dir)
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')) }
      catch { return null }
    })
    .filter(Boolean)
})

ipcMain.handle('file:save-scene', (_, scene) => {
  const dir = join(resourcesDir, 'scenes')
  ensureDir(dir)
  writeFileSync(join(dir, `${scene.scene_id}.json`), JSON.stringify(scene, null, 2))
  return true
})

ipcMain.handle('file:delete-scene', (_, sceneId) => {
  const p = join(resourcesDir, 'scenes', `${sceneId}.json`)
  if (existsSync(p)) unlinkSync(p)
  return true
})

ipcMain.handle('file:load-cueList', () => {
  const p = join(resourcesDir, 'cue-list.json')
  try { return JSON.parse(readFileSync(p, 'utf-8')) }
  catch { return { version: '1.0', show_name: 'Untitled Show', cues: [] } }
})

ipcMain.handle('file:save-cueList', (_, cueList) => {
  ensureDir(resourcesDir)
  writeFileSync(join(resourcesDir, 'cue-list.json'), JSON.stringify(cueList, null, 2))
  return true
})
