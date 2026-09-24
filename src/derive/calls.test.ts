/**
 * Call tags: slug ids, resolution onto a game, and the count breakdown.
 */

import { describe, expect, it } from 'vitest'

import { callTypeId, SEED_CALL_TYPES } from '../model/reference'
import { resolveGame, type ResolveContext } from './resolve'
import { byCall, type BreakdownContext } from './metrics'
import type { Game } from '../model/game'
import type { Trip } from './trips'

function game(id: string): Game {
  return {
    id,
    source: {
      system: 'assignr',
      dedupeKey: id,
      importId: 't',
      importedAt: '2026-01-01T00:00:00.000Z',
      rawRow: {},
    },
    date: '2026-07-08',
    startTime: '18:00',
    venueRaw: 'Northside',
    ageGroupRaw: '10U',
    status: 'active',
    fees: { actual: 45, currency: 'USD' },
    assignments: [],
    flags: [],
  }
}

const emptyCtx: ResolveContext = {
  parks: [],
  durations: new Map(),
  sports: new Map(),
  annotations: new Map(),
}

describe('callTypeId', () => {
  it('drops apostrophes so the seed labels get stable slugs', () => {
    expect(callTypeId("Batter's Interference")).toBe('batters-interference')
    expect(callTypeId("Catcher's Balk")).toBe('catchers-balk')
    expect(callTypeId('Infield Fly')).toBe('infield-fly')
  })
})

describe('resolveGame calls', () => {
  it('defaults to none, and surfaces tags from the annotation', () => {
    expect(resolveGame(game('a'), emptyCtx).calls).toEqual([])
    const tagged = resolveGame(game('b'), {
      ...emptyCtx,
      annotations: new Map([['b', { dedupeKey: 'b', calls: ['infield-fly', 'fourth-out'] }]]),
    })
    expect(tagged.calls).toEqual(['infield-fly', 'fourth-out'])
  })
})

describe('byCall', () => {
  it('counts a game toward each tag and keeps unused types at zero', () => {
    const g = resolveGame(game('c'), {
      ...emptyCtx,
      annotations: new Map([['c', { dedupeKey: 'c', calls: ['infield-fly', 'fourth-out'] }]]),
    })
    const trip = { games: [g] } as Trip
    const ctx = { trips: [trip] } as BreakdownContext
    const rows = byCall(ctx, SEED_CALL_TYPES)
    expect(rows.find((r) => r.key === 'infield-fly')!.games).toBe(1)
    expect(rows.find((r) => r.key === 'fourth-out')!.games).toBe(1)
    expect(rows.find((r) => r.key === 'catchers-balk')!.games).toBe(0)
    expect(rows).toHaveLength(SEED_CALL_TYPES.length)
  })
})
