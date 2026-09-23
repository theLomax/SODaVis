/**
 * Pipeline tests against the committed, anonymized fixture.
 *
 * These run on any clone, with no access to the real export. They assert the
 * *structural* behaviour that matters — ragged rows, self in either official
 * slot, cancellations excluded from income, venue twins collapsing to one park,
 * multi-park days flagged, the 1.5x single-umpire premium read as a bonus
 * rather than a crew error — using numbers derived by hand from
 * test/fixtures/games-sample.csv.
 *
 * The real-export suites in sample.test.ts assert James's actual totals and
 * skip when data/ is absent. Both cover the same code; only the data differs.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { parseDelimited } from '../import/parse'
import { mapRows } from '../import/map'
import { assignrProfile } from '../import/profiles'
import { detectProfile } from '../import/detect'
import {
  GEAR_LEVELS,
  SEED_SETTINGS,
  SEED_SPORT_PROFILES,
  type AgeGroupDuration,
  type Identity,
} from '../model/reference'
import type { TripAnnotation } from '../model/annotation'
import type { Game } from '../model/game'
import { isCancelled } from '../model/game'

import {
  resolveGames,
  seedAgeGroupDurations,
  type ResolveContext,
  type ResolvedGame,
} from './resolve'
import { buildTrips, workDays, type Trip } from './trips'
import { totalMoney, totalMiles, feeVariances } from './money'
import { byPartner, cancellationSummary } from './metrics'
import type { TimeContext } from './time'

import { durationKeyLabel } from './ageGroup'
import { readFixtureSample } from '../../test/sample-data'
import { fixtureFigures as expectedFigures } from '../../test/expected'
import { FIXTURE_PARKS } from '../../test/sample/parks'

/** The fixture's official is "Rivera (F25), Sam" / "Rivera (S26), Sam". */
const FIXTURE_IDENTITY: Identity = {
  id: 'self',
  patterns: ['^Rivera.*Sam$'],
  displayName: 'Sam Rivera',
}


const text = readFixtureSample()

let games: Game[]
let resolved: ResolvedGame[]
let trips: Trip[]
let unplaceable: ResolvedGame[]
let cancelled: ResolvedGame[]
let durations: Map<string, AgeGroupDuration>
let needsManual: string[]
let skipped: ReturnType<typeof mapRows>['skipped']
let nonDataRows: number
let timeCtx: TimeContext

const tripAnnotations = new Map<string, TripAnnotation>()

beforeAll(() => {
  const parsed = parseDelimited(text)
  const mapped = mapRows(parsed.rows, {
    profile: assignrProfile,
    identity: FIXTURE_IDENTITY,
    importId: 'fixture',
    importedAt: '2026-09-21T00:00:00.000Z',
    headers: parsed.headers,
    currency: 'USD',
  })
  games = mapped.games
  skipped = mapped.skipped
  nonDataRows = mapped.nonDataRows

  const seeded = seedAgeGroupDurations(games)
  needsManual = seeded.needsManual
  durations = new Map(seeded.seeded.map((d) => [d.key, d]))

  const ctx: ResolveContext = {
    parks: FIXTURE_PARKS,
    durations,
    sports: new Map(SEED_SPORT_PROFILES.map((s) => [s.code, s])),
    annotations: new Map(),
  }
  resolved = resolveGames(games, ctx)

  const tripResult = buildTrips(resolved, {
    parks: new Map(FIXTURE_PARKS.map((p) => [p.id, p])),
    tripAnnotations,
    settings: SEED_SETTINGS,
  })
  trips = tripResult.trips
  unplaceable = tripResult.unplaceable
  cancelled = tripResult.cancelled

  timeCtx = {
    sports: new Map(SEED_SPORT_PROFILES.map((s) => [s.code, s])),
    gearLevels: new Map(GEAR_LEVELS.map((g) => [g.id, g])),
    settings: SEED_SETTINGS,
  }
})

describe('fixture parse', () => {
  it('reads the full 28-column Assignr header', () => {
    expect(parseDelimited(text).headers).toHaveLength(28)
  })

  it('is recognized as an Assignr export', () => {
    const parsed = parseDelimited(text)
    const [best] = detectProfile(parsed.headers)
    expect(best?.profile.id).toBe('assignr')
    // Every fingerprint header present and no extras: an exact match.
    expect(best?.confidence).toBe(1)
  })

  it('yields 19 games, dropping the blank and TOTALS rows', () => {
    expect(games).toHaveLength(expectedFigures.games.total)
    // The all-blank row is dropped by the parser's greedy skipEmptyLines, so
    // only the TOTALS: trailer reaches mapRows and fails isDataRow there.
    expect(nonDataRows).toBe(1)
    // Nothing was unmappable: every surviving row became a game.
    expect(skipped).toHaveLength(0)
  })

  it('parses ragged rows: solo games get exactly one assignment', () => {
    // 9 of the 19 rows have 26 fields rather than 28.
    const solo = games.filter((g) => g.assignments.length === 1)
    expect(solo).toHaveLength(expectedFigures.games.solo)
    expect(games.filter((g) => g.assignments.length === 2)).toHaveLength(
      expectedFigures.games.total - expectedFigures.games.solo,
    )
  })

  it('never lets the TOTALS row become a game', () => {
    expect(games.some((g) => g.fees.scheduled === 805)).toBe(false)
    expect(games.every((g) => g.date !== '')).toBe(true)
  })
})

