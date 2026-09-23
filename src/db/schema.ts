/**
 * Dexie schema. One table per layer concept, so imported facts, reference data
 * and annotations stay physically separate and an import can never write to a
 * table it has no business in.
 */

import Dexie, { type EntityTable } from 'dexie'
import type { Game, ImportRun } from '../model/game'
import type {
  AgeGroupDuration,
  GearLevel,
  GearModifier,
  Identity,
  Park,
  Settings,
  SportProfile,
} from '../model/reference'
import type { GameAnnotation, TripAnnotation } from '../model/annotation'
import type { SourceProfile } from '../import/profiles'
import {
  GEAR_LEVELS,
  GEAR_MODIFIERS,
  SEED_IDENTITY,
  SEED_PARKS,
  SEED_SETTINGS,
  SEED_SPORT_PROFILES,
} from '../model/reference'

/**
 * A custom profile as stored. `isDataRow` and `transforms` are functions and
 * cannot be persisted, so a stored profile carries a declarative predicate
 * instead and is rehydrated on load.
 */
export type StoredProfile = Omit<SourceProfile, 'isDataRow' | 'transforms'> & {
  /** Columns that must be non-empty for a row to count as data. */
  requiredColumns: string[]
  /** Values in the first required column that mark a trailer row. */
  trailerMarkers: string[]
}

export class AppDatabase extends Dexie {
  games!: EntityTable<Game, 'id'>
  imports!: EntityTable<ImportRun, 'id'>
  parks!: EntityTable<Park, 'id'>
  durations!: EntityTable<AgeGroupDuration, 'key'>
  sports!: EntityTable<SportProfile, 'code'>
  gearLevels!: EntityTable<GearLevel, 'id'>
  identity!: EntityTable<Identity, 'id'>
  settings!: EntityTable<Settings, 'id'>
  gameAnnotations!: EntityTable<GameAnnotation, 'dedupeKey'>
  tripAnnotations!: EntityTable<TripAnnotation, 'key'>
  gearModifiers!: EntityTable<GearModifier, 'id'>
  customProfiles!: EntityTable<StoredProfile, 'id'>

  constructor(name = 'so-datavisualizer') {
    super(name)

    this.version(1).stores({
      // dedupeKey is unique: it is what makes re-import idempotent.
      games: 'id, &source.dedupeKey, date, status, venueRaw, source.importId, league, assignor, sportCode',
      imports: 'id, importedAt',
      parks: 'id, name',
      durations: 'key',
      sports: 'code',
      gearLevels: 'id',
      identity: 'id',
      settings: 'id',
      gameAnnotations: 'dedupeKey',
      tripAnnotations: 'key',
      customProfiles: 'id',
    })

    // v2 adds gear modifiers — conditions layered on the role (shield, dressed
    // down, cold, rain). Purely additive: a v1 database upgrades by gaining an
    // empty table, which seedReferenceData then fills.
    this.version(2).stores({
      gearModifiers: 'id',
    })
  }
}

export const db = new AppDatabase()

/**
 * Seeds reference data on first run. Idempotent and additive: an existing row is
 * never overwritten, because the user may have corrected it.
 */
export async function seedReferenceData(database: AppDatabase = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.parks,
      database.sports,
      database.gearLevels,
      database.gearModifiers,
      database.identity,
      database.settings,
    ],
    async () => {
      if ((await database.settings.count()) === 0) {
        await database.settings.put(SEED_SETTINGS)
      }
      if ((await database.identity.count()) === 0) {
        await database.identity.put(SEED_IDENTITY)
      }
      if ((await database.gearLevels.count()) === 0) {
        await database.gearLevels.bulkPut(GEAR_LEVELS)
      }
      if ((await database.gearModifiers.count()) === 0) {
        await database.gearModifiers.bulkPut(GEAR_MODIFIERS)
      }
      if ((await database.sports.count()) === 0) {
        await database.sports.bulkPut(SEED_SPORT_PROFILES)
      }
      if ((await database.parks.count()) === 0) {
        await database.parks.bulkPut(SEED_PARKS)
      }
    },
  )
}

/** Rebuilds the function-valued parts of a stored custom profile. */
export function rehydrateProfile(stored: StoredProfile): SourceProfile {
  const { requiredColumns, trailerMarkers, ...rest } = stored
  return {
    ...rest,
    isCustom: true,
    isDataRow: (row) => {
      for (const col of requiredColumns) {
        if (!(row[col] ?? '').trim()) return false
      }
      const first = requiredColumns[0]
      if (first) {
        const v = (row[first] ?? '').trim().toLowerCase()
        if (trailerMarkers.some((m) => v === m.toLowerCase())) return false
      }
      return true
    },
  }
}

export function dehydrateProfile(
  profile: SourceProfile,
  requiredColumns: string[],
  trailerMarkers: string[] = ['totals', 'totals:', 'total'],
): StoredProfile {
  const { isDataRow, transforms, ...rest } = profile
  void isDataRow
  void transforms
  return { ...rest, isCustom: true, requiredColumns, trailerMarkers }
}
