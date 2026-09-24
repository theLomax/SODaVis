/**
 * Data access. Every write that could touch imported facts goes through here, so
 * the rules about what an import may and may not overwrite live in one place.
 */

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
import type { FeeAnomalyCode, GameAnnotation, TripAnnotation } from '../model/annotation'
import { mergeTripAnnotations, parseTripKey, tripKey } from '../model/annotation'
import {
  SEED_IDENTITY,
  SEED_SETTINGS,
  sortGearLevels,
  sortGearModifiers,
} from '../model/reference'
import type { SourceProfile } from '../import/profiles'
import {
  db,
  dehydrateProfile,
  rehydrateProfile,
  type AppDatabase,
  type StoredProfile,
} from './schema'
import { TABLES, type TableSpec } from './tables'

export type AppSnapshot = {
  games: Game[]
  parks: Park[]
  durations: AgeGroupDuration[]
  sports: SportProfile[]
  gearLevels: GearLevel[]
  gearModifiers: GearModifier[]
  identity: Identity
  settings: Settings
  gameAnnotations: GameAnnotation[]
  tripAnnotations: TripAnnotation[]
  imports: ImportRun[]
  customProfiles: SourceProfile[]
}

export async function loadSnapshot(database: AppDatabase = db): Promise<AppSnapshot> {
  const entries = await Promise.all(
    TABLES.map(async (spec) => [spec.name, await readSnapshotTable(spec, database)] as const),
  )
  return Object.fromEntries(entries) as unknown as AppSnapshot
}

async function readSnapshotTable(spec: TableSpec, database: AppDatabase): Promise<unknown> {
  const table = database.table(spec.name)
  switch (spec.kind) {
    case 'imports':
      return database.imports.orderBy('importedAt').reverse().toArray()
    case 'identity':
      return ((await table.toArray())[0] as Identity | undefined) ?? SEED_IDENTITY
    case 'settings':
      // Settings gains fields over time, and a row written by an earlier version
      // lacks them. Filling from the seed here means every consumer sees a complete
      // object rather than each one guarding for itself — `rushHour` in particular is
      // read as `s.rushHour.startMinutes` by the editor, which would throw.
      return { ...SEED_SETTINGS, ...((await table.toArray())[0] as Settings | undefined) }
    case 'profiles':
      return (await table.toArray()).map((row) => rehydrateProfile(row as StoredProfile))
    case 'gearLevels':
      return sortGearLevels(await table.toArray())
    case 'gearModifiers':
      return sortGearModifiers(await table.toArray())
    default:
      return table.toArray()
  }
}

// ---------------------------------------------------------------------------
// Import commit & undo
// ---------------------------------------------------------------------------

export type CommitPlan = {
  inserts: Game[]
  /** Conflicts the user chose to accept, already resolved to the new value. */
  updates: Game[]
  unchangedCount: number
  conflictCount: number
  fileName: string
  profileId: string
  profileLabel: string
  rowsInFile: number
  rowsSkipped: number
}

/**
 * Writes an import as a single transaction and records enough to undo it.
 *
 * Annotations are never touched: they are keyed by dedupeKey, which survives the
 * write, so a manual duration or a trip expense stays attached.
 */
export async function commitImport(
  plan: CommitPlan,
  database: AppDatabase = db,
): Promise<ImportRun> {
  const importId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const importedAt = new Date().toISOString()

  const run: ImportRun = {
    id: importId,
    importedAt,
    fileName: plan.fileName,
    profileId: plan.profileId,
    profileLabel: plan.profileLabel,
    counts: {
      rowsInFile: plan.rowsInFile,
      rowsSkipped: plan.rowsSkipped,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      unchanged: plan.unchangedCount,
      conflicts: plan.conflictCount,
    },
    insertedGameIds: plan.inserts.map((g) => g.id),
    replacedGames: [],
  }

  await database.transaction('rw', [database.games, database.imports], async () => {
    // Pre-image of everything about to be overwritten, so undo can restore it.
    const replacedIds = plan.updates.map((g) => g.id)
    run.replacedGames = replacedIds.length
      ? ((await database.games.bulkGet(replacedIds)).filter(Boolean) as Game[])
      : []

    const stamp = (g: Game): Game => ({
      ...g,
      source: { ...g.source, importId, importedAt },
    })

    if (plan.inserts.length) await database.games.bulkPut(plan.inserts.map(stamp))
    if (plan.updates.length) await database.games.bulkPut(plan.updates.map(stamp))
    await database.imports.put(run)
  })

  return run
}

