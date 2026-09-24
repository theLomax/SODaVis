/**
 * Expected figures for whichever export is present, looked up by name.
 *
 * `data/expected.json` when the real export is checked out; otherwise the committed
 * `test/fixtures/expected.example.json`, whose values describe the anonymized fixture
 * and so are safe to publish.
 *
 * The point is that a test reads `expected.games.total` rather than `216`. A bare
 * number needs a comment saying where it came from, and that comment is where venue
 * names and income totals creep back into the repo — which is exactly how they got
 * there the first time.
 *
 * A missing key throws rather than returning undefined: a silently-absent expectation
 * makes `toBe(undefined)` pass against `undefined`, which is a test that asserts
 * nothing while looking like it asserts something.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type ExpectedFigures = {
  games: {
    total: number
    active: number
    cancelled: number
    solo: number
    partners: number
    blankSportCode: number
  }
  trips: { total: number; workDays: number; multiTripDays: number }
  money: { grossActual: number; grossScheduled: number; forfeited: number; bonus: number }
  durations: { extracted: number; scopesNeedingFigure: number; gamesWithoutDuration: number }
  ageGroups: { rawStrings: number; competitions: number }
  parks: { withGames: number; withoutMileage: number }
  /** Sample only: the real export carries none, so its file omits the section. */
  anomalies: { zeroFeeActive: number; paidCancellation: number; noScheduledFee: number }
}

const ROOT = resolve(import.meta.dirname, '..')
const REAL = resolve(ROOT, 'data/expected.json')
const EXAMPLE = resolve(ROOT, 'test/sample/expected.json')

/** True when the real export's figures are available at all. */
export const usingRealExpected = existsSync(REAL)

/**
 * Figures for the committed fixture. Always the example file: a suite testing the
 * fixture must not read the real export's numbers just because `data/` happens to be
 * checked out — that was a real bug, and it made the fixture suite fail on the one
 * machine that has the data.
 */
export const fixtureFigures = load(EXAMPLE)

/**
 * Figures for whichever export a suite is actually reading. The real one when it is
 * present, the fixture's otherwise — so a real-data suite skips rather than asserting
 * the wrong numbers.
 */
const source = usingRealExpected ? REAL : EXAMPLE

const raw = loadRaw(source)

function loadRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(
      `Expected figures are missing (${path}).\n` +
        'Run: git submodule update --init --recursive',
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function load(path: string): ExpectedFigures {
  if (!existsSync(path)) {
    // The public sample is a submodule, so a clone without `--recurse-submodules`
    // finds an empty directory. Say that plainly: an ENOENT on a path nobody asked
    // for reads like a corrupt repository.
    throw new Error(
      `The public sample data is missing (${path}).\n` +
        'Run: git submodule update --init --recursive',
    )
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  return new Proxy({} as ExpectedFigures, {
    get(_t, section: string) {
      const value = parsed[section]
      if (value == null) throw new Error(`expected.${section} is not defined in ${path}.`)
      return strictSection(path, section, value as object)
    },
  })
}

function strictSection<T extends object>(path: string, section: string, value: T): T {
  return new Proxy(value, {
    get(target, key: string) {
      if (!(key in target)) {
        throw new Error(
          `expected.${section}.${key} is not defined in ${path}. ` +
            'Add it there, or assert an invariant instead.',
        )
      }
      return target[key as keyof T]
    },
  })
}

/**
 * Proxies every section so a typo or a key the file predates fails loudly at the
 * point of use, naming the file and the key rather than surfacing as `undefined`
 * three assertions later.
 */
function strict<T extends object>(section: string, value: T): T {
  return new Proxy(value, {
    get(target, key: string) {
      if (!(key in target)) {
        throw new Error(
          `expected.${section}.${key} is not defined in ${source}. ` +
            'Add it there, or assert an invariant instead.',
        )
      }
      return target[key as keyof T]
    },
  })
}

export const expectedFigures: ExpectedFigures = new Proxy({} as ExpectedFigures, {
  get(_t, section: string) {
    const value = raw[section]
    if (value == null) {
      throw new Error(`expected.${section} is not defined in ${source}.`)
    }
    return strict(section, value as object)
  },
})

/** Where the figures came from, for a test run's own output. */
export const expectedSource = source
