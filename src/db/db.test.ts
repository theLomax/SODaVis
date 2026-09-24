/**
 * Database tests that need no real export.
 *
 * These run against fake-indexeddb, so they exercise the real Dexie schema —
 * including the unique index on dedupeKey that makes re-import idempotent — using
 * records they construct themselves.
 *
 * The suites that round-trip the real 216-game export live in the private
 * SODaVis-Tests repository, mounted at `test/private/`. They assert figures that
 * are personal data; these assert behaviour.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

import { AppDatabase, seedReferenceData } from './schema'
import { acknowledgeAnomaly, loadSnapshot, patchGameAnnotation, saveGameAnnotation } from './repo'
import { exportBackup, restoreBackup, validateBackup } from './backup'
import { SEED_SETTINGS } from '../model/reference'

let db: AppDatabase
let counter = 0

beforeEach(async () => {
  db = new AppDatabase(`test-db-${counter++}`)
  await db.open()
  await seedReferenceData(db)
})

/**
 * Cancellation rulings, which are answers rather than values: "I did not drive"
 * must persist as firmly as "I drove 42 miles", because it is what stops the app
 * asking again. A falsy answer that vanished on save would reopen a settled
 * question on every load.
 *
 * Data-independent: these construct annotations directly.
 */
describe('cancellation annotations', () => {
  it('keeps a negative answer, distinguishing it from an unanswered question', async () => {
    await saveGameAnnotation({ dedupeKey: 'no-drive', droveToCancelled: false }, db)
    const stored = await db.gameAnnotations.get('no-drive')
    expect(stored).toBeDefined()
    expect(stored!.droveToCancelled).toBe(false)
  })

  it('builds up a ruling across separate edits', async () => {
    // The stage, the drive and the cause are three different controls; each
    // patch must leave the others alone.
    const key = 'assignr:27059616'
    await patchGameAnnotation(key, { cancelStage: 'after-arrival' }, db)
    await patchGameAnnotation(key, { droveToCancelled: true }, db)
    await patchGameAnnotation(key, { weatherRelated: true }, db)

    const stored = await db.gameAnnotations.get(key)
    expect(stored!.cancelStage).toBe('after-arrival')
    expect(stored!.droveToCancelled).toBe(true)
    expect(stored!.weatherRelated).toBe(true)
  })

  it('reverts one field to unanswered without losing the rest', async () => {
    const key = 'assignr:27059617'
    await patchGameAnnotation(
      key,
      { cancelStage: 'after-arrival', droveToCancelled: true, notes: 'called for lightning' },
      db,
    )
    await patchGameAnnotation(key, { droveToCancelled: undefined }, db)

    const stored = await db.gameAnnotations.get(key)
    expect(stored!.droveToCancelled).toBeUndefined()
    expect(stored!.cancelStage).toBe('after-arrival')
    expect(stored!.notes).toBe('called for lightning')
  })
})

/**
 * Gear modifiers arrived after the first schema version, so both a fresh install
 * and an older backup have to end up with them.
 */

/**
 * Gear modifiers arrived after the first schema version, so both a fresh install
 * and an older backup have to end up with them.
 */
describe('gear modifiers', () => {
  it('seeds the defaults on a fresh database', async () => {
    const ids = (await db.gearModifiers.toArray()).map((m) => m.id).sort()
    expect(ids).toEqual(['casual', 'cold', 'full-gear', 'rain', 'shield'])
  })

  it('marks the shield as plate-only, since only the plate wears one', async () => {
    const shield = await db.gearModifiers.get('shield')
    expect(shield!.plateOnly).toBe(true)
    const cold = await db.gearModifiers.get('cold')
    expect(cold!.plateOnly).toBeUndefined()
  })

  it('re-seeds rather than restoring emptiness from a pre-modifier backup', async () => {
    // `replace` clears every table first, so a backup with no modifiers would
    // otherwise leave the app with none at all.
    const backup = await exportBackup(db)
    delete (backup.data as { gearModifiers?: unknown }).gearModifiers

    await restoreBackup(backup, 'replace', db)
    const ids = (await db.gearModifiers.toArray()).map((m) => m.id).sort()
    expect(ids).toEqual(['casual', 'cold', 'full-gear', 'rain', 'shield'])
  })

  it('accepts a backup that predates the field as valid', async () => {
    const backup = await exportBackup(db)
    delete (backup.data as { gearModifiers?: unknown }).gearModifiers
    expect(validateBackup(backup).ok).toBe(true)
  })

  it('round-trips an edited modifier through a backup', async () => {
    await db.gearModifiers.put({
      id: 'cold',
      label: 'Cold weather',
      prepDeltaMinutes: 12,
      hint: 'Extra layers.',
    })
    const backup = await exportBackup(db)
    await db.gearModifiers.clear()
    await restoreBackup(backup, 'merge', db)
    expect((await db.gearModifiers.get('cold'))!.prepDeltaMinutes).toBe(12)
  })
})

