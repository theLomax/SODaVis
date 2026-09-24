/**
 * Identity is applied when data is read, not only when it is imported.
 *
 * The bug: `isSelf` was stamped at import and never revisited, so a file imported
 * before the identity was set — the natural order on a fresh install — had no self
 * on any game and no partners at all. The UI said to re-import, but a re-import of
 * an unchanged row is reported as unchanged and never rewritten, so that could not
 * fix it either.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { parseDelimited } from '../import/parse'
import { mapRows } from '../import/map'
import { assignrProfile } from '../import/profiles'
import { reconcile } from '../import/reconcile'
import { AppDatabase, seedReferenceData } from '../db/schema'
import { commitImport, loadSnapshot, saveIdentity } from '../db/repo'
import { SEED_IDENTITY, type Identity } from '../model/reference'
import type { Game } from '../model/game'
import { derive } from '../ui/store'
import { readFixtureSample } from '../../test/sample-data'
import { fixtureFigures as expected } from '../../test/expected'
import { resolveGames, reresolveIdentity } from './resolve'

const FIXTURE_IDENTITY: Identity = { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' }
const BLANK: Identity = { ...SEED_IDENTITY, patterns: [] }

function importWith(identity: Identity): Game[] {
  const parsed = parseDelimited(readFixtureSample())
  return mapRows(parsed.rows, {
    profile: assignrProfile,
    identity,
    importId: 'test',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  }).games
}

const soloCount = (games: { partners: unknown[] }[]) => games.filter((r) => r.partners.length === 0).length
const partnerKeys = (games: { partners: { key: string }[] }[]) =>
  new Set(games.flatMap((r) => r.partners.map((p) => p.key))).size
const selfNotFound = (games: { flags: { code: string }[] }[]) =>
  games.filter((r) => r.flags.some((f) => f.code === 'self-not-found')).length

const ctx = (identity?: Identity) => ({
  parks: [],
  durations: new Map(),
  sports: new Map(),
  annotations: new Map(),
  ...(identity ? { identity } : {}),
})

describe('identity applied at read time', () => {
  it('reproduces the bug without it: a blank-identity import has no self and no partners', () => {
    const resolved = resolveGames(importWith(BLANK), ctx())
    expect(selfNotFound(resolved)).toBe(resolved.length)
    expect(resolved.every((r) => r.game.assignments.every((a) => !a.isSelf))).toBe(true)
  })

  it('derives self and partners from the current identity, whatever was stamped at import', () => {
    const resolved = resolveGames(importWith(BLANK), ctx(FIXTURE_IDENTITY))
    expect(selfNotFound(resolved)).toBe(0)
    expect(soloCount(resolved)).toBe(expected.games.solo)
    expect(partnerKeys(resolved)).toBe(expected.games.partners)
  })

  it('matches importing with the identity already set', () => {
    const late = resolveGames(importWith(BLANK), ctx(FIXTURE_IDENTITY))
    const early = resolveGames(importWith(FIXTURE_IDENTITY), ctx(FIXTURE_IDENTITY))
    expect(late.map((r) => r.partners)).toEqual(early.map((r) => r.partners))
  })

  it('withdraws self when the identity is cleared', () => {
    const resolved = resolveGames(importWith(FIXTURE_IDENTITY), ctx(BLANK))
    expect(selfNotFound(resolved)).toBe(resolved.length)
  })

  it('returns the same game object when nothing changes', () => {
    const [game] = importWith(FIXTURE_IDENTITY)
    expect(reresolveIdentity(game!, FIXTURE_IDENTITY)).toBe(game)
  })

  it('works end to end: import, then save an identity, with no re-import', async () => {
    const db = new AppDatabase('identity-after-import')
    await db.open()
    await seedReferenceData(db)

    // A fresh install: the seeded identity is blank when the file goes in.
    const games = importWith((await loadSnapshot(db)).identity)
    const plan = reconcile([], games)
    await commitImport(
      {
        inserts: plan.inserts,
        updates: [],
        unchangedCount: 0,
        conflictCount: 0,
        fileName: 'sample.csv',
        profileId: 'assignr',
        profileLabel: 'Assignr',
        rowsInFile: games.length,
        rowsSkipped: 0,
      },
      db,
    )
    const before = derive(await loadSnapshot(db), {
      period: null,
      sportCodes: [],
      parkIds: [],
      model: 'game-drive',
    })
    expect(selfNotFound(before.allResolved)).toBe(games.length)

    await saveIdentity(FIXTURE_IDENTITY, db)
    const after = derive(await loadSnapshot(db), {
      period: null,
      sportCodes: [],
      parkIds: [],
      model: 'game-drive',
    })
    expect(selfNotFound(after.allResolved)).toBe(0)
    expect(soloCount(after.allResolved)).toBe(expected.games.solo)
    expect(partnerKeys(after.allResolved)).toBe(expected.games.partners)

    // And the stored facts were not rewritten to get there.
    expect((await db.games.toArray()).every((g) => g.assignments.every((a) => !a.isSelf))).toBe(true)
    db.close()
  })
})
