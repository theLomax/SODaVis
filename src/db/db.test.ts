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
import {
  acknowledgeAnomaly,
  deleteCallType,
  deleteGearItem,
  deleteGearProduct,
  loadSnapshot,
  patchGameAnnotation,
  saveGameAnnotation,
  patchGearItem,
  patchGearProduct,
  saveGearItem,
  saveGearProduct,
  saveGearSet,
} from './repo'
import { exportBackup, restoreBackup, validateBackup } from './backup'
import { SEED_SETTINGS } from '../model/reference'
import type { GearItem, GearProduct } from '../model/gear'

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

describe('call types', () => {
  it('seeds the four starting calls on a fresh database', async () => {
    expect((await db.callTypes.toArray()).map((t) => t.id).sort()).toEqual([
      'batters-interference',
      'catchers-balk',
      'fourth-out',
      'infield-fly',
    ])
  })

  it('keeps a calls-only annotation, and drops it once the last tag is cleared', async () => {
    await patchGameAnnotation('g1', { calls: ['infield-fly'] }, db)
    expect((await db.gameAnnotations.get('g1'))!.calls).toEqual(['infield-fly'])
    await patchGameAnnotation('g1', { calls: undefined }, db)
    expect(await db.gameAnnotations.get('g1')).toBeUndefined()
  })

  it('strips a deleted type from every game that tagged it', async () => {
    await patchGameAnnotation('g2', { calls: ['infield-fly', 'fourth-out'], notes: 'kept' }, db)
    await deleteCallType('infield-fly', db)
    expect(await db.callTypes.get('infield-fly')).toBeUndefined()
    const stored = await db.gameAnnotations.get('g2')
    expect(stored!.calls).toEqual(['fourth-out'])
    expect(stored!.notes).toBe('kept')
  })

  it('re-seeds rather than restoring emptiness from a pre-calls backup', async () => {
    const backup = await exportBackup(db)
    delete (backup.data as { callTypes?: unknown }).callTypes
    expect(validateBackup(backup).ok).toBe(true)
    await restoreBackup(backup, 'replace', db)
    expect((await db.callTypes.toArray()).map((t) => t.id)).toContain('infield-fly')
  })
})

describe('general expenses', () => {
  const shoes = {
    id: 'shoes',
    date: '2026-04-02',
    amount: 120,
    category: 'gear' as const,
    deductible: true,
    sportCodes: ['C-BB'],
  }

  it('round-trips through a replace restore, sport tags included', async () => {
    await db.generalExpenses.put(shoes)
    const backup = await exportBackup(db)
    expect(backup.counts.generalExpenses).toBe(1)
    await restoreBackup(backup, 'replace', db)
    expect(await db.generalExpenses.get('shoes')).toEqual(shoes)
  })

  it('accepts a backup written before the table existed', async () => {
    await db.generalExpenses.put(shoes)
    const backup = await exportBackup(db)
    delete (backup.data as { generalExpenses?: unknown }).generalExpenses
    expect(validateBackup(backup).ok).toBe(true)
    await restoreBackup(backup, 'merge', db)
    // Merge leaves what is already here alone.
    expect(await db.generalExpenses.get('shoes')).toBeDefined()
  })

  it('reaches the snapshot', async () => {
    await db.generalExpenses.put(shoes)
    expect((await loadSnapshot(db)).generalExpenses.map((e) => e.id)).toEqual(['shoes'])
  })
})

/**
 * Gear inventory. The rules worth locking are the ones that protect references
 * between the three tables: a set never points at a deleted item, and a product
 * cannot vanish from under an item that is still of it.
 */