/**
 * Dexie returns rows in primary-key order, which for these ids is alphabetical —
 * so "Bases" would precede "Plate" in a picker. The snapshot restores the ladder.
 */

/**
 * Dexie returns rows in primary-key order, which for these ids is alphabetical —
 * so "Bases" would precede "Plate" in a picker. The snapshot restores the ladder.
 */
describe('gear display order', () => {
  it('presents roles most-gear-first, not alphabetically by id', async () => {
    const snapshot = await loadSnapshot(db)
    expect(snapshot.gearLevels.map((l) => l.id)).toEqual(['plate', 'base'])
    // The raw table is in the order that made this necessary.
    expect((await db.gearLevels.toArray()).map((l) => l.id)).toEqual(['base', 'plate'])
  })

  it('presents conditions in their declared order', async () => {
    const snapshot = await loadSnapshot(db)
    expect(snapshot.gearModifiers.map((m) => m.id)).toEqual([
      'full-gear',
      'shield',
      'casual',
      'cold',
      'rain',
    ])
  })
})

/**
 * Settings gains fields as the app grows, and a row written by an earlier version
 * lacks them. `loadSnapshot` fills from the seed so no consumer has to guard —
 * the rush-hour editor reads `settings.rushHour.startMinutes` directly.
 */

/**
 * Settings gains fields as the app grows, and a row written by an earlier version
 * lacks them. `loadSnapshot` fills from the seed so no consumer has to guard —
 * the rush-hour editor reads `settings.rushHour.startMinutes` directly.
 */
describe('settings forward compatibility', () => {
  it('fills a field missing from an older settings row', async () => {
    const stored = { ...SEED_SETTINGS } as Record<string, unknown>
    delete stored.rushHour
    await db.settings.put(stored as typeof SEED_SETTINGS)

    const snapshot = await loadSnapshot(db)
    expect(snapshot.settings.rushHour).toBeDefined()
    expect(snapshot.settings.rushHour.startMinutes).toBe(SEED_SETTINGS.rushHour.startMinutes)
    expect(snapshot.settings.rushHour.weekdays).toEqual(SEED_SETTINGS.rushHour.weekdays)
  })

  it('keeps an edited value rather than resetting it to the seed', async () => {
    await db.settings.put({
      ...SEED_SETTINGS,
      rushHour: { startMinutes: 16 * 60, endMinutes: 18 * 60, weekdays: [5, 6] },
      arrivalFloorMinutes: 40,
    })
    const snapshot = await loadSnapshot(db)
    expect(snapshot.settings.rushHour.startMinutes).toBe(16 * 60)
    expect(snapshot.settings.rushHour.weekdays).toEqual([5, 6])
    expect(snapshot.settings.arrivalFloorMinutes).toBe(40)
  })

  it('round-trips an edited window through a backup', async () => {
    const window = { startMinutes: 7 * 60, endMinutes: 9 * 60 + 30, weekdays: [0, 3] }
    await db.settings.put({ ...SEED_SETTINGS, rushHour: window })

    const backup = await exportBackup(db)
    expect(validateBackup(backup).ok).toBe(true)
    await db.settings.clear()
    await restoreBackup(backup, 'replace', db)

    expect((await loadSnapshot(db)).settings.rushHour).toEqual(window)
  })
})

/**
 * A fresh install seeds a blank identity, so merging a reference file into it is the
 * documented way to bring a real identity back — and must not be blocked by the blank.
 */