/** The game ids a run wrote: the ones it inserted and the ones it overwrote. */
function touchedBy(run: ImportRun): Set<string> {
  return new Set([...run.insertedGameIds, ...run.replacedGames.map((g) => g.id)])
}

/**
 * Later runs that wrote any game this run wrote, which make undoing it unsafe.
 *
 * Undo restores this run's pre-images and deletes its inserts. If a later run has
 * since updated one of those games, the pre-image would silently overwrite the
 * later run's values — and a later run's own undo would then resurrect a game this
 * one deleted. Runs that touched other games are independent and do not block.
 */
export function undoBlockers(runId: string, imports: ImportRun[]): ImportRun[] {
  const run = imports.find((r) => r.id === runId)
  if (!run) return []
  const mine = touchedBy(run)
  return imports.filter(
    (other) =>
      other.id !== run.id &&
      other.importedAt > run.importedAt &&
      [...touchedBy(other)].some((id) => mine.has(id)),
  )
}

export class ImportUndoBlockedError extends Error {
  constructor(readonly blockers: ImportRun[]) {
    super(
      `A later import (${blockers.map((b) => b.fileName).join(', ')}) changed games this one wrote. Undo ${
        blockers.length === 1 ? 'it' : 'those'
      } first.`,
    )
  }
}

/**
 * Reverses an import: inserted games are removed, overwritten games restored.
 * Annotations are left alone, since they were never part of the import.
 *
 * Refuses, writing nothing, while a later run has touched the same games — see
 * `undoBlockers`.
 */
export async function undoImport(importId: string, database: AppDatabase = db): Promise<void> {
  await database.transaction('rw', [database.games, database.imports], async () => {
    const run = await database.imports.get(importId)
    if (!run) throw new Error(`No import with id ${importId}`)

    const blockers = undoBlockers(importId, await database.imports.toArray())
    if (blockers.length) throw new ImportUndoBlockedError(blockers)

    if (run.insertedGameIds.length) await database.games.bulkDelete(run.insertedGameIds)
    if (run.replacedGames.length) await database.games.bulkPut(run.replacedGames)
    await database.imports.delete(importId)
  })
}

// ---------------------------------------------------------------------------
// Reference data writes
// ---------------------------------------------------------------------------

export async function saveParks(parks: Park[], database: AppDatabase = db): Promise<void> {
  await database.parks.bulkPut(parks)
}

export async function deletePark(id: string, database: AppDatabase = db): Promise<void> {
  await database.parks.delete(id)
}

/**
 * Folds one park's aliases and patterns into another, then deletes it.
 *
 * Trip annotations are keyed `date|parkId`, so every one on the merged park is
 * re-keyed to the survivor in the same transaction — otherwise a mileage override
 * or a logged expense would silently detach from its trip. Where both parks were
 * worked on one day the two trips become one, and their annotations are combined.
 */
export async function mergeParks(
  keepId: string,
  mergeId: string,
  database: AppDatabase = db,
): Promise<void> {
  if (keepId === mergeId) return
  await database.transaction('rw', [database.parks, database.tripAnnotations], async () => {
    const keep = await database.parks.get(keepId)
    const merge = await database.parks.get(mergeId)
    if (!keep || !merge) throw new Error('Both parks must exist to merge them')

    await database.parks.put({
      ...keep,
      aliases: [...new Set([...keep.aliases, ...merge.aliases])],
      venuePatterns: [...new Set([...keep.venuePatterns, ...merge.venuePatterns])],
      // Keep whichever figures the surviving park already had.
      oneWayMiles: keep.oneWayMiles ?? merge.oneWayMiles,
      oneWayDriveMinutes: keep.oneWayDriveMinutes ?? merge.oneWayDriveMinutes,
      tollEstimate: keep.tollEstimate ?? merge.tollEstimate,
      notes: [keep.notes, merge.notes].filter(Boolean).join(' / ') || undefined,
    })
    await database.parks.delete(mergeId)

    const moving = (await database.tripAnnotations.toArray()).filter(
      (a) => parseTripKey(a.key).parkId === mergeId,
    )
    for (const annotation of moving) {
      await moveTripAnnotation(annotation, keepId, database)
    }
  })
}

