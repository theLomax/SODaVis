/**
 * Identity patterns. Names carry a rotating season suffix, so matching is by
 * pattern rather than by exact string.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { saveIdentity } from '../../../db/repo'
import { matchesIdentity } from '../../../import/transforms'

export function IdentityEditor() {
  const { derived, reload } = useStore()
  const [patterns, setPatterns] = useState<string[]>(() => derived?.snapshot.identity.patterns ?? [])
  const [displayName, setDisplayName] = useState(derived?.snapshot.identity.displayName ?? '')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    if (!derived) return { matched: 0, total: 0, unmatchedSamples: [] as string[] }
    const test = (name: string) => matchesIdentity(name, patterns)
    let matched = 0
    const unmatched = new Set<string>()
    for (const r of derived.allResolved) {
      if (r.game.assignments.some((a) => test(a.official))) matched++
      else for (const a of r.game.assignments) unmatched.add(a.official)
    }
    return {
      matched,
      total: derived.allResolved.length,
      unmatchedSamples: [...unmatched].slice(0, 6),
    }
  }, [derived, patterns])

  if (!derived) return null

  const invalid = patterns.filter((p) => {
    try {
      new RegExp(p)
      return false
    } catch {
      return true
    }
  })

  return (
    <Card
      title="Your identity in source files"
      subtitle="Names carry a rotating season suffix, so matching is by pattern rather than by exact string"
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Display name
          </span>
          <TextInput value={displayName} onChange={setDisplayName} width={240} ariaLabel="Display name" />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Patterns (regular expressions, case-insensitive)
          </span>
          {patterns.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextInput
                value={p}
                onChange={(v) => setPatterns((ps) => ps.map((x, j) => (j === i ? v : x)))}
                width={320}
                ariaLabel={`Identity pattern ${i + 1}`}
              />
              <Button variant="danger" onClick={() => setPatterns((ps) => ps.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <TextInput value={draft} onChange={setDraft} placeholder="^Surname\\b.*\\bForename$" width={320} ariaLabel="New pattern" />
            <Button
              onClick={() => {
                if (draft.trim()) {
                  setPatterns((ps) => [...ps, draft.trim()])
                  setDraft('')
                }
              }}
            >
              Add pattern
            </Button>
          </div>
        </div>

        {invalid.length > 0 ? (
          <StatusChip role="serious" label={`${invalid.length} pattern(s) are not valid regular expressions`} />
        ) : null}

        <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Matches you on {preview.matched} of {preview.total} games.
          {preview.matched < preview.total
            ? ` Unmatched officials include: ${preview.unmatchedSamples.join(', ')}.`
            : ' Every game resolves.'}
        </p>

        <div>
          <Button
            variant="primary"
            disabled={busy || invalid.length > 0}
            onClick={async () => {
              setBusy(true)
              try {
                await saveIdentity({ id: 'self', patterns, displayName })
                await reload()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Saving…' : 'Save identity'}
          </Button>
        </div>
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          Saving re-resolves every stored game at once: which slot is yours, and so who your
          partners were, is worked out from these patterns each time the data is read. No
          re-import is needed.
        </p>
      </div>
    </Card>
  )
}
