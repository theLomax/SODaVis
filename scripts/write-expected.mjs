#!/usr/bin/env node
/**
 * Derives `data/expected.json` from whichever export is in `data/`.
 *
 * Run after importing a new season. The figures are computed from the file, so they
 * cannot drift from it the way a hand-maintained constant does — and because they
 * live in `data/` (a private submodule), the numbers never reach the public repo.
 *
 *   node scripts/write-expected.mjs
 */

import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseDelimited } from '../src/import/parse.ts'
import { mapRows } from '../src/import/map.ts'
import { assignrProfile } from '../src/import/profiles/index.ts'
import { isCancelled } from '../src/model/game.ts'
import { resolveGames, seedAgeGroupDurations } from '../src/derive/resolve.ts'
import { buildTrips, workDays } from '../src/derive/trips.ts'
import { durationKey, parseAgeGroup } from '../src/derive/ageGroup.ts'
import { SEED_SETTINGS, SEED_SPORT_PROFILES } from '../src/model/reference.ts'
import { readFileSync } from 'node:fs'

const DATA = resolve(process.cwd(), 'data')
if (!existsSync(DATA)) {
  console.error('data/ is not checked out — nothing to derive from.')
  process.exit(1)
}

const csv = readdirSync(DATA).find((f) => f.endsWith('.csv'))
if (!csv) {
  console.error(`no .csv in ${DATA}`)
  process.exit(1)
}

const reference = resolve(DATA, 'reference.local.json')
const parks = existsSync(reference)
  ? JSON.parse(readFileSync(reference, 'utf8')).data.parks
  : []
const identity = existsSync(reference)
  ? JSON.parse(readFileSync(reference, 'utf8')).data.identity
  : { id: 'self', patterns: [], displayName: '' }

const parsed = parseDelimited(readFileSync(resolve(DATA, csv), 'utf8'))
const { games } = mapRows(parsed.rows, {
  profile: assignrProfile,
  identity,
  importId: 'expected',
  importedAt: new Date().toISOString(),
  headers: parsed.headers,
  currency: 'USD',
})

const seeded = seedAgeGroupDurations(games)
const resolved = resolveGames(games, {
  parks,
  durations: new Map(seeded.seeded.map((d) => [d.key, d])),
  sports: new Map(SEED_SPORT_PROFILES.map((s) => [s.code, s])),
  annotations: new Map(),
})
const { trips } = buildTrips(resolved, {
  parks: new Map(parks.map((p) => [p.id, p])),
  tripAnnotations: new Map(),
  settings: SEED_SETTINGS,
})

const active = games.filter((g) => !isCancelled(g.status))
const money = (f) => games.reduce((n, g) => n + (g.fees[f] ?? 0), 0)
const activeMoney = (f) => active.reduce((n, g) => n + (g.fees[f] ?? 0), 0)
const round2 = (n) => Math.round(n * 100) / 100

const tripsPerDate = new Map()
for (const t of trips) tripsPerDate.set(t.date, (tripsPerDate.get(t.date) ?? 0) + 1)

const out = {
  _comment: [
    'Derived from the export in data/ by scripts/write-expected.mjs. Do not hand-edit:',
    're-run the script after importing a new season. Private — this file holds counts',
    'and totals for one person’s season, and overrides test/fixtures/expected.example.json.',
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
    grossActual: round2(activeMoney('actual')),
    grossScheduled: round2(money('scheduled')),
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
    withoutMileage: parks.filter((p) => p.oneWayMiles == null).length,
  },
}

const target = resolve(DATA, 'expected.json')
writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${target} from ${csv}`)
for (const [section, values] of Object.entries(out)) {
  if (section.startsWith('_')) continue
  console.log(`  ${section}: ${JSON.stringify(values)}`)
}