describe('identity on restore', () => {
  const reference = async (patterns: string[]) => {
    const backup = await exportBackup(db)
    backup.data.identity = { id: 'self', patterns, displayName: 'Self' }
    return backup
  }

  it('merge fills the blank identity seeded on first run', async () => {
    await restoreBackup(await reference(['^Rivera \\(']), 'merge', db)
    expect((await db.identity.get('self'))!.patterns).toEqual(['^Rivera \\('])
  })

  it('merge keeps an identity that is already set', async () => {
    await db.identity.put({ id: 'self', patterns: ['^Mine'], displayName: 'Me' })
    await restoreBackup(await reference(['^Theirs']), 'merge', db)
    expect((await db.identity.get('self'))!.patterns).toEqual(['^Mine'])
  })
})

/**
 * Acknowledging a fee anomaly.
 *
 * The acknowledgement is the only record that an oddity was examined and found
 * correct, so it has to survive a re-import — the very event most likely to bring the
 * same odd row back.
 */

/**
 * Acknowledging a fee anomaly.
 *
 * The acknowledgement is the only record that an oddity was examined and found
 * correct, so it has to survive a re-import — the very event most likely to bring the
 * same odd row back.
 */
describe('anomaly acknowledgement', () => {
  it('records an acceptance with its reason', async () => {
    await acknowledgeAnomaly('k1', 'paid-cancellation', true, 'rainout, paid half', db)
    const stored = await db.gameAnnotations.get('k1')
    expect(stored!.acknowledgedAnomalies).toEqual(['paid-cancellation'])
    expect(stored!.anomalyNotes).toEqual({ 'paid-cancellation': 'rainout, paid half' })
  })

  it('accepts without a reason, since the reason is optional', async () => {
    await acknowledgeAnomaly('k2', 'zero-fee-active', true, undefined, db)
    const stored = await db.gameAnnotations.get('k2')
    expect(stored!.acknowledgedAnomalies).toEqual(['zero-fee-active'])
    expect(stored!.anomalyNotes).toBeUndefined()
  })

  it('treats a blank reason as no reason', async () => {
    await acknowledgeAnomaly('k3', 'zero-fee-active', true, '   ', db)
    expect((await db.gameAnnotations.get('k3'))!.anomalyNotes).toBeUndefined()
  })

  it('accumulates codes on one game rather than replacing them', async () => {
    // Two anomalies on one game are two separate judgements.
    await acknowledgeAnomaly('k4', 'paid-cancellation', true, 'partial fee', db)
    await acknowledgeAnomaly('k4', 'no-scheduled-fee', true, 'no rate assigned', db)
    const stored = await db.gameAnnotations.get('k4')
    expect(stored!.acknowledgedAnomalies!.sort()).toEqual(['no-scheduled-fee', 'paid-cancellation'])
    expect(Object.keys(stored!.anomalyNotes!).sort()).toEqual([
      'no-scheduled-fee',
      'paid-cancellation',
    ])
  })

  it('withdraws one acceptance and its note, leaving the other', async () => {
    await acknowledgeAnomaly('k5', 'paid-cancellation', true, 'partial fee', db)
    await acknowledgeAnomaly('k5', 'no-scheduled-fee', true, 'no rate', db)
    await acknowledgeAnomaly('k5', 'paid-cancellation', false, undefined, db)

    const stored = await db.gameAnnotations.get('k5')
    expect(stored!.acknowledgedAnomalies).toEqual(['no-scheduled-fee'])
    // A reason for an acceptance that no longer exists is just stale text.
    expect(stored!.anomalyNotes).toEqual({ 'no-scheduled-fee': 'no rate' })
  })

  it('discards the annotation once the last acceptance is withdrawn', async () => {
    await acknowledgeAnomaly('k6', 'zero-fee-active', true, 'a favour', db)
    await acknowledgeAnomaly('k6', 'zero-fee-active', false, undefined, db)
    expect(await db.gameAnnotations.get('k6')).toBeUndefined()
  })

  it('leaves other annotation fields alone', async () => {
    await patchGameAnnotation('k7', { durationMinutesOverride: 80, notes: 'ran long' }, db)
    await acknowledgeAnomaly('k7', 'zero-fee-active', true, 'scrimmage', db)
    const stored = await db.gameAnnotations.get('k7')
    expect(stored!.durationMinutesOverride).toBe(80)
    expect(stored!.notes).toBe('ran long')
    expect(stored!.acknowledgedAnomalies).toEqual(['zero-fee-active'])
  })
})
