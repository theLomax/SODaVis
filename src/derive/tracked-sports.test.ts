/**
 * Sports the user does not track: their games leave every dashboard view but
 * stay in the Tax view, and say so. Runs on the public sample through `derive`.
 */

import { describe, expect, it } from 'vitest'

import { parseDelimited } from '../import/parse'
import { mapRows } from '../import/map'
import { assignrProfile } from '../import/profiles'
import {
  GEAR_LEVELS,
  GEAR_MODIFIERS,
  SEED_CALL_TYPES,
  SEED_SETTINGS,
  SEED_SPORT_PROFILES,
  type Identity,
  type SportProfile,
} from '../model/reference'
import type { Game } from '../model/game'
import type { GeneralExpense } from '../model/annotation'
import type { AppSnapshot } from '../db/repo'
import { derive, type Filter } from '../ui/store'
import { sportSlot } from '../ui/charts/palette'
import { CATEGORICAL_SLOTS } from '../ui/charts/palette'
import { seedAgeGroupDurations } from './resolve'
import { readFixtureSample } from '../../test/sample-data'
import { FIXTURE_PARKS } from '../../test/sample/parks'

const IDENTITY: Identity = { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' }

function sampleGames(): Game[] {
  const parsed = parseDelimited(readFixtureSample())
  return mapRows(parsed.rows, {
    profile: assignrProfile,
    identity: IDENTITY,
    importId: 'imp-1',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  }).games
}

function snapshot(parts: Partial<AppSnapshot>): AppSnapshot {
  const games = parts.games ?? sampleGames()
  return {
    games,
    parks: FIXTURE_PARKS,
    durations: seedAgeGroupDurations(games).seeded,
    sports: SEED_SPORT_PROFILES,
    gearLevels: GEAR_LEVELS,
    gearModifiers: GEAR_MODIFIERS,
    callTypes: SEED_CALL_TYPES,
    identity: IDENTITY,
    settings: SEED_SETTINGS,
    gameAnnotations: [],
    tripAnnotations: [],
    generalExpenses: [],
    gearProducts: [],
    gearItems: [],
    gearSets: [],
    organizations: [],
    vehicles: [],
    imports: [],
    customProfiles: [],
    ...parts,
  } as AppSnapshot
}

const open: Filter = { period: null, sportCodes: [], parkIds: [], model: 'game-drive' }
const untrack = (code: string): SportProfile[] =>
  SEED_SPORT_PROFILES.map((s) => (s.code === code ? { ...s, tracked: false } : s))

describe('untracked sports', () => {
  it('starts with the four sample sports tracked and the new four offered', () => {
    const d = derive(snapshot({}), open)
    expect(d.trackedSports.map((s) => s.code)).toEqual(['C-BB', 'C-FP', 'C-SP', 'C-KB'])
    expect(d.hiddenSports).toEqual([])
  })

  it('hides an untracked sport’s games from every dashboard figure, and keeps them for Tax', () => {
    const all = derive(snapshot({}), open)
    const kickball = all.allResolved.filter((r) => r.sportCode === 'C-KB')
    expect(kickball.length).toBeGreaterThan(0)

    const d = derive(snapshot({ sports: untrack('C-KB') }), open)
    expect(d.trackedSports.map((s) => s.code)).not.toContain('C-KB')
    expect(d.allResolved.some((r) => r.sportCode === 'C-KB')).toBe(false)
    expect(d.resolved.some((r) => r.sportCode === 'C-KB')).toBe(false)
    expect(d.trips.flatMap((t) => t.games).some((g) => g.sportCode === 'C-KB')).toBe(false)
    const kickballIncome = kickball.filter((r) => r.game.status === 'active').reduce((n, r) => n + (r.game.fees.actual ?? 0), 0)
    expect(d.money.grossWorked).toBeCloseTo(all.money.grossWorked - kickballIncome, 2)

    // The Tax view still sees them.
    expect(d.taxResolved.filter((r) => r.sportCode === 'C-KB')).toHaveLength(kickball.length)
    expect(d.hiddenSports).toEqual([{ code: 'C-KB', label: 'Kickball', known: true, games: kickball.length }])
  })

  it('hides a sport code the app does not know, and names it by its code', () => {
    const games = sampleGames()
    games[0] = { ...games[0]!, sportCode: 'C-SOC' }
    const d = derive(snapshot({ games }), open)
    expect(d.allResolved.some((r) => r.sportCode === 'C-SOC')).toBe(false)
    expect(d.hiddenSports).toEqual([{ code: 'C-SOC', label: 'C-SOC', known: false, games: 1 }])
  })

  it('keeps games with no sport code: they cannot be attributed to an untracked sport', () => {
    const d = derive(snapshot({ sports: untrack('C-KB') }), open)
    const unspecified = derive(snapshot({}), open).allResolved.filter((r) => !r.sportCode).length
    expect(d.allResolved.filter((r) => !r.sportCode)).toHaveLength(unspecified)
  })

  it('leaves out a general expense bought only for untracked sports', () => {
    const e = (id: string, sportCodes?: string[]): GeneralExpense => ({
      id,
      date: '2026-04-01',
      amount: 10,
      category: 'gear',
      deductible: true,
      ...(sportCodes ? { sportCodes } : {}),
    })
    const d = derive(
      snapshot({ sports: untrack('C-KB'), generalExpenses: [e('kb', ['C-KB']), e('mixed', ['C-KB', 'C-BB']), e('none')] }),
      open,
    )
    expect(d.money.generalExpenses).toBe(20)
  })
})

describe('sport colors among tracked sports', () => {
  it('numbers tracked sports in canonical order, whichever are tracked', () => {
    expect(sportSlot('C-SP', ['BKB', 'C-SP'])).toBe(1)
    expect(sportSlot('BKB', ['BKB', 'C-SP'])).toBe(2)
  })

  it('keeps the last slot for no sport and for anything untracked', () => {
    expect(sportSlot(undefined, ['BKB', 'C-SP'])).toBe(CATEGORICAL_SLOTS)
    expect(sportSlot('C-BB', ['BKB', 'C-SP'])).toBe(CATEGORICAL_SLOTS)
  })

  it('gives four tracked sports four distinct colors, none the unspecified one', () => {
    const tracked = ['SOC', 'VB', 'FB', 'BKB']
    const slots = tracked.map((c) => sportSlot(c, tracked))
    expect(new Set(slots).size).toBe(4)
    expect(slots).not.toContain(sportSlot(undefined, tracked))
  })
})
