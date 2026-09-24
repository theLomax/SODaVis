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
import { TABLES, schemaVersions, storesAddedIn } from './tables'

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
    // Each version's `stores()` is only the tables added in that version, so an
    // existing database upgrades by gaining empty tables rather than being rebuilt.
    // The list itself lives in `tables.ts`.
    for (const version of schemaVersions()) {
      this.version(version).stores(storesAddedIn(version))
    }
  }
}

export const db = new AppDatabase()

/**
 * Seeds reference data on first run. Idempotent and additive: an existing row is
 * never overwritten, because the user may have corrected it.
 */
export async function seedReferenceData(database: AppDatabase = db): Promise<void> {
  const seeded = TABLES.filter((t) => t.seedRows && t.seedRows.length > 0)
  await database.transaction(
    'rw',
    seeded.map((t) => database.table(t.name)),
    async () => {
      for (const spec of seeded) {
        const table = database.table(spec.name)
        if ((await table.count()) === 0) await table.bulkPut(spec.seedRows!)
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
