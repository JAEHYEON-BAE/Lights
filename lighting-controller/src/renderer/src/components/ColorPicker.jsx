import React, { useState, useCallback } from 'react'

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0, s = max === 0 ? 0 : d / max, v = max
  if (max !== min) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return { h: h * 360, s, v }
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s)
  const map = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i]
  return map.map(x => Math.round(x * 255))
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2,'0')).join('')
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return [r, g, b]
}

const PRESETS = [
  [255,0,0],[255,80,0],[255,200,0],[0,255,0],
  [0,150,255],[80,0,255],[255,0,200],[255,255,255],
  [255,150,100],[100,200,255],[0,0,0],[128,128,128],
]

export default function ColorPicker({ r, g, b, onChange, onClose }) {
  const hsv = rgbToHsv(r, g, b)
  const [hue, setHue] = useState(hsv.h)
  const [sat, setSat] = useState(hsv.s)
  const [val, setVal] = useState(hsv.v)

  const emit = useCallback((h, s, v) => {
    const [nr, ng, nb] = hsvToRgb(h, s, v)
    onChange(nr, ng, nb)
  }, [onChange])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface-800 border border-surface-600 rounded-2xl p-5 w-72 shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <span className="font-semibold">Color</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
        </div>

        {/* Hue bar */}
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Hue</label>
          <input type="range" min="0" max="359" step="1"
            value={hue}
            style={{ background: `linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))` }}
            onChange={e => { const h = +e.target.value; setHue(h); emit(h, sat, val) }}
            className="w-full" />
        </div>

        {/* Saturation */}
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Saturation</label>
          <input type="range" min="0" max="1" step="0.01"
            value={sat}
            onChange={e => { const s = +e.target.value; setSat(s); emit(hue, s, val) }}
            className="w-full" />
        </div>

        {/* Brightness */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-1 block">Brightness</label>
          <input type="range" min="0" max="1" step="0.01"
            value={val}
            onChange={e => { const v = +e.target.value; setVal(v); emit(hue, sat, v) }}
            className="w-full" />
        </div>

        {/* RGB sliders */}
        {[['R', r, '#ef4444'], ['G', g, '#10b981'], ['B', b, '#3b82f6']].map(([label, ch, color]) => (
          <div key={label} className="flex items-center gap-2 mb-2">
            <span className="text-xs w-4" style={{ color }}>{label}</span>
            <input type="range" min="0" max="255" step="1"
              value={ch}
              onChange={e => {
                const v = +e.target.value
                const nr = label==='R' ? v : r
                const ng = label==='G' ? v : g
                const nb = label==='B' ? v : b
                const h = rgbToHsv(nr, ng, nb)
                setHue(h.h); setSat(h.s); setVal(h.v)
                onChange(nr, ng, nb)
              }}
              className="flex-1" />
            <span className="text-xs text-gray-500 w-7 text-right">{ch}</span>
          </div>
        ))}

        {/* Hex */}
        <div className="flex items-center gap-2 mt-3 mb-4">
          <span className="text-xs text-gray-500">Hex</span>
          <input
            type="text"
            value={rgbToHex(r, g, b)}
            onChange={e => {
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                const [nr, ng, nb] = hexToRgb(e.target.value)
                const h = rgbToHsv(nr, ng, nb)
                setHue(h.h); setSat(h.s); setVal(h.v)
                onChange(nr, ng, nb)
              }
            }}
            className="flex-1 bg-surface-700 rounded px-2 py-1 text-xs font-mono"
          />
          <div className="w-8 h-6 rounded border border-surface-600"
            style={{ background: rgbToHex(r, g, b) }} />
        </div>

        {/* Presets */}
        <div className="grid grid-cols-6 gap-1">
          {PRESETS.map(([pr, pg, pb], i) => (
            <button key={i}
              style={{ background: rgbToHex(pr, pg, pb) }}
              onClick={() => {
                const h = rgbToHsv(pr, pg, pb)
                setHue(h.h); setSat(h.s); setVal(h.v)
                onChange(pr, pg, pb)
              }}
              className="w-8 h-8 rounded border-2 border-transparent hover:border-white/50 transition-colors"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
