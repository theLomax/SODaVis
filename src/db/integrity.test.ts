/**
 * Writes that must not lose or corrupt what the user entered: merging parks,
 * undoing an import, restoring a backup.
 *
 * Every record here is invented; these assert behaviour, not anyone's figures.
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppDatabase, seedReferenceData } from './schema'
import { deletePark, mergeParks, reattachTripAnnotation, saveParks } from './repo'
import { orphanedTripAnnotations } from '../derive/trips'
import type { Park } from '../model/reference'

let db: AppDatabase
let counter = 0

beforeEach(async () => {
  db = new AppDatabase(`integrity-db-${counter++}`)
  await db.open()
  await seedReferenceData(db)
})

const park = (id: string, extra: Partial<Park> = {}): Park => ({
  id,
  name: id,
  aliases: [`${id} Field 1`],
  venuePatterns: [],
  ...extra,
})

describe('merging parks', () => {
  beforeEach(async () => {
    await saveParks([park('riverside', { oneWayMiles: 10 }), park('riverside-dup')], db)
  })

  it('moves the merged park’s trip annotations to the survivor', async () => {
    await db.tripAnnotations.put({
      key: '2026-04-11|riverside-dup',
      milesOverride: 23,
      expenses: [{ id: 'e1', amount: 4, category: 'parking', deductible: true }],
    })

    await mergeParks('riverside', 'riverside-dup', db)

    expect(await db.tripAnnotations.get('2026-04-11|riverside-dup')).toBeUndefined()
    const moved = await db.tripAnnotations.get('2026-04-11|riverside')
    expect(moved?.milesOverride).toBe(23)
    expect(moved?.expenses.map((e) => e.id)).toEqual(['e1'])
    expect(orphanedTripAnnotations(await db.tripAnnotations.toArray(), await db.parks.toArray())).toEqual([])
  })

  it('combines annotations when both parks were worked on the same day', async () => {
    await db.tripAnnotations.bulkPut([
      {
        key: '2026-04-11|riverside',
        milesOverride: 30,
        expenses: [{ id: 'a', amount: 5, category: 'tolls', deductible: true }],
        notes: 'first',
      },
      {
        key: '2026-04-11|riverside-dup',
        milesOverride: 12,
        tollsOverride: 2,
        expenses: [{ id: 'b', amount: 7, category: 'meals', deductible: false }],
        notes: 'second',
      },
    ])

    await mergeParks('riverside', 'riverside-dup', db)

    const all = await db.tripAnnotations.toArray()
    expect(all).toHaveLength(1)
    const [merged] = all
    // The survivor's own figure wins, as it does for the park's figures.
    expect(merged!.milesOverride).toBe(30)
    expect(merged!.tollsOverride).toBe(2)
    expect(merged!.expenses.map((e) => e.id).sort()).toEqual(['a', 'b'])
    expect(merged!.notes).toBe('first / second')
  })

  it('leaves other parks’ annotations alone', async () => {
    await saveParks([park('lakeview')], db)
    await db.tripAnnotations.put({ key: '2026-04-11|lakeview', milesOverride: 5, expenses: [] })
    await mergeParks('riverside', 'riverside-dup', db)
    expect((await db.tripAnnotations.get('2026-04-11|lakeview'))?.milesOverride).toBe(5)
  })
})

describe('orphaned trip annotations', () => {
  it('are reported once their park is gone, and can be reattached', async () => {
    await saveParks([park('riverside'), park('gone')], db)
    await db.tripAnnotations.put({ key: '2026-05-02|gone', milesOverride: 9, expenses: [] })
    await deletePark('gone', db)

    const orphans = orphanedTripAnnotations(await db.tripAnnotations.toArray(), await db.parks.toArray())
    expect(orphans.map((a) => a.key)).toEqual(['2026-05-02|gone'])

    await reattachTripAnnotation('2026-05-02|gone', 'riverside', db)
    expect((await db.tripAnnotations.get('2026-05-02|riverside'))?.milesOverride).toBe(9)
    expect(orphanedTripAnnotations(await db.tripAnnotations.toArray(), await db.parks.toArray())).toEqual([])
  })

  it('refuses to reattach to a park that does not exist', async () => {
    await db.tripAnnotations.put({ key: '2026-05-02|gone', expenses: [], notes: 'x' })
    await expect(reattachTripAnnotation('2026-05-02|gone', 'nowhere', db)).rejects.toThrow()
  })
})
