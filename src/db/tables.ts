/**
 * The registry of every IndexedDB table the app owns.
 *
 * Adding a table used to mean editing five places by hand: the Dexie version
 * block, `AppSnapshot` / `loadSnapshot`, the backup zod schema, `restoreBackup`,
 * and the counts in `exportBackup`. Miss one and `replace` restore clears the
 * table (`database.tables.map(t => t.clear())`) and never puts it back.
 *
 * One entry here is what those five read. A new table (vehicles, call types,
 * trip blocks, day legs) is a new object in `TABLES` plus a typed field on
 * `AppDatabase` / `AppSnapshot`.
 */

import { z, type ZodType } from 'zod'
import {
  GEAR_LEVELS,
  GEAR_MODIFIERS,
  SEED_IDENTITY,
  SEED_PARKS,
  SEED_SETTINGS,
  SEED_SPORT_PROFILES,
} from '../model/reference'

/** How a snapshot reads the table, and how a merge restore writes it. */
export type TableKind =
  | 'rows'
  | 'imports'
  | 'identity'
  | 'settings'
  | 'profiles'
  | 'gearLevels'
  | 'gearModifiers'

export type TableSpec = {
  name: string
  /** First Dexie schema version that declares this table. */
  since: number
  /** Dexie index spec, including the primary key. */
  indexes: string
  kind: TableKind
  /** Row shape as stored / as it appears under `backup.data`. */
  rowSchema: ZodType
  /** Singletons are one object in the backup; everything else is an array. */
  backupShape: 'array' | 'object'
  /** Absent from backups written before the table existed. */
  optionalInBackup?: boolean
  /** Primary key, for merge-by-key. Games merge on `source.dedupeKey` instead. */
  keyOf?: (row: { [k: string]: unknown }) => string | undefined
  merge: 'key' | 'dedupe' | 'identity' | 'settings'
  /** Written on first run, and after a replace that left the table empty. */
  seedRows?: unknown[]
  /** Include this table's length in `backup.counts`. */
  inCounts?: boolean
}

const gameRowSchema = z
  .object({
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
  })
  .loose()

const parkRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    venuePatterns: z.array(z.string()),
  })
  .loose()

export const TABLES: readonly TableSpec[] = [
  {
    name: 'games',
    since: 1,
    indexes: 'id, &source.dedupeKey, date, status, venueRaw, source.importId, league, assignor, sportCode',
    kind: 'rows',
    rowSchema: gameRowSchema,
    backupShape: 'array',
    keyOf: (row) => row.id as string,
    merge: 'dedupe',
    inCounts: true,
  },
  {
    name: 'imports',
    since: 1,
    indexes: 'id, importedAt',
    kind: 'imports',
    rowSchema: z.object({ id: z.string(), importedAt: z.string() }).loose(),
    backupShape: 'array',
    keyOf: (row) => row.id as string,
    merge: 'key',
    inCounts: true,
  },
  {
    name: 'parks',
    since: 1,
    indexes: 'id, name',
    kind: 'rows',
    rowSchema: parkRowSchema,
    backupShape: 'array',
    keyOf: (row) => row.id as string,
    merge: 'key',
    seedRows: SEED_PARKS,
    inCounts: true,
  },
  {
    name: 'durations',
    since: 1,
    indexes: 'key',
    kind: 'rows',
    rowSchema: z
      .object({ key: z.string(), durationMinutes: z.number(), origin: z.string() })
      .loose(),
    backupShape: 'array',
    keyOf: (row) => row.key as string,
    merge: 'key',
    inCounts: true,
  },
  {
    name: 'sports',
    since: 1,
    indexes: 'code',
    kind: 'rows',
    rowSchema: z.object({ code: z.string(), label: z.string() }).loose(),
    backupShape: 'array',
    keyOf: (row) => row.code as string,
    merge: 'key',
    seedRows: SEED_SPORT_PROFILES,
  },
  {
    name: 'gearLevels',
    since: 1,
    indexes: 'id',
    kind: 'gearLevels',
    rowSchema: z.object({ id: z.string(), label: z.string() }).loose(),
    backupShape: 'array',
    keyOf: (row) => row.id as string,
    merge: 'key',
    seedRows: GEAR_LEVELS,
  },
  {
    name: 'identity',
    since: 1,
    indexes: 'id',
    kind: 'identity',
    rowSchema: z.object({ id: z.literal('self'), patterns: z.array(z.string()) }).loose(),
    backupShape: 'object',
    merge: 'identity',
    seedRows: [SEED_IDENTITY],
  },
  {
    name: 'settings',
    since: 1,
    indexes: 'id',
    kind: 'settings',
    rowSchema: z.object({ id: z.literal('settings') }).loose(),
    backupShape: 'object',
    merge: 'settings',
    seedRows: [SEED_SETTINGS],
  },
  {
    name: 'gameAnnotations',
    since: 1,
    indexes: 'dedupeKey',
    kind: 'rows',
    rowSchema: z.object({ dedupeKey: z.string() }).loose(),
    backupShape: 'array',
    keyOf: (row) => row.dedupeKey as string,
    merge: 'key',
    inCounts: true,
  },
  {
    name: 'tripAnnotations',
    since: 1,
    indexes: 'key',
    kind: 'rows',
    rowSchema: z
      .object({
        key: z.string(),
        expenses: z.array(z.object({ id: z.string(), amount: z.number() }).loose()),
      })
      .loose(),
    backupShape: 'array',
    keyOf: (row) => row.key as string,
    merge: 'key',
    inCounts: true,
  },
  {
    name: 'customProfiles',
    since: 1,
    indexes: 'id',
    kind: 'profiles',
    rowSchema: z.object({ id: z.string(), label: z.string() }).loose(),
    backupShape: 'array',
    keyOf: (row) => row.id as string,
    merge: 'key',
  },
  {
    name: 'gearModifiers',
    since: 2,
    indexes: 'id',
    kind: 'gearModifiers',
    rowSchema: z.object({ id: z.string(), label: z.string() }).loose(),
    backupShape: 'array',
    optionalInBackup: true,
    keyOf: (row) => row.id as string,
    merge: 'key',
    seedRows: GEAR_MODIFIERS,
  },
]

export const TABLE_NAMES = TABLES.map((t) => t.name)

export function schemaVersions(): number[] {
  return [...new Set(TABLES.map((t) => t.since))].sort((a, b) => a - b)
}

/** Dexie `stores()` argument for one schema version — only tables added in that version. */
export function storesAddedIn(version: number): Record<string, string> {
  return Object.fromEntries(
    TABLES.filter((t) => t.since === version).map((t) => [t.name, t.indexes]),
  )
}

/** Zod shape of `backup.data`, built from the registry so a new table is not left unsaved. */
export function backupDataSchema() {
  const shape: Record<string, ZodType> = {}
  for (const t of TABLES) {
    const body = t.backupShape === 'object' ? t.rowSchema : z.array(t.rowSchema)
    shape[t.name] = t.optionalInBackup ? body.optional() : body
  }
  return z.object(shape).loose()
}

export function tableByName(name: string): TableSpec | undefined {
  return TABLES.find((t) => t.name === name)
}
