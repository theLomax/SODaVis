/**
 * Call types. A starting list of rare calls, plus whatever the user adds.
 */

import { useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput, selectStyle } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { deleteCallType, saveCallTypes } from '../../../db/repo'
import { callTypeId } from '../../../model/reference'

export function CallsEditor() {
  const { derived, reload } = useStore()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  if (!derived) return null
  const types = [...derived.snapshot.callTypes].sort((a, b) => a.label.localeCompare(b.label))
  const used = new Map<string, number>()
  for (const g of derived.allResolved) {
    for (const id of g.calls) used.set(id, (used.get(id) ?? 0) + 1)
  }

  async function add() {
    const trimmed = label.trim()
    if (!trimmed) return
    const existing = new Set(types.map((t) => t.id))
    let id = callTypeId(trimmed) || 'call'
    if (existing.has(id)) {
      let n = 2
      while (existing.has(`${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    setBusy(true)
    try {
      await saveCallTypes([{ id, label: trimmed }])
      setLabel('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function rename(id: string, next: string) {
    const trimmed = next.trim()
    const current = types.find((t) => t.id === id)
    if (!current || !trimmed || trimmed === current.label) return
    setBusy(true)
    try {
      await saveCallTypes([{ ...current, label: trimmed }])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await deleteCallType(id)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Call types"
      subtitle="Rare calls to tag on a game. The seed is a starting list — add the ones you actually track."
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {['Call', 'Games tagged', ''].map((h) => (
              <th
                key={h || 'actions'}
                scope="col"
                className="px-2 py-1.5 font-medium"
                style={{
                  textAlign: h === 'Games tagged' ? 'right' : 'left',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--gridline)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
              <td className="px-2 py-1.5">
                <CallLabel value={t.label} ariaLabel={`Name of ${t.label}`} onCommit={(v) => void rename(t.id, v)} />
              </td>
              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                {used.get(t.id) ?? 0}
              </td>
              <td className="px-2 py-1.5 text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(t.id)}
                  aria-label={`Delete ${t.label}`}
                  style={{ color: 'var(--status-critical)' }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            New call
          </span>
          <TextInput value={label} onChange={setLabel} ariaLabel="New call type" width={220} />
        </label>
        <Button onClick={() => void add()} disabled={busy || !label.trim()}>
          Add
        </Button>
      </div>
    </Card>
  )
}

function CallLabel({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string
  onCommit: (v: string) => void
  ariaLabel: string
}) {
  const [text, setText] = useState(value)
  return (
    <input
      type="text"
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      className="w-56 rounded-md px-1.5 py-0.5 text-xs"
      style={selectStyle}
    />
  )
}
