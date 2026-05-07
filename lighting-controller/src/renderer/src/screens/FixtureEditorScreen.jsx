import React, { useState, useEffect, useMemo } from 'react'
import useStore from '../store'

const FIXTURE_PRESETS = {
  rgb_par_3ch: {
    label: 'RGB PAR (3ch)',
    channels: { red: 0, green: 1, blue: 2 },
  },
  rgb_par_7ch: {
    label: 'RGB PAR (7ch)',
    channels: { dimmer: 0, red: 1, green: 2, blue: 3, strobe: 4, mode: 5, speed: 6 },
  },
  rgb_led_4ch: {
    label: 'RGB LED (4ch)',
    channels: { dimmer: 0, red: 1, green: 2, blue: 3 },
  },
  rgba_8ch: {
    label: 'RGBA (8ch)',
    channels: { dimmer: 0, red: 1, green: 2, blue: 3, amber: 4, strobe: 5, mode: 6, speed: 7 },
  },
}

const EMPTY_FIXTURE_FORM = { name: '', type: 'rgb_par_7ch', dmx_base: 1, group: '' }
const EMPTY_GROUP_FORM   = { name: '', color: '#3B82F6' }

export default function FixtureEditorScreen() {
  const storeFixtures    = useStore(s => s.fixtures)
  const storeGroups      = useStore(s => s.groups)
  const saveFixturesToStore = useStore(s => s.saveFixtures)

  const [localFixtures, setLocalFixtures] = useState([])
  const [localGroups,   setLocalGroups]   = useState([])

  // panel: null | 'add-fixture' | 'edit-fixture' | 'add-group' | 'edit-group'
  const [panel,          setPanel]          = useState(null)
  const [editingFixture, setEditingFixture] = useState(null)
  const [editingGroup,   setEditingGroup]   = useState(null)
  const [fixtureForm,    setFixtureForm]    = useState(EMPTY_FIXTURE_FORM)
  const [groupForm,      setGroupForm]      = useState(EMPTY_GROUP_FORM)

  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null) // { ok: bool, msg: string }

  useEffect(() => {
    setLocalFixtures(storeFixtures)
    setLocalGroups(storeGroups)
  }, [])

  // ── DMX conflict detection ────────────────────────────────────────────────
  const dmxConflicts = useMemo(() => {
    const occupied  = new Map()
    const conflicts = new Set()
    localFixtures.forEach(f => {
      const chCount = Object.keys(f.channels ?? {}).length
      for (let i = 0; i < chCount; i++) {
        const addr = f.dmx_base + i
        if (occupied.has(addr)) {
          conflicts.add(f.id)
          conflicts.add(occupied.get(addr))
        } else {
          occupied.set(addr, f.id)
        }
      }
    })
    return conflicts
  }, [localFixtures])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const groupById = (id) => localGroups.find(g => g.id === id)

  // ── Fixture actions ───────────────────────────────────────────────────────
  const openAddFixture = () => {
    setEditingFixture(null)
    setFixtureForm(EMPTY_FIXTURE_FORM)
    setPanel('fixture')
  }

  const openEditFixture = (f) => {
    setEditingFixture(f)
    setFixtureForm({ name: f.name, type: f.type, dmx_base: f.dmx_base, group: f.group ?? '' })
    setPanel('fixture')
  }

  const commitFixture = () => {
    if (!fixtureForm.name.trim()) return
    const fixture = {
      id:       editingFixture != null
                  ? editingFixture.id
                  : Math.max(-1, ...localFixtures.map(f => f.id)) + 1,
      name:     fixtureForm.name.trim(),
      type:     fixtureForm.type,
      dmx_base: Number(fixtureForm.dmx_base),
      channels: FIXTURE_PRESETS[fixtureForm.type]?.channels ?? {},
      group:    fixtureForm.group || null,
    }
    setLocalFixtures(prev =>
      editingFixture != null
        ? prev.map(f => f.id === fixture.id ? fixture : f)
        : [...prev, fixture]
    )
    setPanel(null)
  }

  const deleteFixture = (id) => {
    setLocalFixtures(prev => prev.filter(f => f.id !== id))
    if (editingFixture?.id === id) setPanel(null)
  }

  // ── Group actions ─────────────────────────────────────────────────────────
  const openAddGroup = () => {
    setEditingGroup(null)
    setGroupForm(EMPTY_GROUP_FORM)
    setPanel('group')
  }

  const openEditGroup = (g) => {
    setEditingGroup(g)
    setGroupForm({ name: g.name, color: g.color })
    setPanel('group')
  }

  const commitGroup = () => {
    if (!groupForm.name.trim()) return
    const group = {
      id:    editingGroup != null
               ? editingGroup.id
               : groupForm.name.trim().toLowerCase().replace(/\s+/g, '_'),
      name:  groupForm.name.trim(),
      color: groupForm.color,
    }
    setLocalGroups(prev =>
      editingGroup != null
        ? prev.map(g => g.id === group.id ? group : g)
        : [...prev, group]
    )
    setPanel(null)
  }

  const deleteGroup = (groupId) => {
    setLocalFixtures(prev => prev.map(f => f.group === groupId ? { ...f, group: null } : f))
    setLocalGroups(prev => prev.filter(g => g.id !== groupId))
    if (editingGroup?.id === groupId) setPanel(null)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await saveFixturesToStore({ version: '1.0', fixtures: localFixtures, groups: localGroups })
      setStatus({ ok: true, msg: `Saved ${localFixtures.length} fixture(s).` })
    } catch (e) {
      setStatus({ ok: false, msg: 'Save failed: ' + (e.message || String(e)) })
    } finally {
      setSaving(false)
    }
  }

  // ── Shared input class ────────────────────────────────────────────────────
  const inputCls = 'bg-surface-800 rounded-lg px-3 py-2 text-sm text-white outline-none border border-surface-600 focus:border-accent-blue'

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Fixture Editor</h1>
          <p className="text-xs text-gray-500 mt-1">
            Edit fixtures and groups below. Click <strong>Save to disk</strong> to persist changes.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {dmxConflicts.size > 0 && (
            <p className="text-xs text-accent-red">
              ⚠ {dmxConflicts.size} fixture(s) have overlapping DMX channels
            </p>
          )}
          {status && (
            <p className={`text-xs ${status.ok ? 'text-accent-green' : 'text-accent-red'}`}>
              {status.msg}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-accent-blue hover:bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save to disk'}
          </button>
        </div>
      </div>

      {/* ── Groups ─────────────────────────────────────────────────────── */}
      <section className="bg-surface-800 rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Groups</h2>
          <button
            onClick={openAddGroup}
            className="px-3 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-gray-300"
          >
            + Add Group
          </button>
        </div>

        {localGroups.length === 0 ? (
          <p className="text-xs text-gray-600">No groups defined.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {localGroups.map(g => (
              <div key={g.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-700 group">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: g.color }} />
                <span className="flex-1 text-sm">{g.name}</span>
                <span className="text-xs font-mono text-gray-600">{g.id}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditGroup(g)}
                    className="px-2 py-0.5 rounded bg-surface-600 hover:bg-surface-500 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteGroup(g.id)}
                    className="px-2 py-0.5 rounded bg-accent-red/20 hover:bg-accent-red/40 text-accent-red text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Group edit panel */}
        {panel === 'group' && (
          <div className="bg-surface-700 border border-surface-600 rounded-xl p-4 flex flex-col gap-3 mt-1">
            <h3 className="text-sm font-semibold">{editingGroup ? 'Edit Group' : 'Add Group'}</h3>

            <label className="flex flex-col gap-1 text-xs text-gray-400">
              Name
              <input
                type="text"
                value={groupForm.name}
                onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Stage Left"
                className={inputCls}
                autoFocus
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-gray-400">
              Color
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={groupForm.color}
                  onChange={e => setGroupForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-8 rounded cursor-pointer bg-surface-800 border border-surface-600"
                />
                <span className="font-mono text-sm text-white">{groupForm.color}</span>
              </div>
            </label>

            {!editingGroup && groupForm.name.trim() && (
              <p className="text-xs text-gray-500 font-mono">
                id: {groupForm.name.trim().toLowerCase().replace(/\s+/g, '_')}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={commitGroup}
                className="px-4 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-600 text-white text-sm font-semibold">
                {editingGroup ? 'Update' : 'Add'}
              </button>
              <button onClick={() => setPanel(null)}
                className="px-4 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-600 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Fixtures ───────────────────────────────────────────────────── */}
      <section className="bg-surface-800 rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Fixtures</h2>
          <button
            onClick={openAddFixture}
            className="px-3 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-gray-300"
          >
            + Add Fixture
          </button>
        </div>

        {localFixtures.length === 0 ? (
          <p className="text-xs text-gray-600">No fixtures defined.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-surface-700">
                <th className="text-left pb-2 font-medium w-8">ID</th>
                <th className="text-left pb-2 font-medium">Name</th>
                <th className="text-left pb-2 font-medium">Type</th>
                <th className="text-left pb-2 font-medium w-20">DMX Base</th>
                <th className="text-left pb-2 font-medium">Group</th>
                <th className="pb-2 w-28" />
              </tr>
            </thead>
            <tbody>
              {localFixtures.map(f => {
                const conflict = dmxConflicts.has(f.id)
                const grp = groupById(f.group)
                return (
                  <tr
                    key={f.id}
                    className={`border-b border-surface-700/50 group ${conflict ? 'bg-accent-red/10' : 'hover:bg-surface-700/40'}`}
                  >
                    <td className="py-2 pr-3 font-mono text-gray-500">{f.id}</td>
                    <td className="py-2 pr-3">
                      <span>{f.name}</span>
                      {conflict && <span className="ml-2 text-accent-red text-xs">⚠ DMX overlap</span>}
                    </td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">
                      {FIXTURE_PRESETS[f.type]?.label ?? f.type}
                    </td>
                    <td className="py-2 pr-3 font-mono">{f.dmx_base}</td>
                    <td className="py-2 pr-3">
                      {grp ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ background: grp.color + '55', border: `1px solid ${grp.color}88` }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: grp.color }} />
                          {grp.name}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        <button
                          onClick={() => openEditFixture(f)}
                          className="px-2 py-0.5 rounded bg-surface-600 hover:bg-surface-500 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteFixture(f.id)}
                          className="px-2 py-0.5 rounded bg-accent-red/20 hover:bg-accent-red/40 text-accent-red text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Fixture edit panel */}
        {panel === 'fixture' && (
          <div className="bg-surface-700 border border-surface-600 rounded-xl p-4 flex flex-col gap-3 mt-1">
            <h3 className="text-sm font-semibold">{editingFixture ? 'Edit Fixture' : 'Add Fixture'}</h3>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-gray-400 col-span-2">
                Name
                <input
                  type="text"
                  value={fixtureForm.name}
                  onChange={e => setFixtureForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Stage Left 1"
                  className={inputCls}
                  autoFocus
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Fixture Type
                <select
                  value={fixtureForm.type}
                  onChange={e => setFixtureForm(f => ({ ...f, type: e.target.value }))}
                  className={inputCls}
                >
                  {Object.entries(FIXTURE_PRESETS).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-gray-400">
                DMX Base Channel (1–512)
                <input
                  type="number"
                  min={1}
                  max={512}
                  value={fixtureForm.dmx_base}
                  onChange={e => setFixtureForm(f => ({ ...f, dmx_base: e.target.value }))}
                  className={inputCls}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-gray-400 col-span-2">
                Group
                <select
                  value={fixtureForm.group}
                  onChange={e => setFixtureForm(f => ({ ...f, group: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">— No group —</option>
                  {localGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {FIXTURE_PRESETS[fixtureForm.type] && (
              <p className="text-xs text-gray-500">
                Channels: {Object.entries(FIXTURE_PRESETS[fixtureForm.type].channels)
                  .map(([ch, offset]) => `${ch}+${offset}`)
                  .join(', ')}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={commitFixture}
                disabled={!fixtureForm.name.trim()}
                className="px-4 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {editingFixture ? 'Update' : 'Add'}
              </button>
              <button
                onClick={() => setPanel(null)}
                className="px-4 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-600 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
