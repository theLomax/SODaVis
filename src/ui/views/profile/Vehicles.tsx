/**
 * Vehicles driven to games. The standard mileage deduction is claimed per
 * vehicle, so a trip records which one it was: its own, or else the default.
 *
 * Shown on the Profile page: what you drive is about you, not about the games.
 *
 * Each vehicle is a card, locked until its Edit button unlocks it, as the parks
 * are. Delete and the choice of default appear only while a card is unlocked.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { CardField, LockableCard, toggledIn } from '../../components/LockableCard'
import { VehicleInUseError, deleteVehicle, patchVehicle, saveVehicle, setDefaultVehicle } from '../../../db/repo'
import type { Vehicle } from '../../../model/reference'
import { TextCell } from '../reference/cells'

function newVehicleId(name: string, taken: Set<string>): string {
  const base = `veh-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

function VehicleCard({
  vehicle: v,
  isDefault,
  trips,
  miles,
  unlocked,
  onToggle,
  onPatch,
  onMakeDefault,
  onDelete,
}: {
  vehicle: Vehicle
  isDefault: boolean
  trips: number
  miles: number
  unlocked: boolean
  onToggle: () => void
  onPatch: (patch: Partial<Omit<Vehicle, 'id'>>) => void
  onMakeDefault: () => void
  onDelete: () => void
}) {
  return (
    <LockableCard
      data-vehicle={v.id}
      name={v.name}
      badge={
        isDefault ? (
          <StatusChip role="good" label="default" title="Trips with no vehicle of their own count toward this one" />
        ) : null
      }
      summary={unlocked ? null : (v.details ?? 'No year, make or model')}
      unlocked={unlocked}
      onToggle={onToggle}
    >
      {unlocked ? (
        <div className="flex flex-col gap-2" style={{ color: 'var(--text-muted)' }}>
          <label className="flex flex-col gap-0.5">
            Name
            <TextCell
              value={v.name}
              fill
              ariaLabel={`Name of ${v.name}`}
              onCommit={(next) => {
                if (next && next !== v.name) onPatch({ name: next })
              }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            Year, make and model
            <TextCell
              value={v.details}
              fill
              ariaLabel={`Year, make and model of ${v.name}`}
              onCommit={(next) => {
                if (next !== v.details) onPatch({ details: next })
              }}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            Notes
            <TextCell
              value={v.notes}
              fill
              ariaLabel={`Notes on ${v.name}`}
              onCommit={(next) => {
                if (next !== v.notes) onPatch({ notes: next })
              }}
            />
          </label>
        </div>
      ) : v.notes ? (
        <span className="break-words" style={{ color: 'var(--text-muted)' }}>
          {v.notes}
        </span>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-3">
        <CardField label="Trips">{trips}</CardField>
        <CardField label="Miles">{(Math.round(miles * 10) / 10).toLocaleString()}</CardField>
      </dl>

      {unlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="radio"
              name="default-vehicle"
              checked={isDefault}
              onChange={onMakeDefault}
              aria-label={`Make ${v.name} the default vehicle`}
            />
            Default vehicle
          </label>
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </LockableCard>
  )
}

export function VehiclesEditor() {
  const { derived, reload } = useStore()
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** The cards open for editing. Every card starts locked. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set())
  const toggleLock = (id: string) => setUnlocked((u) => toggledIn(u, id))

  const trips = derived?.allTrips
  const usage = useMemo(() => {
    const out = new Map<string, { trips: number; miles: number }>()
    for (const t of trips ?? []) {
      if (!t.vehicleId) continue
      const u = out.get(t.vehicleId) ?? { trips: 0, miles: 0 }
      u.trips++
      u.miles += t.miles ?? 0
      out.set(t.vehicleId, u)
    }
    return out
  }, [trips])

  if (!derived) return null
  const vehicles = [...derived.snapshot.vehicles].sort((a, b) => a.name.localeCompare(b.name))
  const defaultId = derived.snapshot.settings.defaultVehicleId

  async function run(action: () => Promise<void>) {
    try {
      setError(null)
      await action()
      await reload()
    } catch (e) {
      if (e instanceof VehicleInUseError) setError(e.message)
      else setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (vehicles.some((v) => v.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already on the list.`)
      return
    }
    const vehicle: Vehicle = {
      id: newVehicleId(trimmed, new Set(vehicles.map((v) => v.id))),
      name: trimmed,
      ...(details.trim() ? { details: details.trim() } : {}),
    }
    await run(async () => {
      await saveVehicle(vehicle)
      // The first vehicle is the obvious default; later ones leave it alone.
      if (vehicles.length === 0) await setDefaultVehicle(vehicle.id)
    })
    setName('')
    setDetails('')
  }

  return (
    <Card
      title="Vehicles"
      subtitle="What you drive to games. The mileage deduction is claimed per vehicle, so each trip records one: the default, unless you set another on the trip."
    >
      {error ? (
        <p role="alert" className="m-0 mb-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          {error}
        </p>
      ) : null}
      {vehicles.length === 0 ? (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          None yet. The first one you add becomes the default.
        </p>
      ) : (
        <div>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {vehicles.map((v) => {
              const u = usage.get(v.id)
              return (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  isDefault={defaultId === v.id}
                  trips={u?.trips ?? 0}
                  miles={u?.miles ?? 0}
                  unlocked={unlocked.has(v.id)}
                  onToggle={() => toggleLock(v.id)}
                  onPatch={(patch) => void run(() => patchVehicle(v.id, patch))}
                  onMakeDefault={() => void run(() => setDefaultVehicle(v.id))}
                  onDelete={() => void run(() => deleteVehicle(v.id))}
                />
              )
            })}
          </ul>
          <p className="m-0 my-5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {defaultId
              ? 'Trips with no vehicle of their own count toward the default.'
              : 'No default is set, so a trip counts toward a vehicle only when you set one on it.'}{' '}
            Choose Edit on a vehicle to change it, make it the default, or delete it; one named on a trip cannot be
            deleted until those trips are moved to another.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Name
          <TextInput value={name} onChange={setName} width={160} placeholder="Blue sedan" ariaLabel="New vehicle name" />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Year, make and model (optional)
          <TextInput value={details} onChange={setDetails} width={200} placeholder="2019 Example Motors Sedan" ariaLabel="Year, make and model of the new vehicle" />
        </label>
        <Button onClick={() => void add()} disabled={!name.trim()}>
          Add vehicle
        </Button>
      </div>
    </Card>
  )
}