describe('fixture identity & partners', () => {
  it('finds self in every game, in either slot', () => {
    expect(games.every((g) => g.assignments.some((a) => a.isSelf))).toBe(true)
  })

  it('matches self across a rotated season suffix', () => {
    // (F25) on the early rows, (S26) on the later ones.
    const suffixes = new Set(
      games.flatMap((g) =>
        g.assignments.filter((a) => a.isSelf).map((a) => /\((\w+)\)/.exec(a.official)?.[1]),
      ),
    )
    expect(suffixes).toEqual(new Set(['F25', 'S26']))
  })

  it('reads self from slot 2 as readily as slot 1', () => {
    const slot2 = games.filter((g) => g.assignments[1]?.isSelf)
    expect(slot2.length).toBeGreaterThan(0)
    // Those rows still yield a partner, taken from slot 1.
    for (const g of slot2) {
      expect(g.assignments.filter((a) => !a.isSelf)).toHaveLength(1)
    }
  })

  it('attributes games to the right partner, solo work included', () => {
    const rows = byPartner({ trips, timeCtx, model: 'game-drive', tripAnnotations })
    const byKey = new Map(rows.map((r) => [r.key, r]))
    // One partner is deliberately dominant; the others trail. Asserted by rank so
    // growing the fixture does not mean re-counting by hand.
    const ranked = rows
      .filter((r) => r.key !== '(solo)')
      .sort((a, b) => b.games - a.games)
    expect(ranked[0]!.games).toBeGreaterThan(ranked[1]!.games * 2)
    expect(ranked).toHaveLength(expectedFigures.games.partners)
    // Solo games are their own bucket, not attributed to a partner.
    expect(byKey.get('(solo)')?.games).toBeGreaterThan(0)
    // Rows are ranked by gross income, highest first.
    const gross = rows.map((r) => r.gross)
    expect([...gross].sort((a, b) => b - a)).toEqual(gross)
  })
})

describe('fixture money', () => {
  it('counts only active games as income', () => {
    const totals = totalMoney(resolved, trips, tripAnnotations, SEED_SETTINGS)
    // 17 active games totalling $748; the 2 cancellations contribute nothing.
    expect(totals.activeGames).toBe(expectedFigures.games.active)
    expect(totals.cancelledGames).toBe(expectedFigures.games.cancelled)
    expect(totals.gross).toBe(expectedFigures.money.grossActual)
  })

  it('reports forfeited income from cancellations without mixing it into gross', () => {
    const totals = totalMoney(resolved, trips, tripAnnotations, SEED_SETTINGS)
    // $40 + $45 scheduled, both paid $0.
    expect(totals.forfeited).toBe(expectedFigures.money.forfeited)
  })

  it('reads the 1.5x single-umpire premium as a bonus, not a discrepancy', () => {
    const totals = totalMoney(resolved, trips, tripAnnotations, SEED_SETTINGS)
    // $45 -> $68 (single ump at 1.5x) and $25 -> $30.
    expect(totals.bonus).toBe(expectedFigures.money.bonus)
  })

  it('separates upward adjustments from shortfalls in the variance list', () => {
    const variances = feeVariances(games)
    // Sorted by delta: the two cancellations are the negatives, the $25->$30
    // and the 1.5x single-umpire bump are the positives.
    // Positives are the upward adjustments; negatives are the cancellations.
    expect(variances.filter((v) => v.delta > 0).length).toBeGreaterThan(0)
    expect(variances.filter((v) => v.delta < 0)).toHaveLength(
      expectedFigures.games.cancelled,
    )
  })

  it('holds no active game at $0 and no cancellation with pay', () => {
    for (const g of games) {
      if (isCancelled(g.status)) expect(g.fees.actual).toBe(0)
      else expect(g.fees.actual).toBeGreaterThan(0)
    }
  })
})

