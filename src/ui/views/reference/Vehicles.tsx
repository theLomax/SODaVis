/**
 * Vehicles driven to games. The standard mileage deduction is claimed per
 * vehicle, so a trip records which one it was: its own, or else the default.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Button, TextInput } from '../../components/Controls'
import { Card } from '../../components/Tiles'
import { VehicleInUseError, deleteVehicle, patchVehicle, saveVehicle, setDefaultVehicle } from '../../../db/repo'
import type { Vehicle } from '../../../model/reference'
import { TextCell } from './cells'

function newVehicleId(name: string, taken: Set<string>): string {
  const base = `veh-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export function VehiclesEditor() {
  const { derived, reload } = useStore()
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)

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
        <div className="overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Default', 'Name', 'Year, make and model', 'Notes', 'Trips', 'Miles', ''].map((h, i) => (
                  <th
                    key={h || i}
                    scope="col"
                    className="px-2 py-1.5 font-medium"
                    style={{
                      textAlign: i === 4 || i === 5 ? 'right' : 'left',
                      color: 'var(--text-secondary)',
                      borderBottom: '1px solid var(--gridline)',
                    }}
                  >
                    {h ? h : <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => {
                const u = usage.get(v.id)
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <td className="px-2 py-1.5">
                      <input
                        type="radio"
                        name="default-vehicle"
                        checked={defaultId === v.id}
                        onChange={() => void run(() => setDefaultVehicle(v.id))}
                        aria-label={`Make ${v.name} the default vehicle`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={v.name}
                        width={150}
                        ariaLabel={`Name of ${v.name}`}
                        onCommit={(next) => {
                          if (next && next !== v.name) void run(() => patchVehicle(v.id, { name: next }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={v.details}
                        width={180}
                        ariaLabel={`Year, make and model of ${v.name}`}
                        onCommit={(next) => {
                          if (next !== v.details) void run(() => patchVehicle(v.id, { details: next }))
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <TextCell
                        value={v.notes}
                        width={180}
                        ariaLabel={`Notes on ${v.name}`}
                        onCommit={(next) => {
                          if (next !== v.notes) void run(() => patchVehicle(v.id, { notes: next }))
                        }}
                      />
                    </td>
                    <td className="num-tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {u?.trips ?? 0}
                    </td>
                    <td className="num-tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {u ? (Math.round(u.miles * 10) / 10).toLocaleString() : 0}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void run(() => deleteVehicle(v.id))}
                        aria-label={`Delete ${v.name}`}
                        className="text-xs"
                        style={{ color: 'var(--status-critical)' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="m-0 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            {defaultId
              ? 'Trips with no vehicle of their own count toward the default.'
              : 'No default is set, so a trip counts toward a vehicle only when you set one on it.'}{' '}
            A vehicle named on a trip cannot be deleted until those trips are moved to another.
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
