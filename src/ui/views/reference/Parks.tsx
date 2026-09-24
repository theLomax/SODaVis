/**
 * Parks & mileage. Unmatched venues, one-way figures, and merging two parks
 * that should have been one.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { Button, selectStyle } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { deletePark, mergeParks, saveParks } from '../../../db/repo'
import type { Park } from '../../../model/reference'
import { stripFieldDesignator } from '../../../derive/resolve'
import { NumberCell, TextCell } from './cells'

export function ParksEditor() {
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