describe('gear inventory', () => {
  const shirt: GearProduct = {
    id: 'gp-shirt',
    category: 'shirt',
    name: 'V3 short-sleeve shirt',
    brand: 'Example Co',
    color: 'Black',
    brandProductId: 'EX-V3-BLK',
    origin: 'user',
  }
  const first: GearItem = { id: 'gi-1', productId: 'gp-shirt', label: 'Black V3 #1', acquiredOn: '2025-04-02' }
  const second: GearItem = { id: 'gi-2', productId: 'gp-shirt', label: 'Black V3 #2' }

  it('seeds a starting catalog on first run', async () => {
    const seeded = await db.gearProducts.toArray()
    expect(seeded.length).toBeGreaterThan(0)
    expect(seeded.every((p) => p.origin === 'seed')).toBe(true)
  })

  it('keeps size and price paid per item, through a backup', async () => {
    // Same product, two sizes, two prices: both belong to the piece, not the product.
    await saveGearProduct(shirt, db)
    await saveGearItem({ ...first, size: 'L', pricePaid: 42.5 }, db)
    await saveGearItem({ ...second, size: 'XL', pricePaid: 30 }, db)
    const backup = await exportBackup(db)
    await restoreBackup(backup, 'replace', db)
    expect(await db.gearItems.get('gi-1')).toMatchObject({ size: 'L', pricePaid: 42.5 })
    expect(await db.gearItems.get('gi-2')).toMatchObject({ size: 'XL', pricePaid: 30 })
    expect(await db.gearProducts.get('gp-shirt')).not.toHaveProperty('size')
  })

  it('keeps both of two edits made back to back from the same row', async () => {
    // Tabbing from size to price fires two saves before the view reloads. With
    // whole-row saves the second put the first field back; patches do not.
    await saveGearProduct(shirt, db)
    await saveGearItem({ ...first, size: 'L', pricePaid: 42.5 }, db)
    await Promise.all([
      patchGearItem('gi-1', { size: 'XL' }, db),
      patchGearItem('gi-1', { pricePaid: 39.99 }, db),
    ])
    expect(await db.gearItems.get('gi-1')).toMatchObject({ size: 'XL', pricePaid: 39.99, label: 'Black V3 #1' })
  })

  it('clears a field patched to undefined, and ignores a missing row', async () => {
    await saveGearItem({ ...first, size: 'L', retiredOn: '2026-01-01' }, db)
    await patchGearItem('gi-1', { size: undefined, retiredOn: undefined }, db)
    const item = await db.gearItems.get('gi-1')
    expect(item).not.toHaveProperty('size')
    expect(item).not.toHaveProperty('retiredOn')
    await patchGearItem('no-such-item', { size: 'M' }, db)
    expect(await db.gearItems.get('no-such-item')).toBeUndefined()
  })

  it('patches a catalog product without touching its other fields', async () => {
    await saveGearProduct(shirt, db)
    await Promise.all([
      patchGearProduct('gp-shirt', { brand: 'Other Co' }, db),
      patchGearProduct('gp-shirt', { color: undefined }, db),
    ])
    const p = await db.gearProducts.get('gp-shirt')
    expect(p).toMatchObject({ brand: 'Other Co', brandProductId: 'EX-V3-BLK', name: 'V3 short-sleeve shirt' })
    expect(p).not.toHaveProperty('color')
  })

  it('reads a product saved with the old sku field as a brand product number', async () => {
    // Written straight to the table, as a row from before the split would be.
    await db.gearProducts.put({ ...shirt, brandProductId: undefined, sku: 'OLD-123' } as GearProduct)
    const loaded = (await loadSnapshot(db)).gearProducts.find((p) => p.id === 'gp-shirt')!
    expect(loaded.brandProductId).toBe('OLD-123')
    expect(loaded).not.toHaveProperty('sku')

    // A backup from then restores the same way, since the snapshot reads through it.
    const backup = await exportBackup(db)
    await restoreBackup(backup, 'replace', db)
    expect((await loadSnapshot(db)).gearProducts.find((p) => p.id === 'gp-shirt')!.brandProductId).toBe('OLD-123')
  })

  it('stores identifiers cleaned: UPC digits only, and no half-filled retailer SKU', async () => {
    await saveGearProduct(
      {
        ...shirt,
        upc: '0-36000 29145-2',
        vendorSkus: [
          { vendor: ' Ump Shop ', sku: ' 998 ' },
          { vendor: 'No SKU', sku: ' ' },
        ],
      },
      db,
    )
    expect(await db.gearProducts.get('gp-shirt')).toMatchObject({
      upc: '036000291452',
      vendorSkus: [{ vendor: 'Ump Shop', sku: '998' }],
    })
    await patchGearProduct('gp-shirt', { upc: 'n/a' }, db)
    expect(await db.gearProducts.get('gp-shirt')).not.toHaveProperty('upc')
  })

  it('keeps two copies of one product as two items', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    await saveGearItem(second, db)
    expect(await db.gearItems.where('productId').equals('gp-shirt').count()).toBe(2)
  })

  it('takes a deleted item out of every set that held it', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    await saveGearItem(second, db)
    await saveGearSet({ id: 'gs-plate', name: 'BB: Plate Gear', itemIds: ['gi-1', 'gi-2'] }, db)
    await saveGearSet({ id: 'gs-bases', name: 'BB: Bases', itemIds: ['gi-1'] }, db)

    await deleteGearItem('gi-1', db)

    expect(await db.gearItems.get('gi-1')).toBeUndefined()
    expect((await db.gearSets.get('gs-plate'))!.itemIds).toEqual(['gi-2'])
    expect((await db.gearSets.get('gs-bases'))!.itemIds).toEqual([])
  })

  it('keeps a retired item, and its place in a set', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    await saveGearSet({ id: 'gs-plate', name: 'BB: Plate Gear', itemIds: ['gi-1'] }, db)

    await saveGearItem({ ...first, retiredOn: '2026-08-01' }, db)

    expect((await db.gearItems.get('gi-1'))!.retiredOn).toBe('2026-08-01')
    expect((await db.gearSets.get('gs-plate'))!.itemIds).toEqual(['gi-1'])
  })

  it('refuses to delete a product that an owned item is still of', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    await expect(deleteGearProduct('gp-shirt', db)).rejects.toThrow(/owned item/)
    expect(await db.gearProducts.get('gp-shirt')).toBeDefined()

    await deleteGearItem('gi-1', db)
    await deleteGearProduct('gp-shirt', db)
    expect(await db.gearProducts.get('gp-shirt')).toBeUndefined()
  })

  it('round-trips products, items and sets through a replace restore', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    await saveGearSet({ id: 'gs-plate', name: 'BB: Plate Gear', itemIds: ['gi-1'], sportCode: 'C-BB' }, db)
    const backup = await exportBackup(db)
    expect(backup.counts.gearItems).toBe(1)
    expect(backup.counts.gearSets).toBe(1)

    await restoreBackup(backup, 'replace', db)
    expect(await db.gearProducts.get('gp-shirt')).toEqual(shirt)
    expect(await db.gearItems.get('gi-1')).toEqual(first)
    expect((await db.gearSets.get('gs-plate'))!.sportCode).toBe('C-BB')
  })

  it('accepts a backup written before the gear tables existed, and reseeds the catalog', async () => {
    const backup = await exportBackup(db)
    const data = backup.data as Record<string, unknown>
    delete data.gearProducts
    delete data.gearItems
    delete data.gearSets
    expect(validateBackup(backup).ok).toBe(true)

    await restoreBackup(backup, 'replace', db)
    expect(await db.gearProducts.count()).toBeGreaterThan(0)
    expect(await db.gearItems.count()).toBe(0)
  })

  it('reaches the snapshot', async () => {
    await saveGearProduct(shirt, db)
    await saveGearItem(first, db)
    const snapshot = await loadSnapshot(db)
    expect(snapshot.gearItems.map((i) => i.id)).toEqual(['gi-1'])
    expect(snapshot.gearProducts.some((p) => p.id === 'gp-shirt')).toBe(true)
    expect(snapshot.gearSets).toEqual([])
  })
})