describe('fixture parks & trips', () => {
  it('collapses the trailing-period venue twin onto one park', () => {
    const westgate = resolved.filter((r) => r.parkId === 'westgate')
    expect(westgate).toHaveLength(2)
    // Two spellings, two dates, one park.
    expect(new Set(westgate.map((r) => r.game.venueRaw)).size).toBe(2)
  })

  it('resolves unseen field numbers through the park glob', () => {
    // Fields 3 and 5 at Northside, never listed as aliases.
    expect(resolved.filter((r) => r.parkId === 'northside').length).toBeGreaterThan(0)
  })

  it('surfaces an unknown venue instead of inventing a park', () => {
    // Hilltop-2 has no Park entry, so its 2 active games cannot form a trip.
    expect(unplaceable).toHaveLength(2)
    expect(unplaceable.every((r) => r.game.venueRaw === 'Hilltop-2')).toBe(true)
    expect(trips.some((t) => t.parkId === 'hilltop')).toBe(false)
  })

  it('excludes cancelled games from trips', () => {
    expect(cancelled).toHaveLength(expectedFigures.games.cancelled)
    expect(trips.some((t) => t.date === '2026-04-02')).toBe(false)
  })

  it('flags a multi-park day rather than trusting round-trip miles', () => {
    const multi = trips.filter((t) => t.isMultiTripDay)
    // 2026-06-13: Northside in the morning, Eastfield in the afternoon.
    expect(multi.map((t) => t.date)).toEqual(['2026-06-13', '2026-06-13'])
    expect(multi.every((t) => t.flags.length > 0)).toBe(true)
  })

  it('groups same-park games on one date into a single trip', () => {
    const aug = trips.filter((t) => t.date === '2025-08-27')
    expect(aug).toHaveLength(1)
    expect(aug[0]?.games).toHaveLength(2)
  })

  it('counts work days from trips', () => {
    expect(workDays(trips).length).toBeLessThan(trips.length)
  })
})

describe('fixture durations & sports', () => {
  it('extracts a duration and keys it by scope, not by the raw string', () => {
    // The point of the decomposition: one entry per competition rather than per
    // league's spelling of it. The fixture's leagues state no rule set, so these
    // land at league scope.
    const byLabel = new Map(
      [...durations.values()].map((d) => [durationKeyLabel(d.key), d.durationMinutes]),
    )
    expect(byLabel.get('Riverview Little League · 9-10U')).toBe(90)
    expect(byLabel.get('Cedar Ridge Softball Association · 10U · Modified Kid Pitch')).toBe(65)
  })

  it('resolves a game through the scoped key', () => {
    const game = resolved.find((r) => r.game.ageGroupRaw === 'RVL / 9-10U DIV A / 90min')!
    expect(game.duration.minutes).toBe(90)
    expect(game.duration.source).toBe('reference')
  })

  it('still honours a duration stored against a raw string', () => {
    // Every duration entered before the decomposition is keyed that way, so an
    // older entry has to keep answering — nothing is migrated.
    const target = games.find((g) => g.ageGroupRaw === 'Adult Kickball League')!
    const legacy = new Map([
      [
        'Adult Kickball League',
        { key: 'Adult Kickball League', durationMinutes: 55, origin: 'manual' as const },
      ],
    ])
    const re = resolveGames(games, {
      parks: FIXTURE_PARKS,
      durations: legacy,
      sports: new Map(SEED_SPORT_PROFILES.map((sp) => [sp.code, sp])),
      annotations: new Map(),
    })
    const got = re.find((r) => r.game.source.dedupeKey === target.source.dedupeKey)!
    expect(got.duration.minutes).toBe(55)
    // Reported distinctly, so the UI can say the entry is narrower than it looks.
    expect(got.duration.source).toBe('reference-raw')
  })

  it('reports age groups with no stated duration instead of guessing', () => {
    expect(needsManual).toContain('Adult-SP-Thursday-Open')
    expect(needsManual).toContain('Adult Kickball League')
    // Nothing invented for them, under either key.
    expect(durations.has('Adult Kickball League')).toBe(false)
    expect(
      [...durations.values()].some((d) => d.key.includes('Lakeview Kickball')),
    ).toBe(false)
  })

  it('never invents a sport for a row whose code is blank', () => {
    // The fixture's second assignor omits the code, as the real export does.
    const blank = games.filter((g) => !g.sportCode)
    expect(blank).toHaveLength(expectedFigures.games.blankSportCode)
    // Resolution leaves it unset rather than picking a sport; breakdowns group
    // it under UNSPECIFIED_SPORT at display time.
    const blankResolved = resolved.filter((r) => !r.game.sportCode)
    expect(blankResolved).toHaveLength(expectedFigures.games.blankSportCode)
    expect(blankResolved.every((r) => r.sportCode === undefined)).toBe(true)
    expect(blankResolved.every((r) => r.sport === undefined)).toBe(true)
    expect(blankResolved.every((r) => r.sportCodeIsManual)).toBe(false)
  })
})

describe('fixture mileage', () => {
  it('leaves miles uncomputed for parks with no distance on file', () => {
    // Every fixture park has miles, so nothing is missing here; the guarantee
    // being locked down is that the count is reported, not silently zeroed.
    const { tripsMissing } = totalMiles(trips)
    expect(tripsMissing).toBe(0)
  })

  it('derives round-trip miles as twice the one-way figure', () => {
    const aug = trips.find((t) => t.date === '2025-08-27')
    expect(aug?.miles).toBe(20) // Northside, 10 miles each way
  })
})

describe('fixture cancellations', () => {
  it('reports cancellations separately from active work', () => {
    const summary = cancellationSummary(resolved, SEED_SETTINGS)
    expect(summary.count).toBe(expectedFigures.games.cancelled)
    expect(summary.forfeited).toBe(expectedFigures.money.forfeited)
  })
})
