/**
 * JSON export/import. The point is that the data is portable rather than trapped
 * in IndexedDB — a backup file is plain, readable JSON that a future version, or
 * a different tool entirely, can read.
 */

import { z } from 'zod'
import { GEAR_MODIFIERS } from '../model/reference'
import type { AppSnapshot } from './repo'
import { loadSnapshot } from './repo'
import { db, dehydrateProfile, rehydrateProfile, type AppDatabase, type StoredProfile } from './schema'

export const BACKUP_VERSION = 1

export type BackupFile = {
  format: 'so-datavisualizer-backup'
  version: number
  exportedAt: string
  counts: Record<string, number>
  data: Omit<AppSnapshot, 'customProfiles'> & { customProfiles: StoredProfile[] }
}

export async function exportBackup(database: AppDatabase = db): Promise<BackupFile> {
  const snapshot = await loadSnapshot(database)
  const storedProfiles = await database.customProfiles.toArray()

  return {
    format: 'so-datavisualizer-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      games: snapshot.games.length,
      parks: snapshot.parks.length,
      durations: snapshot.durations.length,
      gameAnnotations: snapshot.gameAnnotations.length,
      tripAnnotations: snapshot.tripAnnotations.length,
      imports: snapshot.imports.length,
    },
    data: { ...snapshot, customProfiles: storedProfiles },
  }
}

export function backupToBlob(backup: BackupFile): Blob {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `so-datavisualizer-backup-${stamp}.json`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates the envelope and the shape of each record, and is deliberately
 * permissive about unknown extra keys so a file written by a newer version still
 * restores what this version understands.
 */
const gameSchema = z.object({
  id: z.string(),
  source: z.object({
    system: z.string(),
    sourceId: z.string().optional(),
    dedupeKey: z.string(),
    importId: z.string(),
    importedAt: z.string(),
    rawRow: z.record(z.string(), z.string()),
  }),
  date: z.string(),
  startTime: z.string(),
  venueRaw: z.string(),
  ageGroupRaw: z.string(),
  status: z.string(),
  fees: z.object({ currency: z.string() }).loose(),
  assignments: z.array(
    z.object({ position: z.string(), official: z.string(), isSelf: z.boolean() }),
  ),
  flags: z.array(z.object({ code: z.string(), message: z.string(), severity: z.string() }).loose()),
}).loose()

const parkSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  venuePatterns: z.array(z.string()),
}).loose()

const backupSchema = z.object({
  format: z.literal('so-datavisualizer-backup'),
  version: z.number().int().positive(),
  exportedAt: z.string(),
  data: z.object({
    games: z.array(gameSchema),
    parks: z.array(parkSchema),
    durations: z.array(
      z.object({ key: z.string(), durationMinutes: z.number(), origin: z.string() }).loose(),
    ),
    sports: z.array(z.object({ code: z.string(), label: z.string() }).loose()),
    gearLevels: z.array(z.object({ id: z.string(), label: z.string() }).loose()),
    // Optional: a backup taken before gear modifiers existed has no such key,
    // and must still restore rather than being rejected as malformed.
    gearModifiers: z
      .array(z.object({ id: z.string(), label: z.string() }).loose())
      .optional(),
    identity: z.object({ id: z.literal('self'), patterns: z.array(z.string()) }).loose(),
    settings: z.object({ id: z.literal('settings') }).loose(),
    gameAnnotations: z.array(z.object({ dedupeKey: z.string() }).loose()),
    tripAnnotations: z.array(
      z.object({ key: z.string(), expenses: z.array(z.object({ id: z.string(), amount: z.number() }).loose()) }).loose(),
    ),
    imports: z.array(z.object({ id: z.string(), importedAt: z.string() }).loose()),
    customProfiles: z.array(z.object({ id: z.string(), label: z.string() }).loose()),
  }),
}).loose()

export type ValidationResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; errors: string[] }

export function validateBackup(raw: unknown): ValidationResult {
  const parsed = backupSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  if (parsed.data.version > BACKUP_VERSION) {
    return {
      ok: false,
      errors: [
        `This backup is version ${parsed.data.version}; this app reads up to version ${BACKUP_VERSION}. Update the app before restoring it.`,
      ],
    }
  }
  return { ok: true, backup: parsed.data as unknown as BackupFile }
}

