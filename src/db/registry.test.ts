/**
 * The table registry is the only list of what a backup may clear. These tests
 * lock the invariant that closed the replace-restore hole: every Dexie table is
 * registered, so a restore cannot empty a table it does not know how to refill.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { AppDatabase, seedReferenceData } from './schema'
import { exportBackup, restoreBackup, validateBackup } from './backup'
import { TABLE_NAMES, TABLES, schemaVersions, storesAddedIn } from './tables'

describe('the table registry', () => {
  it('names every Dexie table, so replace cannot empty an unlisted one', async () => {
    const db = new AppDatabase('registry-tables')
    await db.open()
    const live = db.tables.map((t) => t.name).sort()
    expect(live).toEqual([...TABLE_NAMES].sort())
    db.close()
  })

  it('declares schema versions as a contiguous sequence from 1', () => {
    const versions = schemaVersions()
    expect(versions[0]).toBe(1)
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBe(versions[i - 1]! + 1)
    }
    for (const v of versions) {
      expect(Object.keys(storesAddedIn(v)).length).toBeGreaterThan(0)
    }
  })

  it('refills a seeded table that a replace backup omitted', async () => {
    const db = new AppDatabase('registry-refill')
    await db.open()
    await seedReferenceData(db)

    const backup = await exportBackup(db)
    delete (backup.data as { gearModifiers?: unknown }).gearModifiers
    expect(validateBackup(backup).ok).toBe(true)

    await restoreBackup(backup, 'replace', db)
    expect((await db.gearModifiers.toArray()).map((m) => m.id).sort()).toEqual(
      TABLES.find((t) => t.name === 'gearModifiers')!
        .seedRows!.map((r) => (r as { id: string }).id)
        .sort(),
    )
    db.close()
  })

  it('round-trips every registered table through replace', async () => {
    const db = new AppDatabase('registry-roundtrip')
    await db.open()
    await seedReferenceData(db)
    const backup = await exportBackup(db)
    await restoreBackup(backup, 'replace', db)

    for (const spec of TABLES) {
      const count = await db.table(spec.name).count()
      if (spec.seedRows?.length) expect(count, spec.name).toBeGreaterThan(0)
    }
    // Counts in the file are exactly the tables the registry asked to report.
    expect(Object.keys(backup.counts).sort()).toEqual(
      TABLES.filter((t) => t.inCounts)
        .map((t) => t.name)
        .sort(),
    )
    db.close()
  })
})
