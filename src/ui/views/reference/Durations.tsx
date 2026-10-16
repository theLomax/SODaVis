/**
 * Game durations. One card per competition rather than per league spelling of it.
 *
 * A card's minutes are text until its Edit button unlocks it, as the park cards
 * are: no field is live until asked for.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card, StatTile, StatusChip } from '../../components/Tiles'
import { deleteDuration, saveDurations } from '../../../db/repo'
import type { AgeGroupDuration } from '../../../model/reference'
import { seedAgeGroupDurations } from '../../../derive/resolve'
import { durationKey, durationKeyLabel, durationKeyScope, parseAgeGroup } from '../../../derive/ageGroup'
import { CardField, LockableCard, toggledIn } from '../../components/LockableCard'
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
  /** The cards open for editing. Every card starts locked. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
  /** Kept after the request is consumed, so the card stays marked and can be found. */
  const [arrivedAt, setArrivedAt] = useState<string>()
  const arrivedCard = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!focusGroup) return
    setArrivedAt(focusGroup)
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
    arrivedAt != null && (row.key === arrivedAt || row.rawGroups.includes(arrivedAt))

  // The reader arrived to type a number: unlock the card it belongs on, then,
  // once its field exists, scroll to it and focus it.
  const arrivedKey = arrivedAt == null ? undefined : rows.find(isFocused)?.key
  useEffect(() => {
    if (arrivedKey) setUnlocked((u) => new Set(u).add(arrivedKey))
  }, [arrivedKey])
  const arrivedOpen = arrivedKey != null && unlocked.has(arrivedKey)
  useEffect(() => {
    if (!arrivedOpen) return
    arrivedCard.current?.scrollIntoView({ block: 'center' })
    arrivedCard.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
  }, [arrivedOpen])

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
        subtitle="One card per competition rather than per league's spelling of it, so a figure entered once covers every league running the same rules. Extracted from the source string where it states one; the rest need a figure from you. Choose Edit on a card to set its minutes."
        action={
          <Button onClick={() => void reseed()} disabled={busy}>
            Re-extract from source
          </Button>
        }
      >
        <div className="mb-3">
          <TextInput value={filterText} onChange={setFilterText} placeholder="Filter age groups…" width={260} ariaLabel="Filter age groups" />
        </div>
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => {
            const open = unlocked.has(row.key)
            return (
              <LockableCard
                key={row.key}
                data-duration={row.key}
                // The readable label, not the prefixed key: `lg:` is a storage detail
                // and has no business in an accessible name.
                name={row.label}
                badge={row.duration ? null : <StatusChip role="warning" label="not set" />}
                summary={
                  <>
                    {row.games} game{row.games === 1 ? '' : 's'}
                    {/* A rule-set scope answers for every league running it; say so,
                        since that is the difference between one entry and six. */}
                    {row.scope === 'ruleSet' ? ' · rule set' : ''}
                    {row.rawGroups.length > 1 ? (
                      <span title={row.rawGroups.join('\n')}> · {row.rawGroups.length} source spellings</span>
                    ) : null}
                  </>
                }
                unlocked={open}
                onToggle={() => setUnlocked((u) => toggledIn(u, row.key))}
                highlighted={isFocused(row)}
                {...(isFocused(row) ? { cardRef: arrivedCard } : {})}
              >
                <dl className="m-0 grid grid-cols-2 gap-x-3">
                  <CardField label="Minutes">
                    {open ? (
                      <NumberCell
                        value={row.duration?.durationMinutes}
                        fill
                        onCommit={(v) => {
                          if (v !== row.duration?.durationMinutes) void set(row.key, v)
                        }}
                        ariaLabel={`Duration for ${row.label}`}
                      />
                    ) : (
                      (row.duration?.durationMinutes ?? '—')
                    )}
                  </CardField>
                  <CardField label="Source">{row.duration?.origin ?? '—'}</CardField>
                </dl>
              </LockableCard>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
