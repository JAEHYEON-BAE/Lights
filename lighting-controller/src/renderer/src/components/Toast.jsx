import React, { useEffect, useState } from 'react'
import useStore from '../store'

export default function Toast() {
  const toast = useStore(s => s.toast)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (toast) {
      setVisible(true)
    } else {
      // Delay removal to allow fade-out animation
      const t = setTimeout(() => setVisible(false), 200)
      return () => clearTimeout(t)
    }
  }, [toast])

  if (!toast && !visible) return null

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-200"
      style={{ opacity: toast ? 1 : 0, transform: `translateX(-50%) translateY(${toast ? 0 : 8}px)` }}
    >
      <div className="bg-surface-600 border border-surface-500 text-white px-5 py-2.5 rounded-xl shadow-2xl text-sm whitespace-nowrap">
        ✓ {toast?.message}
      </div>
    </div>
  )
}
