/**
 * JSON export/import. The point is that the data is portable rather than trapped
 * in IndexedDB — a backup file is plain, readable JSON that a future version, or
 * a different tool entirely, can read.
 *
 * Which tables are copied, validated and restored is decided by `tables.ts`. A
 * table that is not in the registry cannot reach a backup, and a `replace`
 * restore cannot silently empty one that is.
 */

import { z } from 'zod'
import type { Game } from '../model/game'
import type { Identity, Settings } from '../model/reference'
import type { AppSnapshot } from './repo'
import { loadSnapshot } from './repo'
import { db, type AppDatabase, type StoredProfile } from './schema'
import { TABLES, backupDataSchema, type TableSpec } from './tables'

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
  const data = { ...snapshot, customProfiles: storedProfiles }

  const counts: Record<string, number> = {}
  for (const spec of TABLES) {
    if (!spec.inCounts) continue
    const value = data[spec.name as keyof typeof data]
    counts[spec.name] = Array.isArray(value) ? value.length : 0
  }

  return {
    format: 'so-datavisualizer-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    data,
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
const backupSchema = z
  .object({
    format: z.literal('so-datavisualizer-backup'),
    version: z.number().int().positive(),
    exportedAt: z.string(),
    data: backupDataSchema(),
  })
  .loose()

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
 *
 * Every registered table is visited. After the writes, any seeded table that is
 * still empty is refilled — that is what keeps a pre-modifier backup from
 * leaving the app with no gear modifiers, and what a new table with a seed gets
 * for free.
 */
export async function restoreBackup(
  backup: BackupFile,
  mode: RestoreMode,
  database: AppDatabase = db,
): Promise<RestoreReport> {
  const d = backup.data as Record<string, unknown>
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

    for (const spec of TABLES) {
      const written = await restoreTable(spec, d[spec.name], mode, database)
      if (spec.name === 'games' && written && typeof written !== 'number') {
        report.games = written
      } else if (spec.name !== 'games' && typeof written === 'number' && spec.name in report) {
        ;(report as unknown as Record<string, number>)[spec.name] = written
      }
    }

    await refillEmptySeeds(database)
  })

  return report
}

async function restoreTable(
  spec: TableSpec,
  raw: unknown,
  mode: RestoreMode,
  database: AppDatabase,
): Promise<number | { inserted: number; skipped: number } | undefined> {
  const table = database.table(spec.name)

  if (spec.merge === 'dedupe') {
    const games = (Array.isArray(raw) ? raw : []) as Game[]
    if (mode === 'replace') {
      if (games.length) await table.bulkPut(games)
      return { inserted: games.length, skipped: 0 }
    }
    const existing = new Set((await table.toArray()).map((g: Game) => g.source.dedupeKey))
    const fresh = games.filter((g) => !existing.has(g.source.dedupeKey))
    if (fresh.length) await table.bulkPut(fresh)
    return { inserted: fresh.length, skipped: games.length - fresh.length }
  }

  if (spec.merge === 'settings') {
    const settings = raw as Settings | undefined
    if (settings && (mode === 'replace' || (await table.count()) === 0)) {
      await table.put(settings)
    }
    return undefined
  }

  if (spec.merge === 'identity') {
    const incoming = raw as Identity | undefined
    if (!incoming) return undefined
    // An identity with no patterns is the blank one seeded on first run, not a
    // choice to preserve — keeping it would leave self undetectable on every game.
    const identity = (await table.get('self')) as Identity | undefined
    if (mode === 'replace' || !identity?.patterns.length) {
      await table.put(incoming)
    }
    return undefined
  }

  const rows = Array.isArray(raw) ? raw : []
  if (spec.optionalInBackup && rows.length === 0) return 0
  return mergeTable(table, rows, spec.keyOf ?? ((r) => r.id as string | undefined), mode)
}

async function refillEmptySeeds(database: AppDatabase): Promise<void> {
  for (const spec of TABLES) {
    if (!spec.seedRows?.length) continue
    const table = database.table(spec.name)
    if ((await table.count()) === 0) await table.bulkPut(spec.seedRows)
  }
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

export { dehydrateProfile, rehydrateProfile } from './schema'
