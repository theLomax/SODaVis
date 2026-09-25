/**
 * General expenses: in net take-home and the tax year, never in a per-hour rate,
 * and scoped by the filter the way a trip-less cost has to be.
 *
 * Runs on the public sample through `derive`, so it needs no private data.
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
} from '../model/reference'
import type { GeneralExpense } from '../model/annotation'
import type { AppSnapshot } from '../db/repo'
import { derive, type Filter } from '../ui/store'
import { generalExpensesInScope } from './money'
import { taxYear } from './tax'
import { seedAgeGroupDurations } from './resolve'
import { readFixtureSample } from '../../test/sample-data'
import { FIXTURE_PARKS } from '../../test/sample/parks'

const FIXTURE_IDENTITY: Identity = { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' }

function snapshot(generalExpenses: GeneralExpense[]): AppSnapshot {
  const parsed = parseDelimited(readFixtureSample())
  const games = mapRows(parsed.rows, {
    profile: assignrProfile,
    identity: FIXTURE_IDENTITY,
    importId: 'fixture',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  }).games
  return {
    games,
    parks: FIXTURE_PARKS,
    durations: seedAgeGroupDurations(games).seeded,
    sports: SEED_SPORT_PROFILES,
    gearLevels: GEAR_LEVELS,
    gearModifiers: GEAR_MODIFIERS,
    callTypes: SEED_CALL_TYPES,
    identity: FIXTURE_IDENTITY,
    settings: SEED_SETTINGS,
    gameAnnotations: [],
    tripAnnotations: [],
    generalExpenses,
    imports: [],
    customProfiles: [],
  }
}

const open: Filter = { period: null, sportCodes: [], parkIds: [], model: 'game-drive' }

const shoes: GeneralExpense = {
  id: 'shoes',
  date: '2026-04-02',
  amount: 120,
  category: 'gear',
  deductible: true,
}
const dues: GeneralExpense = {
  id: 'dues',
  date: '2025-12-15',
  amount: 60,
  category: 'dues',
  deductible: true,
  sportCodes: ['C-BB'],
}
const lunch: GeneralExpense = {
  id: 'lunch',
  date: '2026-06-01',
  amount: 15,
  category: 'meals',
  deductible: false,
  sportCodes: ['C-FP'],
}

describe('general expenses in scope', () => {
  it('keeps everything with no filter', () => {
    expect(generalExpensesInScope([shoes, dues, lunch], open)).toHaveLength(3)
  })

  it('scopes by purchase date, inclusive at both ends', () => {
    const period = { start: '2026-04-02', end: '2026-06-01' }
    expect(generalExpensesInScope([shoes, dues, lunch], { ...open, period }).map((e) => e.id)).toEqual([
      'shoes',
      'lunch',
    ])
  })

  it('counts none under a park filter, since none belongs to a park', () => {
    expect(generalExpensesInScope([shoes, dues, lunch], { ...open, parkIds: ['northside'] })).toEqual([])
  })

  it('counts only tagged ones under a sport filter, never the untagged', () => {
    expect(
      generalExpensesInScope([shoes, dues, lunch], { ...open, sportCodes: ['C-BB'] }).map((e) => e.id),
    ).toEqual(['dues'])
  })
})

describe('general expenses in the totals', () => {
  it('come off net take-home', () => {
    const without = derive(snapshot([]), open)
    const withThem = derive(snapshot([shoes, dues, lunch]), open)
    expect(withThem.money.generalExpenses).toBe(195)
    expect(withThem.money.deductibleGeneralExpenses).toBe(180)
    expect(withThem.money.net).toBeCloseTo(without.money.net - 195, 2)
  })

  it('never touch a per-hour rate', () => {
    const without = derive(snapshot([]), open)
    const withThem = derive(snapshot([shoes, dues, lunch]), open)
    expect(withThem.rates.netPerHourByModel).toEqual(without.rates.netPerHourByModel)
    expect(withThem.rates.grossPerHourByModel).toEqual(without.rates.grossPerHourByModel)
  })

  it('join the tax year of their purchase date, by category', () => {
    const d = derive(snapshot([shoes, dues, lunch]), open)
    const base = derive(snapshot([]), open)
    const tax = (s: typeof d, general: GeneralExpense[]) =>
      taxYear(2026, s.allResolved, s.allTrips, new Map(), s.snapshot.settings, general)

    const t = tax(d, [shoes, dues, lunch])
    const t0 = tax(base, [])
    // Dues were bought in 2025, so only the shoes and lunch land in 2026.
    expect(t.expensesTotal).toBeCloseTo(t0.expensesTotal + 135, 2)
    expect(t.deductibleExpenses).toBeCloseTo(t0.deductibleExpenses + 120, 2)
    expect(t.expensesByCategory.find((c) => c.category === 'gear')?.total).toBe(120)
    expect(t.expensesByCategory.find((c) => c.category === 'dues')).toBeUndefined()
  })
})
