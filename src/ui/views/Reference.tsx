/**
 * Reference data editors. This is the user's own knowledge, and it is the part
 * the spreadsheet could never keep straight — mileage and tolls that disagreed
 * between sheets, durations buried in formula chains.
 *
 * Nothing here is ever written by an import.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card, StatTile, StatusChip } from '../components/Tiles'
import {
  deleteDuration,
  deletePark,
  mergeParks,
  saveDurations,
  saveGearLevels,
  saveGearModifiers,
  saveIdentity,
  saveParks,
  saveSettings,
  saveSports,
} from '../../db/repo'
import { exportBackup, backupToBlob, backupFileName, restoreBackup, validateBackup } from '../../db/backup'
import { Dialog } from '../components/Dialog'
import type { AgeGroupDuration, Park } from '../../model/reference'
import { resolvePark, seedAgeGroupDurations, stripFieldDesignator } from '../../derive/resolve'
import {
  durationKey,
  durationKeyLabel,
  durationKeyScope,
  parseAgeGroup,
} from '../../derive/ageGroup'
import { matchesIdentity, minutesToTime, timeToMinutes } from '../../import/transforms'

type Tab = 'parks' | 'durations' | 'sports' | 'identity' | 'settings' | 'backup'

const TABS: { id: Tab; label: string }[] = [
  { id: 'parks', label: 'Parks & mileage' },
  { id: 'durations', label: 'Game durations' },
  { id: 'sports', label: 'Sports & gear' },
  { id: 'identity', label: 'Identity' },
  { id: 'settings', label: 'Settings' },
  { id: 'backup', label: 'Backup' },
]

export function Reference() {
  const { pendingFocus } = useStore()
  const [tab, setTab] = useState<Tab>('parks')

  /**
   * A navigation into this view names the tab the field lives on. Adopting it in
   * an effect rather than as initial state means arriving here a second time, from
   * a different warning, still switches tabs.
   *
   * The focus itself is left in the store for the editor below to consume — it is
   * the only thing that knows how to find its own row.
   */
  const wantedTab = pendingFocus?.view === 'reference' ? pendingFocus.tab : undefined
  useEffect(() => {
    if (wantedTab) setTab(wantedTab)
  }, [wantedTab])

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-md px-3 py-1.5 text-xs"
            style={{
              background: tab === t.id ? 'var(--gridline)' : 'transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'parks' ? <ParksEditor /> : null}
      {tab === 'durations' ? <DurationsEditor /> : null}
      {tab === 'sports' ? <SportsEditor /> : null}
      {tab === 'identity' ? <IdentityEditor /> : null}
      {tab === 'settings' ? <SettingsEditor /> : null}
      {tab === 'backup' ? <BackupPanel /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parks
// ---------------------------------------------------------------------------

function ParksEditor() {
  const { derived, reload, pendingFocus, clearPendingFocus } = useStore()
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeInto, setMergeInto] = useState('')
  const [busy, setBusy] = useState(false)

  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of derived?.allResolved ?? []) {
      if (r.parkId) counts.set(r.parkId, (counts.get(r.parkId) ?? 0) + 1)
    }
    return counts
  }, [derived])

  /** The park id a warning sent us to, consumed once so a rerender does not re-scroll. */
  const focusPark =
    pendingFocus?.view === 'reference' && pendingFocus.tab === 'parks' ? pendingFocus.focus : undefined
  const focusRow = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    if (!focusPark) return
    focusRow.current?.scrollIntoView({ block: 'center' })
    // Focus the field itself, not just the row: the reader arrived to type a number.
    focusRow.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
    clearPendingFocus()
  }, [focusPark, clearPendingFocus])

  const unmatched = useMemo(() => {
    const byVenue = new Map<string, number>()
    for (const r of derived?.allResolved ?? []) {
      if (r.parkId === null) byVenue.set(r.game.venueRaw, (byVenue.get(r.game.venueRaw) ?? 0) + 1)
    }
    return [...byVenue.entries()].sort((a, b) => b[1] - a[1])
  }, [derived])

  if (!derived) return null

  /**
   * A park with games but no mileage is the work to be done: every trip there is
   * missing from the mileage total, and drops out of two of the three time models
   * for want of a drive figure. Those rows sort first and carry a marker, so the
   * gap is visible without reading down a column of blank inputs. A park with no
   * games needs nothing, so it is not marked.
   */
  const needsMiles = (p: Park) => p.oneWayMiles == null && (usage.get(p.id) ?? 0) > 0

  const parks = [...derived.snapshot.parks].sort(
    (a, b) =>
      Number(needsMiles(b)) - Number(needsMiles(a)) || a.name.localeCompare(b.name),
  )
  const incompleteParks = parks.filter(needsMiles)

  async function update(park: Park, patch: Partial<Park>) {
    setBusy(true)
    try {
      await saveParks([{ ...park, ...patch }])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function addAliasFor(parkId: string, venue: string) {
    const park = parks.find((p) => p.id === parkId)
    if (!park) return
    await update(park, { aliases: [...new Set([...park.aliases, venue])] })
  }

  async function createParkFrom(venue: string) {
    setBusy(true)
    try {
      const name = stripFieldDesignator(venue) || venue
      const id = `park_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      await saveParks([{ id, name, aliases: [venue], venuePatterns: [`${name}*`] }])
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {unmatched.length > 0 ? (
        <Card
          title="Unmatched venues"
          subtitle="These never become their own park automatically — resolve each one so its mileage is right"
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {unmatched.map(([venue, count]) => (
              <li key={venue} className="flex flex-wrap items-center gap-2 text-xs">
                <StatusChip role="serious" label={`${count} game${count === 1 ? '' : 's'}`} />
                <span style={{ color: 'var(--text-primary)' }}>{venue}</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) void addAliasFor(e.target.value, venue)
                  }}
                  className="rounded-md px-2 py-1 text-xs"
                  style={selectStyle}
                  aria-label={`Assign ${venue} to a park`}
                >
                  <option value="">Add as alias of…</option>
                  {parks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button onClick={() => void createParkFrom(venue)} disabled={busy}>
                  Create park
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title={`${parks.length} parks`}
        subtitle={
          incompleteParks.length > 0
            ? `One-way miles; round-trip is computed. ${incompleteParks.length} park${
                incompleteParks.length === 1 ? ' has' : 's have'
              } games but no mileage — those rows come first, and every trip there is untimed until a figure is entered.`
            : 'One-way miles; round-trip is computed. Two drive figures, because the legs differ: the outbound uses the rush time for a weekday evening arrival, the return always uses the ideal. Tolls are the round-trip estimate.'
        }
      >
        <div className="overflow-auto" style={{ maxHeight: 560 }}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {[
                  'Park',
                  'City',
                  'Games',
                  'One-way mi',
                  'Min (ideal)',
                  'Min (rush)',
                  'Tolls',
                  'Aliases',
                  'Patterns',
                  '',
                ].map(
                  (h, i) => (
                    <th
                      key={h || `sp-${i}`}
                      scope="col"
                      className="sticky top-0 px-2 py-1.5 font-medium"
                      style={{
                        textAlign: i >= 2 && i <= 6 ? 'right' : 'left',
                        color: 'var(--text-secondary)',
                        background: 'var(--surface-1)',
                        borderBottom: '1px solid var(--gridline)',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {parks.map((park) => (
                <tr
                  key={park.id}
                  {...(park.id === focusPark ? { ref: focusRow } : {})}
                  style={{
                    borderBottom: '1px solid var(--gridline)',
                    // The row the reader was sent to, held until they navigate again.
                    background: park.id === focusPark ? 'var(--gridline)' : undefined,
                  }}
                >
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    <span className="flex flex-wrap items-center gap-2">
                      {park.name}
                      {needsMiles(park) ? (
                        <StatusChip
                          role="warning"
                          label="no mileage"
                          title={`${usage.get(park.id)} games here have no distance on record`}
                        />
                      ) : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <TextCell
                      value={park.city}
                      onCommit={(v) => void update(park, { city: v })}
                      ariaLabel={`City for ${park.name}`}
                    />
                  </td>
                  <td className="num-tabular px-2 py-1.5 text-right">{usage.get(park.id) ?? 0}</td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={park.oneWayMiles}
                      step="0.1"
                      onCommit={(v) => void update(park, { oneWayMiles: v })}
                      ariaLabel={`One-way miles for ${park.name}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={park.oneWayDriveMinutes}
                      onCommit={(v) => void update(park, { oneWayDriveMinutes: v })}
                      ariaLabel={`Ideal one-way drive minutes for ${park.name}`}
                    />
                  </td>
                  {/* The return leg always uses the ideal figure, so this one only
                      ever applies outbound. Left blank where traffic makes no real
                      difference to this park. */}
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={park.oneWayDriveMinutesRush}
                      onCommit={(v) => void update(park, { oneWayDriveMinutesRush: v })}
                      ariaLabel={`Rush-hour one-way drive minutes for ${park.name}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={park.tollEstimate}
                      step="0.01"
                      onCommit={(v) => void update(park, { tollEstimate: v })}
                      ariaLabel={`Toll estimate for ${park.name}`}
                    />
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)', maxWidth: 220 }}>
                    {park.aliases.join(' · ') || '—'}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)', maxWidth: 180 }}>
                    {park.venuePatterns.join(' · ') || '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {(usage.get(park.id) ?? 0) === 0 ? (
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await deletePark(park.id)
                          await reload()
                        }}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {parks.some((p) => p.notes) ? (
          <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
            {parks
              .filter((p) => p.notes)
              .map((p) => (
                <li key={p.id} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {p.name}: {p.notes}
                </li>
              ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Merge two parks" subtitle="Folds one park's aliases and patterns into another, then removes it">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Keep
            </span>
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="rounded-md px-2 py-1 text-xs" style={selectStyle}>
              <option value="">—</option>
              {parks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Merge and remove
            </span>
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="rounded-md px-2 py-1 text-xs" style={selectStyle}>
              <option value="">—</option>
              {parks.filter((p) => p.id !== mergeInto).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            disabled={!mergeInto || !mergeFrom || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await mergeParks(mergeInto, mergeFrom)
                setMergeFrom('')
                await reload()
              } finally {
                setBusy(false)
              }
            }}
          >
            Merge
          </Button>
        </div>
      </Card>
    </div>
  )
}

/**
 * The seeded city is only ever a guess from the park's name, so it has to be
 * correctable in the app: seeding is skipped once the parks table exists, and a
 * fix in source would never reach an installed copy.
 */
function TextCell({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string | undefined
  onCommit: (v: string | undefined) => void
  ariaLabel: string
}) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      type="text"
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text.trim() || undefined)}
      className="w-28 rounded-md px-1.5 py-0.5 text-xs"
      style={selectStyle}
    />
  )
}

function NumberCell({
  value,
  onCommit,
  step,
  ariaLabel,
}: {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  step?: string
  ariaLabel: string
}) {
  const [text, setText] = useState(value?.toString() ?? '')
  return (
    <input
      type="number"
      {...(step ? { step } : {})}
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text)
        onCommit(text.trim() && Number.isFinite(n) ? n : undefined)
      }}
      className="num-tabular w-20 rounded-md px-1.5 py-0.5 text-right text-xs"
      style={selectStyle}
    />
  )
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

function DurationsEditor() {
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

// ---------------------------------------------------------------------------
// Sports & gear
// ---------------------------------------------------------------------------

function SportsEditor() {
  const { derived, reload } = useStore()
  if (!derived) return null
  const { sports, gearLevels, gearModifiers } = derived.snapshot

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Sports"
        subtitle="Prep and wrap are charged once per trip. The arrival floor in Settings is a minimum on prep."
      >
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Code', 'Label', 'Prep min', 'Wrap min', 'Default gear'].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className="px-2 py-1.5 font-medium"
                  style={{
                    textAlign: i === 2 || i === 3 ? 'right' : 'left',
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
            {sports.map((sport) => (
              <tr key={sport.code} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {sport.code}
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {sport.label}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={sport.prepMinutes}
                    ariaLabel={`Prep minutes for ${sport.label}`}
                    onCommit={async (v) => {
                      await saveSports([{ ...sport, prepMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={sport.wrapMinutes}
                    ariaLabel={`Wrap minutes for ${sport.label}`}
                    onCommit={async (v) => {
                      await saveSports([{ ...sport, wrapMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={sport.defaultGearLevel}
                    onChange={async (e) => {
                      await saveSports([
                        { ...sport, defaultGearLevel: e.target.value as typeof sport.defaultGearLevel },
                      ])
                      await reload()
                    }}
                    className="rounded-md px-2 py-1 text-xs"
                    style={selectStyle}
                    aria-label={`Default gear for ${sport.label}`}
                  >
                    {gearLevels.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Positions"
        subtitle="The position itself, independent of what it takes to dress for it — that is below"
      >
        <table className="w-full border-collapse text-xs">
          <tbody>
            {gearLevels.map((level) => (
              <tr key={level.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {level.label}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={level.prepDeltaMinutes}
                    ariaLabel={`Prep delta for ${level.label}`}
                    onCommit={async (v) => {
                      await saveGearLevels([{ ...level, prepDeltaMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  minutes added for the position itself
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Conditions are a second, independent axis: the role says what was worked,
          these say what it took to be ready for it. They stack, so a cold, wet
          plate game carries all three deltas. */}
      <Card
        title="Gear"
        subtitle="What was worn, independent of the position. Full gear is assumed at the plate, and available at the bases — some two-umpire games put the base umpire in it too."
      >
        <table className="w-full border-collapse text-xs">
          <tbody>
            {gearModifiers.map((mod) => (
              <tr key={mod.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {mod.label}
                  {mod.plateOnly ? (
                    <span style={{ color: 'var(--text-muted)' }}> · plate only</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <NumberCell
                    value={mod.prepDeltaMinutes}
                    ariaLabel={`Prep delta for ${mod.label}`}
                    onCommit={async (v) => {
                      await saveGearModifiers([{ ...mod, prepDeltaMinutes: v ?? 0 }])
                      await reload()
                    }}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                  {mod.hint}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function IdentityEditor() {
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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Indexed 0 = Monday, matching `RushHourWindow.weekdays`. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * What the window currently costs, in legs rather than trips — a trip can be in
 * traffic one way, both, or neither. Shown beside the control because the setting
 * changes computed figures without changing any data, so its effect is otherwise
 * invisible until someone opens a trip.
 */
function RushHourEffect() {
  const { derived } = useStore()
  if (!derived) return null

  const trips = derived.trips
  const out = trips.filter((t) => t.outboundInRush).length
  const home = trips.filter((t) => t.returnInRush).length
  const both = trips.filter((t) => t.outboundInRush && t.returnInRush).length
  // A park with no rush figure uses its ideal one both ways, so a leg in the
  // window only costs anything once that figure exists.
  const applied = trips.filter((t) => t.driveMinutesSource === 'park-rush').length

  if (trips.length === 0) return null

  return (
    <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
      In the current range: {out} trip{out === 1 ? '' : 's'} drive out through it,{' '}
      {home} drive home through it
      {both > 0 ? `, ${both} both ways` : ''}.{' '}
      {applied === 0
        ? 'No park has a rush-hour figure yet, so this changes nothing until one is entered in Parks & mileage.'
        : `${applied} trip${applied === 1 ? '' : 's'} currently use a park's rush-hour figure.`}
    </p>
  )
}

function SettingsEditor() {
  const { derived, reload, theme, setTheme } = useStore()
  const [busy, setBusy] = useState(false)
  const [rateYear, setRateYear] = useState('')
  const [rateValue, setRateValue] = useState('')

  if (!derived) return null
  const s = derived.snapshot.settings

  async function patch(next: Partial<typeof s>) {
    setBusy(true)
    try {
      await saveSettings({ ...s, ...next })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Home origin label
            </span>
            <TextInput
              value={s.homeOriginLabel}
              onChange={(v) => void patch({ homeOriginLabel: v })}
              width={200}
              ariaLabel="Home origin label"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Fallback speed for drive-time estimates (mph)
            </span>
            <NumberCell value={s.fallbackMph} onCommit={(v) => void patch({ fallbackMph: v ?? 35 })} ariaLabel="Fallback mph" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Arrival floor before first pitch (minutes)
            </span>
            <NumberCell
              value={s.arrivalFloorMinutes}
              onCommit={(v) => void patch({ arrivalFloorMinutes: v ?? 15 })}
              ariaLabel="Arrival floor minutes"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Preferred time model
            </span>
            <select
              value={s.preferredTimeModel}
              onChange={(e) => void patch({ preferredTimeModel: e.target.value as typeof s.preferredTimeModel })}
              className="rounded-md px-2 py-1 text-xs"
              style={selectStyle}
            >
              <option value="game">Game time</option>
              <option value="game-drive">Game + drive</option>
              <option value="committed">Committed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Appearance
            </span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'system' | 'light' | 'dark')}
              className="rounded-md px-2 py-1 text-xs"
              style={selectStyle}
            >
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </Card>

      {/* The window is the one setting that changes a figure without changing any
          data, so it says which way each leg is affected rather than leaving the
          reader to infer it from two times and a row of day boxes. */}
      <Card
        title="Rush hour"
        subtitle="Each leg of a trip is judged on its own clock: the drive out by the first pitch, the drive home by the last out. A park's rush-hour figure is used for whichever legs land in this window."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                From
              </span>
              <input
                type="time"
                value={minutesToTime(s.rushHour.startMinutes)}
                disabled={busy}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value)
                  if (m != null) void patch({ rushHour: { ...s.rushHour, startMinutes: m } })
                }}
                aria-label="Rush hour start"
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Until
              </span>
              <input
                type="time"
                value={minutesToTime(s.rushHour.endMinutes)}
                disabled={busy}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value)
                  if (m != null) void patch({ rushHour: { ...s.rushHour, endMinutes: m } })
                }}
                aria-label="Rush hour end"
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
              />
            </label>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Start is included, end is not.
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Days it applies to
            </span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, i) => (
                <label key={label} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={s.rushHour.weekdays.includes(i)}
                    disabled={busy}
                    onChange={(e) => {
                      const next = new Set(s.rushHour.weekdays)
                      if (e.target.checked) next.add(i)
                      else next.delete(i)
                      void patch({
                        rushHour: { ...s.rushHour, weekdays: [...next].sort((a, b) => a - b) },
                      })
                    }}
                    aria-label={`Rush hour applies on ${label}`}
                  />
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <RushHourEffect />
        </div>
      </Card>

      <Card
        title="IRS standard mileage rate"
        subtitle="Set per calendar year; the tax view uses the rate for the year it is showing"
      >
        <table className="w-full border-collapse text-xs" style={{ maxWidth: 360 }}>
          <tbody>
            {Object.entries(s.irsMileageRateByYear)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([year, rate]) => (
                <tr key={year} style={{ borderBottom: '1px solid var(--gridline)' }}>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {year}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <NumberCell
                      value={rate}
                      step="0.001"
                      ariaLabel={`Mileage rate for ${year}`}
                      onCommit={(v) =>
                        void patch({
                          irsMileageRateByYear: { ...s.irsMileageRateByYear, [year]: v ?? 0 },
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                    per mile
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextInput value={rateYear} onChange={setRateYear} placeholder="Year" width={80} ariaLabel="New rate year" />
          <TextInput value={rateValue} onChange={setRateValue} placeholder="0.700" width={90} type="number" step="0.001" ariaLabel="New rate value" />
          <Button
            disabled={!rateYear.trim() || !rateValue.trim() || busy}
            onClick={async () => {
              const n = Number(rateValue)
              if (!Number.isFinite(n)) return
              await patch({ irsMileageRateByYear: { ...s.irsMileageRateByYear, [rateYear.trim()]: n } })
              setRateYear('')
              setRateValue('')
            }}
          >
            Add year
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/** Saves the current database as a JSON file in the browser's download folder. */
async function downloadBackupFile(): Promise<{ games: number }> {
  const backup = await exportBackup()
  const url = URL.createObjectURL(backupToBlob(backup))
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName()
  a.click()
  URL.revokeObjectURL(url)
  return { games: backup.counts['games'] ?? 0 }
}

function BackupPanel() {
  const { derived, reload } = useStore()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState<File | null>(null)

  const storedGames = derived?.snapshot.games.length ?? 0

  async function download() {
    setBusy(true)
    try {
      const { games } = await downloadBackupFile()
      setStatus(`Exported ${games} games and all reference data.`)
    } finally {
      setBusy(false)
    }
  }

  async function restore(file: File, mode: 'replace' | 'merge') {
    setBusy(true)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const validated = validateBackup(parsed)
      if (!validated.ok) {
        setStatus(`That file is not a valid backup: ${validated.errors.join('; ')}`)
        return
      }
      if (mode === 'replace') {
        // A snapshot of what is about to be wiped, so a mistaken replace is recoverable.
        await downloadBackupFile()
      }
      const report = await restoreBackup(validated.backup, mode)
      await reload()
      setStatus(
        mode === 'replace'
          ? `Replaced everything with the backup: ${report.games.inserted} games restored.`
          : `Merged: ${report.games.inserted} games added, ${report.games.skipped} already present and left alone.`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setReplacing(null)
    }
  }

  return (
    <Card
      title="Backup & restore"
      subtitle="Everything lives in this browser's IndexedDB. A JSON export keeps it portable."
    >
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="primary" onClick={() => void download()} disabled={busy}>
            Export backup JSON
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Restore from a backup file
          </span>
          <RestoreControl
            onMerge={(file) => void restore(file, 'merge')}
            onReplace={(file) => setReplacing(file)}
            busy={busy}
          />
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            Merge adds what is missing and never overwrites what is already here. Replace wipes
            everything first and gives you an exact copy of the backup — a copy of what is here
            now is downloaded first, so a mistaken replace can be undone.
          </p>
        </div>

        {status ? (
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {status}
          </p>
        ) : null}
      </div>

      {replacing ? (
        <Dialog
          open
          onClose={() => setReplacing(null)}
          title="Replace everything with this backup?"
          subtitle="This cannot be undone except from the backup that is about to download."
          labelledBy="replace-everything-heading"
          footer={
            <>
              <Button onClick={() => setReplacing(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void restore(replacing, 'replace')}>
                Replace everything
              </Button>
            </>
          }
        >
          <p className="m-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {storedGames === 0
              ? 'There is nothing stored yet, so replacing is just a restore. A copy of the current (empty) state is still downloaded first.'
              : `${storedGames} game${storedGames === 1 ? '' : 's'} and all parks, identity, settings and annotations currently in this browser will be deleted. A JSON backup of them will download first.`}
          </p>
        </Dialog>
      ) : null}
    </Card>
  )
}

function RestoreControl({
  onMerge,
  onReplace,
  busy,
}: {
  onMerge: (file: File) => void
  onReplace: (file: File) => void
  busy: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        accept=".json,application/json"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-xs"
        style={{ color: 'var(--text-secondary)' }}
      />
      <Button disabled={!file || busy} onClick={() => file && onMerge(file)}>
        Merge
      </Button>
      <Button variant="danger" disabled={!file || busy} onClick={() => file && onReplace(file)}>
        Replace everything
      </Button>
    </div>
  )
}

export { resolvePark }
