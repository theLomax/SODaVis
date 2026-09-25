/**
 * The Tax view hides the filter bar but used to take its trips from the filtered
 * derive chain. Income was already unfiltered (`allResolved`); mileage and
 * expenses were not. A park or date filter left on another view then silently
 * understated the year's deduction.
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
} from '../model/reference'
import type { AppSnapshot } from '../db/repo'
import { derive } from '../ui/store'
import { taxYear } from './tax'
import { seedAgeGroupDurations } from './resolve'
import { readFixtureSample } from '../../test/sample-data'
import { FIXTURE_PARKS } from '../../test/sample/parks'

const FIXTURE_IDENTITY: Identity = {
  id: 'self',
  patterns: ['^Rivera.*Sam$'],
  displayName: 'Sam Rivera',
}

function fixtureSnapshot(): AppSnapshot {
  const parsed = parseDelimited(readFixtureSample())
  const games = mapRows(parsed.rows, {
    profile: assignrProfile,
    identity: FIXTURE_IDENTITY,
    importId: 'fixture',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  }).games
  const seeded = seedAgeGroupDurations(games)
  return {
    games,
    parks: FIXTURE_PARKS,
    durations: seeded.seeded,
    sports: SEED_SPORT_PROFILES,
    gearLevels: GEAR_LEVELS,
    gearModifiers: GEAR_MODIFIERS,
    callTypes: SEED_CALL_TYPES,
    identity: FIXTURE_IDENTITY,
    settings: SEED_SETTINGS,
    gameAnnotations: [],
    tripAnnotations: [],
    generalExpenses: [],
    imports: [],
    customProfiles: [],
  }
}

const openFilter = {
  period: null,
  sportCodes: [] as string[],
  parkIds: [] as string[],
  model: 'game-drive' as const,
}

describe('Tax uses an unfiltered trip set', () => {
  it('keeps the full-year mileage when a park filter is active', () => {
    const snapshot = fixtureSnapshot()
    const open = derive(snapshot, openFilter)
    const filtered = derive(snapshot, { ...openFilter, parkIds: ['northside'] })

    expect(filtered.trips.length).toBeLessThan(open.trips.length)
    expect(filtered.allTrips.length).toBe(open.trips.length)

    const years = [...new Set(open.allResolved.map((r) => r.game.date.slice(0, 4)))]
    const year = Number(years[0])
    const annotations = new Map(snapshot.tripAnnotations.map((a) => [a.key, a]))

    const full = taxYear(year, open.allResolved, open.allTrips, annotations, snapshot.settings)
    const fixed = taxYear(year, filtered.allResolved, filtered.allTrips, annotations, snapshot.settings)
    // What Tax used to do: unfiltered games, filtered trips.
    const bug = taxYear(year, filtered.allResolved, filtered.trips, annotations, snapshot.settings)

    expect(fixed.mileage.miles).toBe(full.mileage.miles)
    expect(fixed.gross).toBe(full.gross)
    expect(bug.mileage.miles).toBeLessThan(full.mileage.miles)
  })
})
