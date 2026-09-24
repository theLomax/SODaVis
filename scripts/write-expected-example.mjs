#!/usr/bin/env node
/**
 * Derives `test/fixtures/expected.example.json` from the committed fixture.
 *
 * The same script shape as `write-expected.mjs`, pointed at the fixture instead of
 * the real export — so the example file cannot drift from the CSV it describes, and
 * regenerating the fixture is a two-command operation rather than a hunt through
 * test files for stale counts.
 *
 *   node scripts/make-fixture.mjs && node scripts/write-expected-example.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseDelimited } from '../src/import/parse.ts'
import { mapRows } from '../src/import/map.ts'
import { assignrProfile } from '../src/import/profiles/index.ts'
import { isCancelled } from '../src/model/game.ts'
import { resolveGames, seedAgeGroupDurations } from '../src/derive/resolve.ts'
import { buildTrips, workDays } from '../src/derive/trips.ts'
import { durationKey, parseAgeGroup } from '../src/derive/ageGroup.ts'
import { anomalyCodesFor } from '../src/derive/anomalies.ts'
import { SEED_SETTINGS, SEED_SPORT_PROFILES } from '../src/model/reference.ts'
import { FIXTURE_PARKS } from '../test/sample/parks.ts'

const FIXTURE = resolve(process.cwd(), 'test/sample/games-sample.csv')
const OUT = resolve(process.cwd(), 'test/sample/expected.json')

const parsed = parseDelimited(readFileSync(FIXTURE, 'utf8'))
const { games } = mapRows(parsed.rows, {
  profile: assignrProfile,
  identity: { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' },
  importId: 'example',
  importedAt: '2026-01-01T00:00:00.000Z',
  headers: parsed.headers,
  currency: 'USD',
})

const seeded = seedAgeGroupDurations(games)
const resolved = resolveGames(games, {
  parks: FIXTURE_PARKS,
  durations: new Map(seeded.seeded.map((d) => [d.key, d])),
  sports: new Map(SEED_SPORT_PROFILES.map((s) => [s.code, s])),
  annotations: new Map(),
})
const { trips } = buildTrips(resolved, {
  parks: new Map(FIXTURE_PARKS.map((p) => [p.id, p])),
  tripAnnotations: new Map(),
  settings: SEED_SETTINGS,
})

const active = games.filter((g) => !isCancelled(g.status))
const round2 = (n) => Math.round(n * 100) / 100
const tripsPerDate = new Map()
for (const t of trips) tripsPerDate.set(t.date, (tripsPerDate.get(t.date) ?? 0) + 1)

const out = {
  _comment: [
    'Expected figures for the committed fixture, by name rather than as magic numbers.',
    '',
    'Derived by scripts/write-expected-example.mjs — do not hand-edit. Re-run it after',
    'scripts/make-fixture.mjs, so the numbers cannot drift from the CSV they describe.',
    '',
    'Every value here belongs to invented games, so nothing in this file is personal.',
    'A machine holding the real export overrides it with data/expected.json.',
    '',
    'Why a file and not constants in the tests: a bare toBe(216) needs a comment',
    'explaining where 216 came from, and that comment is where venue names and income',
    'totals creep back into the repo.',
  ],
  games: {
    total: games.length,
    active: active.length,
    cancelled: games.filter((g) => isCancelled(g.status)).length,
    solo: games.filter((g) => g.assignments.filter((a) => !a.isSelf).length === 0).length,
    partners: new Set(
      games.flatMap((g) => g.assignments.filter((a) => !a.isSelf).map((a) => a.official)),
    ).size,
    blankSportCode: games.filter((g) => !g.sportCode).length,
  },
  trips: {
    total: trips.length,
    workDays: workDays(trips).length,
    multiTripDays: [...tripsPerDate.values()].filter((n) => n > 1).length,
  },
  money: {
    grossActual: round2(active.reduce((n, g) => n + (g.fees.actual ?? 0), 0)),
    grossScheduled: round2(games.reduce((n, g) => n + (g.fees.scheduled ?? 0), 0)),
    forfeited: round2(
      games
        .filter((g) => isCancelled(g.status))
        .reduce((n, g) => n + Math.max((g.fees.scheduled ?? 0) - (g.fees.actual ?? 0), 0), 0),
    ),
    bonus: round2(
      active.reduce((n, g) => n + Math.max((g.fees.actual ?? 0) - (g.fees.scheduled ?? 0), 0), 0),
    ),
  },
  durations: {
    extracted: seeded.seeded.length,
    scopesNeedingFigure: seeded.gaps.length,
    gamesWithoutDuration: resolved.filter((r) => r.duration.minutes == null).length,
  },
  ageGroups: {
    rawStrings: new Set(games.map((g) => g.ageGroupRaw).filter(Boolean)).size,
    competitions: new Set(games.map((g) => durationKey(parseAgeGroup(g.ageGroupRaw), g.league))).size,
  },
  parks: {
    withGames: new Set(resolved.map((r) => r.parkId).filter(Boolean)).size,
    withoutMileage: FIXTURE_PARKS.filter((p) => p.oneWayMiles == null).length,
  },
  anomalies: {
    zeroFeeActive: anomalyCount('zero-fee-active'),
    paidCancellation: anomalyCount('paid-cancellation'),
    noScheduledFee: anomalyCount('no-scheduled-fee'),
  },
}

function anomalyCount(code) {
  return games.filter((g) => anomalyCodesFor(g).includes(code)).length
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${OUT}`)
for (const [k, v] of Object.entries(out)) {
  if (!k.startsWith('_')) console.log(`  ${k}: ${JSON.stringify(v)}`)
}
