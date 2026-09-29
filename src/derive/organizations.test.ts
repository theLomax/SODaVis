/**
 * Which organization a game was worked for: by hand, by its payor, or from its
 * import, in that order. Runs on the public sample through `derive`.
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
  type Organization,
} from '../model/reference'
import type { Game, ImportRun } from '../model/game'
import type { GameAnnotation } from '../model/annotation'
import type { AppSnapshot } from '../db/repo'
import { derive, type Filter } from '../ui/store'
import { NO_ORGANIZATION, byOrganization } from './metrics'
import { resolveOrganization, seedAgeGroupDurations } from './resolve'
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

const game = (over: Partial<Game> = {}): Game =>
  ({
    id: 'g1',
    source: { system: 'assignr', dedupeKey: 'k1', importId: 'imp-1', importedAt: '', rawRow: {} },
    date: '2026-09-12',
    startTime: '18:00',
    venueRaw: 'Park',
    ageGroupRaw: '12U',
    status: 'active',
    fees: { currency: 'USD' },
    assignments: [],
    flags: [],
    assignor: 'Jordan Pike',
    payor: 'Lakeview YB',
    league: 'Lakeview Youth Baseball',
    ...over,
  }) as Game

const harbor: Organization = { id: 'o-harbor', name: 'Harbor Officials Group', kind: 'association', aliases: ['H&B Officials'] }
const riverbend: Organization = { id: 'o-riverbend', name: 'Riverbend Parks Dept', kind: 'direct' }
const direct: Organization = { id: 'o-direct', name: 'Summer Slam', kind: 'direct' }

describe('resolving a game’s organization', () => {
  it('prefers a hand-set organization over the payor and the import', () => {
    const got = resolveOrganization(game({ payor: 'H&B Officials' }), { dedupeKey: 'k1', organizationId: 'o-direct' }, [harbor, direct], new Map([['imp-1', 'o-harbor']]))
    expect(got).toEqual({ id: 'o-direct', source: 'manual' })
  })

  it('reads the payor as the organization when it is one of its names, case and spacing aside', () => {
    const got = resolveOrganization(game({ payor: '  h&b   OFFICIALS ' }), undefined, [harbor, direct], new Map([['imp-1', 'o-direct']]))
    expect(got).toEqual({ id: 'o-harbor', source: 'payor' })
    expect(resolveOrganization(game({ payor: 'Harbor Officials Group' }), undefined, [harbor], new Map())?.id).toBe('o-harbor')
  })

  it('files a league that pays directly under its direct-contract organization', () => {
    expect(resolveOrganization(game({ payor: 'Riverbend Parks Dept', league: 'Riverbend Parks Dept' }), undefined, [harbor, riverbend], new Map())).toEqual({
      id: 'o-riverbend',
      source: 'payor',
    })
  })

  it('never decides from the assignor or the league', () => {
    // Jordan assigns for an organization; an assignor is not one. A league running games
    // through an association is not the one paying.
    const named = { ...direct, name: 'Jordan Pike', aliases: ['Lakeview Youth Baseball'] }
    expect(resolveOrganization(game({ payor: 'Somebody Else' }), undefined, [named], new Map())).toBeUndefined()
  })

  it('falls back to the import’s organization when the payor names none', () => {
    const got = resolveOrganization(game({ payor: 'Unknown Payor' }), undefined, [harbor, direct], new Map([['imp-1', 'o-direct']]))
    expect(got).toEqual({ id: 'o-direct', source: 'import' })
  })

  it('ignores a reference to an organization that no longer exists', () => {
    const got = resolveOrganization(
      game({ payor: 'Unknown Payor' }),
      { dedupeKey: 'k1', organizationId: 'o-gone' },
      [direct],
      new Map([['imp-1', 'o-also-gone']]),
    )
    expect(got).toBeUndefined()
  })
})

describe('organizations through derive', () => {
  it('raises no missing-organization flag until an organization exists', () => {
    const none = derive(snapshot({}), open)
    expect(none.allResolved.some((r) => r.flags.some((f) => f.code === 'missing-organization'))).toBe(false)

    const some = derive(snapshot({ organizations: [direct] }), open)
    expect(some.allResolved.every((r) => r.flags.some((f) => f.code === 'missing-organization'))).toBe(true)
  })

  it('gives every game its import’s organization, and a hand-set one wins', () => {
    // The sample's payors name no organization, so the import's is the fallback.
    const games = sampleGames()
    const run = { id: 'imp-1', organizationId: 'o-direct' } as ImportRun
    const overridden: GameAnnotation = { dedupeKey: games[0]!.source.dedupeKey, organizationId: 'o-harbor' }
    const d = derive(
      snapshot({ games, organizations: [harbor, direct], imports: [run], gameAnnotations: [overridden] }),
      open,
    )
    const byKey = new Map(d.allResolved.map((r) => [r.game.source.dedupeKey, r]))
    expect(byKey.get(games[0]!.source.dedupeKey)).toMatchObject({ organizationId: 'o-harbor', organizationSource: 'manual' })
    const rest = d.allResolved.filter((r) => r.game.source.dedupeKey !== games[0]!.source.dedupeKey)
    expect(rest.every((r) => r.organizationId === 'o-direct' && r.organizationSource === 'import')).toBe(true)
  })

  it('reports income by organization, keeping the unassigned as their own row', () => {
    const games = sampleGames()
    const overridden: GameAnnotation = { dedupeKey: games[0]!.source.dedupeKey, organizationId: 'o-direct' }
    const d = derive(snapshot({ games, organizations: [direct], gameAnnotations: [overridden] }), open)
    const rows = byOrganization(d.breakdownCtx, (id) => (id === 'o-direct' ? direct.name : id))
    const keys = rows.map((r) => r.key)
    expect(keys).toContain(NO_ORGANIZATION)
    const total = rows.reduce((n, r) => n + r.gross, 0)
    expect(total).toBeCloseTo(d.trips.flatMap((t) => t.games).reduce((n, g) => n + (g.game.fees.actual ?? 0), 0), 2)
  })
})