/** Re-keys a trip annotation to another park on the same date, combining on collision. */
async function moveTripAnnotation(
  annotation: TripAnnotation,
  toParkId: string,
  database: AppDatabase,
): Promise<void> {
  const key = tripKey(parseTripKey(annotation.key).date, toParkId)
  if (key === annotation.key) return
  const existing = await database.tripAnnotations.get(key)
  const rekeyed = { ...annotation, key }
  await database.tripAnnotations.put(existing ? mergeTripAnnotations(existing, rekeyed) : rekeyed)
  await database.tripAnnotations.delete(annotation.key)
}

/**
 * Reattaches an orphaned trip annotation — one whose park no longer exists — to a
 * park that does.
 */
export async function reattachTripAnnotation(
  key: string,
  toParkId: string,
  database: AppDatabase = db,
): Promise<void> {
  await database.transaction('rw', [database.parks, database.tripAnnotations], async () => {
    if (!(await database.parks.get(toParkId))) throw new Error(`No park with id ${toParkId}`)
    const annotation = await database.tripAnnotations.get(key)
    if (!annotation) throw new Error(`No trip annotation with key ${key}`)
    await moveTripAnnotation(annotation, toParkId, database)
  })
}

export async function deleteTripAnnotation(key: string, database: AppDatabase = db): Promise<void> {
  await database.tripAnnotations.delete(key)
}

export async function saveDurations(
  durations: AgeGroupDuration[],
  database: AppDatabase = db,
): Promise<void> {
  await database.durations.bulkPut(durations)
}

export async function deleteDuration(key: string, database: AppDatabase = db): Promise<void> {
  await database.durations.delete(key)
}

/**
 * Seeds durations extracted from the source strings without disturbing any the
 * user has entered or edited by hand.
 */
export async function seedDurations(
  extracted: AgeGroupDuration[],
  database: AppDatabase = db,
): Promise<number> {
  return database.transaction('rw', database.durations, async () => {
    const existing = new Set((await database.durations.toArray()).map((d) => d.key))
    const fresh = extracted.filter((d) => !existing.has(d.key))
    if (fresh.length) await database.durations.bulkPut(fresh)
    return fresh.length
  })
}

export async function saveSports(sports: SportProfile[], database: AppDatabase = db): Promise<void> {
  await database.sports.bulkPut(sports)
}

export async function saveGearLevels(levels: GearLevel[], database: AppDatabase = db): Promise<void> {
  await database.gearLevels.bulkPut(levels)
}

export async function saveGearModifiers(
  modifiers: GearModifier[],
  database: AppDatabase = db,
): Promise<void> {
  await database.gearModifiers.bulkPut(modifiers)
}

export async function saveIdentity(identity: Identity, database: AppDatabase = db): Promise<void> {
  await database.identity.put(identity)
}

export async function saveSettings(settings: Settings, database: AppDatabase = db): Promise<void> {
  await database.settings.put(settings)
}

// ---------------------------------------------------------------------------
// Annotation writes
// ---------------------------------------------------------------------------

/** Replaces the whole annotation. Callers holding one field want `patchGameAnnotation`. */
export async function saveGameAnnotation(
  annotation: GameAnnotation,
  database: AppDatabase = db,
): Promise<void> {
  // Every override must be listed here: a field missing from this check would make
  // an annotation carrying only that field look empty, and be deleted on save.
  //
  // `gearModifiers` is tested for presence, not for length. An empty list is a
  // statement — "I wore nothing beyond the uniform" — and it has to outlive a save,
  // because full gear is *assumed* at the plate. Treating `[]` as nothing would
  // delete the record and let the assumption reinstate the gear the user just
  // cleared. Same reasoning as `droveToCancelled === false`.
  const isEmpty =
    annotation.durationMinutesOverride == null &&
    !annotation.gearLevel &&
    annotation.gearModifiers == null &&
    !annotation.sportCodeOverride &&
    !annotation.cancelStage &&
    annotation.droveToCancelled == null &&
    annotation.weatherRelated == null &&
    !annotation.acknowledgedAnomalies?.length &&
    !Object.keys(annotation.anomalyNotes ?? {}).length &&
    !annotation.notes?.trim()
  if (isEmpty) await database.gameAnnotations.delete(annotation.dedupeKey)
  else await database.gameAnnotations.put(annotation)
}