export type RestoreMode = 'replace' | 'merge'

export type RestoreReport = {
  mode: RestoreMode
  games: { inserted: number; skipped: number }
  parks: number
  durations: number
  gameAnnotations: number
  tripAnnotations: number
  imports: number
  customProfiles: number
}

/**
 * Restores a backup.
 *
 * `replace` wipes first, giving an exact copy of the backup.
 * `merge` adds what is missing and leaves every existing row alone, so restoring
 * an older backup over newer work cannot undo it.
 */
export async function restoreBackup(
  backup: BackupFile,
  mode: RestoreMode,
  database: AppDatabase = db,
): Promise<RestoreReport> {
  const d = backup.data
  const report: RestoreReport = {
    mode,
    games: { inserted: 0, skipped: 0 },
    parks: 0,
    durations: 0,
    gameAnnotations: 0,
    tripAnnotations: 0,
    imports: 0,
    customProfiles: 0,
  }

  await database.transaction('rw', database.tables, async () => {
    if (mode === 'replace') {
      await Promise.all(database.tables.map((t) => t.clear()))
    }

    if (mode === 'replace') {
      await database.games.bulkPut(d.games)
      report.games.inserted = d.games.length
    } else {
      const existing = new Set((await database.games.toArray()).map((g) => g.source.dedupeKey))
      const fresh = d.games.filter((g) => !existing.has(g.source.dedupeKey))
      if (fresh.length) await database.games.bulkPut(fresh)
      report.games.inserted = fresh.length
      report.games.skipped = d.games.length - fresh.length
    }

    report.parks = await mergeTable(database.parks, d.parks, (p) => p.id, mode)
    report.durations = await mergeTable(database.durations, d.durations, (x) => x.key, mode)
    await mergeTable(database.sports, d.sports, (x) => x.code, mode)
    await mergeTable(database.gearLevels, d.gearLevels, (x) => x.id, mode)
    // A backup predating gear modifiers carries none. In `replace` mode every
    // table was just cleared, so accepting that silently would leave the app with
    // no modifiers at all — re-seed the defaults instead of restoring emptiness.
    if (d.gearModifiers?.length) {
      await mergeTable(database.gearModifiers, d.gearModifiers, (x) => x.id, mode)
    } else if ((await database.gearModifiers.count()) === 0) {
      await database.gearModifiers.bulkPut(GEAR_MODIFIERS)
    }
    report.gameAnnotations = await mergeTable(
      database.gameAnnotations,
      d.gameAnnotations,
      (x) => x.dedupeKey,
      mode,
    )
    report.tripAnnotations = await mergeTable(
      database.tripAnnotations,
      d.tripAnnotations,
      (x) => x.key,
      mode,
    )
    report.imports = await mergeTable(database.imports, d.imports, (x) => x.id, mode)
    report.customProfiles = await mergeTable(
      database.customProfiles,
      d.customProfiles,
      (x) => x.id,
      mode,
    )

    // Settings and identity are single rows; a merge keeps what is already set.
    if (mode === 'replace' || (await database.settings.count()) === 0) {
      await database.settings.put(d.settings)
    }
    if (mode === 'replace' || (await database.identity.count()) === 0) {
      await database.identity.put(d.identity)
    }
  })

  return report
}

async function mergeTable<T>(
  table: { toArray(): Promise<T[]>; bulkPut(rows: T[]): Promise<unknown> },
  rows: T[],
  keyOf: (row: T) => string | undefined,
  mode: RestoreMode,
): Promise<number> {
  if (mode === 'replace') {
    if (rows.length) await table.bulkPut(rows)
    return rows.length
  }
  const existing = new Set((await table.toArray()).map(keyOf))
  const fresh = rows.filter((r) => !existing.has(keyOf(r)))
  if (fresh.length) await table.bulkPut(fresh)
  return fresh.length
}

export { dehydrateProfile, rehydrateProfile }
