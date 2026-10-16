/**
 * Parks & mileage. Unmatched venues, one-way figures, and merging two parks
 * that should have been one.
 *
 * Each park is a card (`ParkCard`), in a grid that is one column on a phone. A
 * card's figures are locked until its Edit button unlocks it.
 *
 * The list can be narrowed through the shared `FilterPanel`, by city and by what
 * has been played at a park: its leagues, sports, and the organizations that
 * assigned games there. Those three come from the games, so a park with no games
 * matches none of them.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { Button, selectStyle } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { FilterPanel, NO_SELECTION, matchesSelection, type FilterCategory, type FilterSelection } from '../../components/FilterPanel'
import { toggledIn } from '../../components/LockableCard'
import { deletePark, mergeParks, patchPark, saveParks } from '../../../db/repo'
import type { Park } from '../../../model/reference'
import { stripFieldDesignator } from '../../../derive/resolve'
import { ParkCard } from './ParkCard'
import { getMapsKey, routeBetween, type RouteResult } from '../../../maps/maps'

/** The city filter's value for a park with no city entered. */
const NO_CITY = '\u0000none'

export function ParksEditor() {
  const { derived, reload, pendingFocus, clearPendingFocus } = useStore()
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeInto, setMergeInto] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState<FilterSelection>(NO_SELECTION)
  /** Distances fetched for several parks at once, waiting to be accepted. */
  const [fetched, setFetched] = useState<{ park: Park; route?: RouteResult; error?: string }[] | null>(null)
  const [fetching, setFetching] = useState(false)

  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of derived?.allResolved ?? []) {
      if (r.parkId) counts.set(r.parkId, (counts.get(r.parkId) ?? 0) + 1)
    }
    return counts
  }, [derived])

  /** What has been played at each park: the leagues, sports and organizations of its games. */
  const played = useMemo(() => {
    const out = new Map<string, { leagues: Set<string>; sports: Set<string>; organizations: Set<string> }>()
    for (const r of derived?.allResolved ?? []) {
      if (!r.parkId) continue
      let at = out.get(r.parkId)
      if (!at) out.set(r.parkId, (at = { leagues: new Set(), sports: new Set(), organizations: new Set() }))
      if (r.game.league) at.leagues.add(r.game.league)
      if (r.sportCode) at.sports.add(r.sportCode)
      if (r.organizationId) at.organizations.add(r.organizationId)
    }
    return out
  }, [derived])

  /** The cards open for editing. Every card starts locked. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
  const toggleLock = (id: string) => setUnlocked((u) => toggledIn(u, id))

  /**
   * The park id a warning sent us to. It is consumed once, so a rerender does not
   * re-scroll, and kept as `arrivedAt`: the card stays marked, and is unlocked,
   * because the reader came here to type a number into it.
   */
  const focusPark =
    pendingFocus?.view === 'reference' && pendingFocus.tab === 'parks' ? pendingFocus.focus : undefined
  const [arrivedAt, setArrivedAt] = useState<string>()
  const arrivedCard = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!focusPark) return
    setUnlocked((u) => new Set(u).add(focusPark))
    // The park the reader was sent to must not be filtered out of view.
    setShow(NO_SELECTION)
    setArrivedAt(focusPark)
    clearPendingFocus()
  }, [focusPark, clearPendingFocus])

  // After the render that unlocked the card, so its fields exist to focus.
  useEffect(() => {
    if (!arrivedAt) return
    arrivedCard.current?.scrollIntoView({ block: 'center' })
    arrivedCard.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
  }, [arrivedAt])

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
   * for want of a drive figure. Those cards sort first and carry a marker, so the
   * gap is visible without reading every card. A park with no games needs
   * nothing, so it is not marked.
   */
  const needsMiles = (p: Park) => p.oneWayMiles == null && (usage.get(p.id) ?? 0) > 0

  const parks = [...derived.snapshot.parks].sort(
    (a, b) =>
      Number(needsMiles(b)) - Number(needsMiles(a)) || a.name.localeCompare(b.name),
  )
  const incompleteParks = parks.filter(needsMiles)

  // Only values some park has, so no single pick leads to an empty list.
  const anyAt = (pick: (at: NonNullable<ReturnType<typeof played.get>>) => Set<string>) =>
    new Set(parks.flatMap((p) => [...(played.get(p.id) ? pick(played.get(p.id)!) : [])]))
  const leaguesPlayed = anyAt((at) => at.leagues)
  const sportsPlayed = anyAt((at) => at.sports)
  const organizationsPlayed = anyAt((at) => at.organizations)
  const categories: FilterCategory[] = [
    {
      id: 'city',
      label: 'City',
      options: [
        ...[...new Set(parks.flatMap((p) => (p.city ? [p.city] : [])))].sort().map((c) => ({ value: c, label: c })),
        ...(parks.some((p) => !p.city) ? [{ value: NO_CITY, label: 'No city entered' }] : []),
      ],
    },
    { id: 'league', label: 'League', options: [...leaguesPlayed].sort().map((l) => ({ value: l, label: l })) },
    {
      id: 'sport',
      label: 'Sport',
      options: derived.trackedSports.filter((sp) => sportsPlayed.has(sp.code)).map((sp) => ({ value: sp.code, label: sp.label })),
    },
    {
      id: 'organization',
      label: 'Assigning organization',
      options: derived.snapshot.organizations
        .filter((o) => organizationsPlayed.has(o.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => ({ value: o.id, label: o.name })),
    },
  ]
  const shownParks = parks.filter((p) =>
    matchesSelection(show, (category) => {
      const at = played.get(p.id)
      if (category === 'city') return [p.city ?? NO_CITY]
      if (category === 'league') return at?.leagues ?? []
      if (category === 'sport') return at?.sports ?? []
      return at?.organizations ?? []
    }),
  )

  const { homeOriginLabel: homeLabel, homeAddress } = derived.snapshot.settings
  /** Parks the map service can measure without anything more being typed. */
  const measurable = parks.filter((p) => (p.address || p.location) && p.oneWayMiles == null)

  // One request per park, in turn, on the button. Results wait to be accepted.
  async function fetchDistances() {
    if (!homeAddress) return
    setFetching(true)
    const out: NonNullable<typeof fetched> = []
    for (const park of measurable) {
      try {
        out.push({
          park,
          route: await routeBetween(homeAddress, { address: park.address ?? park.name, location: park.location }, getMapsKey()),
        })
      } catch (e) {
        out.push({ park, error: e instanceof Error ? e.message : String(e) })
        // A refused key or a dead connection will fail every park the same way.
        if (out.every((r) => r.error)) break
      }
      setFetched([...out])
    }
    setFetching(false)
  }

  async function applyFetched() {
    setBusy(true)
    try {
      for (const r of fetched ?? []) {
        if (r.route) await patchPark(r.park.id, { oneWayMiles: r.route.miles, oneWayDriveMinutes: r.route.minutes })
      }
      setFetched(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  // A patch, not the park as rendered: two fields of a card can be committed
  // before the view reloads, and a whole-row save would undo the first.
  async function update(park: Park, patch: Partial<Omit<Park, 'id'>>) {
    setBusy(true)
    try {
      await patchPark(park.id, patch)
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
              } games but no mileage — those come first, and every trip there is untimed until a figure is entered. Choose Edit on a park to change its figures.`
            : 'One-way miles; round-trip is computed. Two drive figures, because the legs differ: the outbound uses the rush time for a weekday evening arrival, the return always uses the ideal. Tolls are the round-trip estimate. Choose Edit on a park to change its figures.'
        }
      >
        <FilterPanel
          noun="parks"
          categories={categories}
          selection={show}
          onChange={setShow}
          shown={shownParks.length}
          total={parks.length}
        >
          {measurable.length > 0 || fetched ? (
            <div
              className="mb-3 flex flex-col gap-2 rounded-lg p-3 text-xs"
              style={{ border: '1px solid var(--border-hairline)' }}
            >
              {fetched ? (
                <>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {fetched.map((r) => (
                      <li key={r.park.id} style={{ color: r.error ? 'var(--status-critical)' : 'var(--text-primary)' }}>
                        <strong>{r.park.name}: </strong>
                        {r.route ? `${r.route.miles} mi, ${r.route.minutes} min one way` : r.error}
                      </li>
                    ))}
                  </ul>
                  {fetching ? (
                    <span style={{ color: 'var(--text-muted)' }}>Fetching…</span>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {fetched.some((r) => r.route) ? (
                        <Button variant="primary" disabled={busy} onClick={() => void applyFetched()}>
                          Use these distances
                        </Button>
                      ) : null}
                      <Button onClick={() => setFetched(null)}>Dismiss</Button>
                    </span>
                  )}
                </>
              ) : (
                <span className="flex flex-wrap items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  {measurable.length} park{measurable.length === 1 ? ' has' : 's have'} an address or map position but no mileage.
                  <Button disabled={fetching || !homeAddress} onClick={() => void fetchDistances()}>
                    Get {measurable.length === 1 ? 'its distance' : 'their distances'} from {homeLabel}
                  </Button>
                  {homeAddress ? null : <span>Add {homeLabel}'s address on your profile first.</span>}
                </span>
              )}
            </div>
          ) : null}
          {shownParks.length === 0 && parks.length > 0 ? (
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              No park matches all of those. League, sport and organization come from the games played at a park.
            </p>
          ) : null}
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {shownParks.map((park) => (
              <ParkCard
                key={park.id}
                park={park}
                games={usage.get(park.id) ?? 0}
                needsMiles={needsMiles(park)}
                unlocked={unlocked.has(park.id)}
                highlighted={park.id === arrivedAt}
                currency={derived.snapshot.settings.currency}
                homeLabel={homeLabel}
                homeAddress={homeAddress}
                {...(park.id === arrivedAt ? { cardRef: arrivedCard } : {})}
                onToggle={() => toggleLock(park.id)}
                onPatch={(patch) => void update(park, patch)}
                onDelete={async () => {
                  await deletePark(park.id)
                  await reload()
                }}
              />
            ))}
          </ul>
        </FilterPanel>
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