/**
 * Merges a partial annotation into whatever is stored for this game.
 *
 * A control that edits one field — the sport tag, say — has no business knowing
 * the other fields exist, and a UI that rebuilt the record from what it happened
 * to have on screen would silently drop the rest. Pass `undefined` for a field to
 * clear it; omit it to leave it alone.
 */
export async function patchGameAnnotation(
  dedupeKey: string,
  patch: Partial<Omit<GameAnnotation, 'dedupeKey'>>,
  database: AppDatabase = db,
): Promise<void> {
  const existing = await database.gameAnnotations.get(dedupeKey)
  const merged: GameAnnotation = { ...existing, ...patch, dedupeKey }
  // An explicit `undefined` in the patch means "clear"; Dexie would otherwise
  // store the key with an undefined value.
  for (const k of Object.keys(merged) as (keyof GameAnnotation)[]) {
    if (merged[k] === undefined) delete merged[k]
  }
  await saveGameAnnotation(merged, database)
}

/**
 * Records — or withdraws — an acknowledgement that one anomaly on one game is
 * correct as reported.
 *
 * Per game *and* per code: accepting that a cancellation legitimately paid says
 * nothing about whether its missing scheduled fee is also fine. Withdrawing clears
 * the note with it, since a reason for an acknowledgement that no longer exists is
 * just stale text.
 *
 * Nothing about the fee or the status is touched. The anomaly stays listed; it is
 * only marked as settled.
 */
export async function acknowledgeAnomaly(
  dedupeKey: string,
  code: FeeAnomalyCode,
  accepted: boolean,
  note: string | undefined,
  database: AppDatabase = db,
): Promise<void> {
  const existing = await database.gameAnnotations.get(dedupeKey)
  const codes = new Set(existing?.acknowledgedAnomalies ?? [])
  const notes = { ...(existing?.anomalyNotes ?? {}) }

  if (accepted) {
    codes.add(code)
    if (note?.trim()) notes[code] = note.trim()
    else delete notes[code]
  } else {
    codes.delete(code)
    delete notes[code]
  }

  await patchGameAnnotation(
    dedupeKey,
    {
      acknowledgedAnomalies: codes.size ? [...codes] : undefined,
      anomalyNotes: Object.keys(notes).length ? notes : undefined,
    },
    database,
  )
}

export async function saveTripAnnotation(
  annotation: TripAnnotation,
  database: AppDatabase = db,
): Promise<void> {
  const isEmpty =
    annotation.milesOverride == null &&
    annotation.tollsOverride == null &&
    annotation.driveMinutesOverride == null &&
    annotation.prepMinutesOverride == null &&
    annotation.wrapMinutesOverride == null &&
    annotation.expenses.length === 0 &&
    !annotation.notes?.trim()
  if (isEmpty) await database.tripAnnotations.delete(annotation.key)
  else await database.tripAnnotations.put(annotation)
}

// ---------------------------------------------------------------------------
// Custom profiles
// ---------------------------------------------------------------------------

export async function saveCustomProfile(
  profile: SourceProfile,
  requiredColumns: string[],
  database: AppDatabase = db,
): Promise<void> {
  await database.customProfiles.put(dehydrateProfile(profile, requiredColumns))
}

export async function deleteCustomProfile(id: string, database: AppDatabase = db): Promise<void> {
  await database.customProfiles.delete(id)
}

/** Wipes every table. Used by JSON import's replace mode and by the reset action. */
export async function clearAll(database: AppDatabase = db): Promise<void> {
  await database.transaction(
    'rw',
    database.tables,
    async () => {
      await Promise.all(database.tables.map((t) => t.clear()))
    },
  )
}
