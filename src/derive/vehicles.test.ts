/**
 * Which vehicle a trip used, and the tax year's miles split by it. Runs on the
 * public sample through `derive`.
 */

import { describe, expect, it } from 'vitest'

import { parseDelimited } from '../import/parse'
import { mapRows } from '../import/map'
import { assignrProfile } from '../import/profiles'
import {
  GEAR_LEVELS,
  GEAR_MODIFIERS,
  SEED_CALL_TYPES,
  SEED_SETTINGS,
  SEED_SPORT_PROFILES,
  type Identity,
  type Vehicle,
} from '../model/reference'
import type { TripAnnotation } from '../model/annotation'
import type { AppSnapshot } from '../db/repo'
import { derive, type Filter } from '../ui/store'
import { resolveVehicle } from './trips'
import { taxYear } from './tax'
import { seedAgeGroupDurations } from './resolve'
import { readFixtureSample } from '../../test/sample-data'
import { FIXTURE_PARKS } from '../../test/sample/parks'

const IDENTITY: Identity = { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' }
const sedan: Vehicle = { id: 'v-sedan', name: 'Blue sedan' }
const truck: Vehicle = { id: 'v-truck', name: 'Work truck', details: '2015 Example Motors pickup' }

function snapshot(parts: Partial<AppSnapshot>): AppSnapshot {
  const parsed = parseDelimited(readFixtureSample())
  const games = mapRows(parsed.rows, {
    profile: assignrProfile,
    identity: IDENTITY,
    importId: 'imp-1',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  }).games
  return {
    games,
    parks: FIXTURE_PARKS,
    durations: seedAgeGroupDurations(games).seeded,
    sports: SEED_SPORT_PROFILES,
    gearLevels: GEAR_LEVELS,
    gearModifiers: GEAR_MODIFIERS,
    callTypes: SEED_CALL_TYPES,
    identity: IDENTITY,
    settings: SEED_SETTINGS,
    gameAnnotations: [],
    tripAnnotations: [],
    generalExpenses: [],
    gearProducts: [],
    gearItems: [],
    gearSets: [],
    organizations: [],
    vehicles: [],
    imports: [],
    customProfiles: [],
    ...parts,
  } as AppSnapshot
}

const open: Filter = { period: null, sportCodes: [], parkIds: [], model: 'game-drive' }
const known = new Map([sedan, truck].map((v) => [v.id, v]))

describe('resolving a trip’s vehicle', () => {
  it('uses the trip’s own vehicle over the default', () => {
    const got = resolveVehicle({ key: 'k', expenses: [], vehicleId: 'v-truck' }, { ...SEED_SETTINGS, defaultVehicleId: 'v-sedan' }, known)
    expect(got).toEqual({ id: 'v-truck', source: 'trip' })
  })

  it('falls back to the default, and to none without one', () => {
    expect(resolveVehicle(undefined, { ...SEED_SETTINGS, defaultVehicleId: 'v-sedan' }, known)).toEqual({ id: 'v-sedan', source: 'default' })
    expect(resolveVehicle(undefined, SEED_SETTINGS, known)).toBeUndefined()
  })

  it('ignores a vehicle that no longer exists, on the trip or as the default', () => {
    const settings = { ...SEED_SETTINGS, defaultVehicleId: 'v-gone' }
    expect(resolveVehicle({ key: 'k', expenses: [], vehicleId: 'v-also-gone' }, settings, known)).toBeUndefined()
  })
})

describe('vehicles through derive and the tax year', () => {
  it('gives every trip the default, and a trip’s own vehicle wins', () => {
    const plain = derive(snapshot({}), open)
    const first = plain.allTrips[0]!
    const own: TripAnnotation = { key: first.key, expenses: [], vehicleId: 'v-truck' }
    const d = derive(
      snapshot({ vehicles: [sedan, truck], settings: { ...SEED_SETTINGS, defaultVehicleId: 'v-sedan' }, tripAnnotations: [own] }),
      open,
    )
    const byKey = new Map(d.allTrips.map((t) => [t.key, t]))
    expect(byKey.get(first.key)).toMatchObject({ vehicleId: 'v-truck', vehicleSource: 'trip' })
    const rest = d.allTrips.filter((t) => t.key !== first.key)
    expect(rest.every((t) => t.vehicleId === 'v-sedan' && t.vehicleSource === 'default')).toBe(true)
  })

  it('splits the year’s miles by vehicle, adding up to the total', () => {
    const plain = derive(snapshot({}), open)
    const year = Number(plain.allTrips[0]!.date.slice(0, 4))
    const own: TripAnnotation = { key: plain.allTrips.find((t) => t.date.startsWith(String(year)) && t.miles)!.key, expenses: [], vehicleId: 'v-truck' }
    const s = snapshot({ vehicles: [sedan, truck], settings: { ...SEED_SETTINGS, defaultVehicleId: 'v-sedan' }, tripAnnotations: [own] })
    const d = derive(s, open)
    const t = taxYear(year, d.allResolved, d.allTrips, new Map([[own.key, own]]), s.settings, [], s.vehicles)
    expect(t.mileage.byVehicle.map((v) => v.name).sort()).toEqual(['Blue sedan', 'Work truck'])
    expect(t.mileage.byVehicle.reduce((n, v) => n + v.miles, 0)).toBeCloseTo(t.mileage.miles, 1)
    expect(t.mileage.byVehicle.reduce((n, v) => n + v.trips, 0)).toBe(d.allTrips.filter((x) => x.date.startsWith(String(year))).length)
  })

  it('shows no per-vehicle split until a vehicle is in use', () => {
    const d = derive(snapshot({}), open)
    const year = Number(d.allTrips[0]!.date.slice(0, 4))
    expect(taxYear(year, d.allResolved, d.allTrips, new Map(), SEED_SETTINGS).mileage.byVehicle).toEqual([])
  })
})
