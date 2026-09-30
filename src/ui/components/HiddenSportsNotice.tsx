/**
 * Says when games are being left out because their sport is not tracked, and
 * offers to track it. Without this, untracking a sport — or importing a file
 * whose sport code the app has not met — would make games vanish silently.
 */

import { useState } from 'react'
import { useStore } from '../store'
import { saveSports } from '../../db/repo'

export function HiddenSportsNotice() {
  const { derived, reload } = useStore()
  const [busy, setBusy] = useState(false)
  const hidden = derived?.hiddenSports ?? []
  if (!derived || hidden.length === 0) return null
  const total = hidden.reduce((n, h) => n + h.games, 0)

  async function track(code: string) {
    setBusy(true)
    try {
      const existing = derived!.snapshot.sports.find((s) => s.code === code)
      // A code the app has never seen becomes a sport of its own, named by its
      // code until renamed, with middling prep and wrap to edit later.
      await saveSports([
        existing
          ? { ...existing, tracked: true }
          : { code, label: code, prepMinutes: 20, wrapMinutes: 10, tracked: true },
      ])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-xs"
      style={{ borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-secondary)' }}
    >
      <span>
        {total} game{total === 1 ? '' : 's'} in sports you don't track {total === 1 ? 'is' : 'are'} hidden
        here (the Tax view still counts {total === 1 ? 'it' : 'them'}):
      </span>
      {hidden.map((h) => (
        <button
          key={h.code}
          type="button"
          disabled={busy}
          onClick={() => void track(h.code)}
          className="rounded-md px-2 py-0.5"
          style={{ border: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}
          title={h.known ? undefined : `"${h.code}" is a sport code the app has not seen; tracking it adds it as a sport you can rename under Reference data.`}
        >
          Track {h.label} ({h.games})
        </button>
      ))}
    </div>
  )
}
