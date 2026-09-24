/**
 * Game durations. One row per competition rather than per league spelling of it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card, StatTile, StatusChip } from '../../components/Tiles'
import { deleteDuration, saveDurations } from '../../../db/repo'
import type { AgeGroupDuration } from '../../../model/reference'
import { seedAgeGroupDurations } from '../../../derive/resolve'
import { durationKey, durationKeyLabel, durationKeyScope, parseAgeGroup } from '../../../derive/ageGroup'
import { NumberCell } from './cells'

export function DurationsEditor() {
  const { derived, reload, pendingFocus, clearPendingFocus } = useStore()
  const [busy, setBusy] = useState(false)
  const [filterText, setFilterText] = useState('')

  /**
   * The age group a warning sent us to.
   *
   * Callers send the raw source string, because that is what a game carries — but a
   * row is now keyed by scope, so the raw string usually is not the row key. The
   * match below therefore accepts either, and a flag raised against one league's
   * spelling still lands on the row that governs it.
   */
  const focusGroup =
    pendingFocus?.view === 'reference' && pendingFocus.tab === 'durations'
      ? pendingFocus.focus
      : undefined
  const focusRow = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    if (!focusGroup) return
    focusRow.current?.scrollIntoView({ block: 'center' })
    focusRow.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
    clearPendingFocus()
  }, [focusGroup, clearPendingFocus])

  /**
   * One row per *scope*, not per raw string.
   *
   * Grouping by the raw string counted 47 age groups where the data holds far
   * fewer real ones, because every league spells the same competition its own way —
   * and it meant entering the same duration once per spelling. A row now keys on
   * `durationKey`, so `USSSA · 10U` is one row covering every league running it,
   * and the strings it stands for are listed with it.
   */
  const rows = useMemo(() => {
    if (!derived) return []
    const stored = new Map(derived.snapshot.durations.map((d) => [d.key, d]))
    const acc = new Map<
      string,
      { key: string; label: string; scope: ReturnType<typeof durationKeyScope>; games: number; rawGroups: Set<string> }
    >()

    for (const r of derived.allResolved) {
      if (!r.game.ageGroupRaw) continue
      const key = durationKey(parseAgeGroup(r.game.ageGroupRaw), r.game.league)
      const row =
        acc.get(key) ??
        {
          key,
          label: durationKeyLabel(key),
          scope: durationKeyScope(key),
          games: 0,
          rawGroups: new Set<string>(),
        }
      row.games++
      row.rawGroups.add(r.game.ageGroupRaw)
      acc.set(key, row)
    }

    return [...acc.values()]
      .map((row) => ({
        ...row,
        rawGroups: [...row.rawGroups].sort(),
        // A figure stored against the scope answers first; one stored against a raw
        // string still counts, which is how pre-decomposition entries keep working.
        duration: stored.get(row.key) ?? [...row.rawGroups].map((g) => stored.get(g)).find(Boolean),
        storedUnderRaw: !stored.has(row.key) && [...row.rawGroups].some((g) => stored.has(g)),
      }))
      .sort((a, b) => {
        // Unfilled first: that is the work to be done.
        const aHas = a.duration ? 1 : 0
        const bHas = b.duration ? 1 : 0
        return aHas - bHas || b.games - a.games
      })
  }, [derived])

  /** True when a navigation target names this row, by scope key or by raw string. */
  const isFocused = (row: { key: string; rawGroups: string[] }) =>
    focusGroup != null && (row.key === focusGroup || row.rawGroups.includes(focusGroup))

  const q = filterText.toLowerCase()
  // Matches the scope label or any raw string it covers, so searching for the
  // spelling you remember still finds the row that governs it.
  const filtered = rows.filter(
    (r) =>
      r.label.toLowerCase().includes(q) ||
      r.rawGroups.some((g) => g.toLowerCase().includes(q)),
  )
  const missing = rows.filter((r) => !r.duration)

  const snapshot = derived?.snapshot

  async function set(key: string, minutes: number | undefined) {
    setBusy(true)
    try {
      // Clearing the field removes the figure rather than storing a zero, so the
      // age group goes back to being reported as needing one.
      if (minutes == null) await deleteDuration(key)
      else {
        const next: AgeGroupDuration = { key, durationMinutes: minutes, origin: 'manual' }
        await saveDurations([next])
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function reseed() {
    if (!snapshot) return
    setBusy(true)
    try {
      const { seeded } = seedAgeGroupDurations(snapshot.games)
      // Only fill gaps: a figure already on record may have been entered by hand.
      await saveDurations(seeded.filter((s) => !snapshot.durations.some((d) => d.key === s.key)))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  if (!derived) return null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Competitions seen"
          value={String(rows.length)}
          detail={`across ${new Set(rows.flatMap((r) => r.rawGroups)).size} source spellings`}
        />
        <StatTile
          label="Needing a duration"
          value={String(missing.length)}
          detail="these games are excluded from every time model"
          {...(missing.length ? { status: { role: 'warning' as const, label: 'Action needed' } } : {})}
        />
        <StatTile
          label="Games affected"
          value={String(missing.reduce((s, r) => s + r.games, 0))}
        />
      </div>

      <Card
        title="Game durations by competition"
        subtitle="One row per competition rather than per league's spelling of it, so a figure entered once covers every league running the same rules. Extracted from the source string where it states one; the rest need a figure from you."
        action={
          <Button onClick={() => void reseed()} disabled={busy}>
            Re-extract from source
          </Button>
        }
      >
        <div className="mb-3">
          <TextInput value={filterText} onChange={setFilterText} placeholder="Filter age groups…" width={260} ariaLabel="Filter age groups" />
        </div>
        <div className="overflow-auto" style={{ maxHeight: 560 }}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Competition', 'Games', 'Minutes', 'Source'].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className="sticky top-0 px-2 py-1.5 font-medium"
                    style={{
                      textAlign: i === 1 || i === 2 ? 'right' : 'left',
                      color: 'var(--text-secondary)',
                      background: 'var(--surface-1)',
                      borderBottom: '1px solid var(--gridline)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.key}
                  {...(isFocused(row) ? { ref: focusRow } : {})}
                  style={{
                    borderBottom: '1px solid var(--gridline)',
                    background: isFocused(row) ? 'var(--gridline)' : undefined,
                  }}
                >
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {row.label}
                    {/* A rule-set scope answers for every league running it; say so,
                        since that is the difference between one entry and six. */}
                    {row.scope === 'ruleSet' ? (
                      <span style={{ color: 'var(--text-muted)' }}> · rule set</span>
                    ) : null}
                    {row.rawGroups.length > 1 ? (
                      <div
                        className="mt-0.5"
                        style={{ color: 'var(--text-muted)', fontSize: 11 }}
                        title={row.rawGroups.join('\n')}
                      >
                        {row.rawGroups.length} source spellings
                      </div>
                    ) : null}
                  </td>
                  <td className="num-tabular px-2 py-1.5 text-right">{row.games}</td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={row.duration?.durationMinutes}
                      onCommit={(v) => void set(row.key, v)}
                      // The readable label, not the prefixed key: `lg:` is a storage detail and
                      // has no business in an accessible name.
                      ariaLabel={`Duration for ${row.label}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {row.duration ? (
                      <span style={{ color: 'var(--text-muted)' }}>{row.duration.origin}</span>
                    ) : (
                      <StatusChip role="warning" label="not set" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
