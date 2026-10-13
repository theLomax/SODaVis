/**
 * Where trips start. Home always exists and is the default; other places — an
 * office, a second address — are added here and chosen on a trip.
 *
 * Shown on the Profile page: where you set out from is about you, not the games.
 * Each is a card, locked until its Edit button unlocks it, as the vehicles are.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { CardField, LockableCard, toggledIn } from '../../components/LockableCard'
import {
  deleteStartLocation,
  patchStartLocation,
  saveStartLocation,
  setHomeAddress,
  setHomeLabel,
} from '../../../db/repo'
import { TextCell } from '../reference/cells'

const HOME = 'home'

function newLocationId(label: string, taken: Set<string>): string {
  const base = `loc-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export function StartLocationsEditor() {
  const { derived, reload } = useStore()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
  const toggleLock = (id: string) => setUnlocked((u) => toggledIn(u, id))

  const trips = derived?.allTrips
  const usage = useMemo(() => {
    const out = new Map<string, number>()
    for (const t of trips ?? []) {
      const id = t.startLocationId ?? HOME
      out.set(id, (out.get(id) ?? 0) + 1)
    }
    return out
  }, [trips])

  if (!derived) return null
  const homeLabel = derived.snapshot.settings.homeOriginLabel
  const homeAddress = derived.snapshot.settings.homeAddress
  const locations = [...derived.snapshot.startLocations].sort((a, b) => a.label.localeCompare(b.label))
  const labelTaken = (candidate: string, exceptId?: string) =>
    (exceptId !== HOME && homeLabel.toLowerCase() === candidate.toLowerCase()) ||
    locations.some((l) => l.id !== exceptId && l.label.toLowerCase() === candidate.toLowerCase())

  async function run(action: () => Promise<void>) {
    try {
      setError(null)
      await action()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Renames a place, unless another already has the name. */
  function rename(id: string, next: string | undefined, current: string) {
    if (!next || next === current) return
    if (labelTaken(next, id)) return setError(`"${next}" is already on the list.`)
    void run(() => (id === HOME ? setHomeLabel(next) : patchStartLocation(id, { label: next })))
  }

  async function add() {
    const trimmed = label.trim()
    if (!trimmed) return
    if (labelTaken(trimmed)) return setError(`"${trimmed}" is already on the list.`)
    await run(() =>
      saveStartLocation({ id: newLocationId(trimmed, new Set(locations.map((l) => l.id))), label: trimmed }),
    )
    setLabel('')
  }

  const tripCount = (id: string) => usage.get(id) ?? 0

  return (
    <Card
      title="Starting locations"
      subtitle="Where your trips start. Every trip starts from home unless you choose another place on the trip. An address on each lets a trip be routed from it."
    >
      {error ? (
        <p role="alert" className="m-0 mb-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        <LockableCard
          data-start-location={HOME}
          name={homeLabel}
          badge={<StatusChip role="good" label="default" title="Trips start here unless they name another place" />}
          summary={unlocked.has(HOME) ? null : (homeAddress ?? 'No address yet')}
          unlocked={unlocked.has(HOME)}
          onToggle={() => toggleLock(HOME)}
        >
          {unlocked.has(HOME) ? (
            <div className="flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
              <label className="flex flex-col gap-0.5">
                Label
                <TextCell value={homeLabel} fill ariaLabel="Label for home" onCommit={(v) => rename(HOME, v, homeLabel)} />
              </label>
              <label className="flex flex-col gap-0.5">
                Address
                <TextCell
                  value={homeAddress}
                  fill
                  ariaLabel="Address of home"
                  onCommit={(v) => {
                    if (v !== homeAddress) void run(() => setHomeAddress(v))
                  }}
                />
              </label>
            </div>
          ) : null}
          <dl className="m-0">
            <CardField label="Trips">{tripCount(HOME)}</CardField>
          </dl>
        </LockableCard>

        {locations.map((l) => {
          const open = unlocked.has(l.id)
          return (
            <LockableCard
              key={l.id}
              data-start-location={l.id}
              name={l.label}
              summary={open ? null : (l.address ?? 'No address yet')}
              unlocked={open}
              onToggle={() => toggleLock(l.id)}
            >
              {open ? (
                <div className="flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
                  <label className="flex flex-col gap-0.5">
                    Label
                    <TextCell value={l.label} fill ariaLabel={`Label for ${l.label}`} onCommit={(v) => rename(l.id, v, l.label)} />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    Address
                    <TextCell
                      value={l.address}
                      fill
                      ariaLabel={`Address of ${l.label}`}
                      onCommit={(v) => {
                        if (v !== l.address) void run(() => patchStartLocation(l.id, { address: v }))
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    Notes
                    <TextCell
                      value={l.notes}
                      fill
                      ariaLabel={`Notes on ${l.label}`}
                      onCommit={(v) => {
                        if (v !== l.notes) void run(() => patchStartLocation(l.id, { notes: v }))
                      }}
                    />
                  </label>
                </div>
              ) : l.notes ? (
                <span className="break-words" style={{ color: 'var(--text-muted)' }}>
                  {l.notes}
                </span>
              ) : null}
              <dl className="m-0">
                <CardField label="Trips">{tripCount(l.id)}</CardField>
              </dl>
              {open ? (
                <div className="flex justify-end">
                  <Button variant="danger" onClick={() => void run(() => deleteStartLocation(l.id))}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </LockableCard>
          )
        })}
      </ul>
      <p className="m-0 my-5 text-xs" style={{ color: 'var(--text-muted)' }}>
        A park's miles and drive times are from {homeLabel}. A trip from anywhere else keeps those figures until you
        enter its own miles and drive time on the trip.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          New location
          <TextInput value={label} onChange={setLabel} width={200} placeholder="Office" ariaLabel="New starting location label" />
        </label>
        <Button onClick={() => void add()} disabled={!label.trim()}>
          Add location
        </Button>
      </div>
    </Card>
  )
}
