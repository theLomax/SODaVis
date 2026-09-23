/**
 * The expected-figures loader.
 *
 * Runs on any clone: it asserts the loader's behaviour, not any particular season's
 * numbers. The committed example file is the one it reads here.
 */

import { describe, expect, it } from 'vitest'

import { expectedFigures, expectedSource, usingRealExpected } from '../../test/expected'

describe('expected figures', () => {
  it('reads a file, and says which one', () => {
    expect(expectedSource).toMatch(/expected\.json$/)
    // Real when data/ is checked out, the committed example otherwise.
    expect(typeof usingRealExpected).toBe('boolean')
  })

  it('exposes every section the suites use', () => {
    for (const section of ['games', 'trips', 'money', 'durations', 'ageGroups', 'parks'] as const) {
      expect(expectedFigures[section], section).toBeTruthy()
    }
  })

  it('holds numbers, not strings', () => {
    expect(typeof expectedFigures.games.total).toBe('number')
    expect(typeof expectedFigures.money.grossActual).toBe('number')
  })

  it('is internally consistent', () => {
    const { total, active, cancelled } = expectedFigures.games
    expect(active + cancelled).toBe(total)
    // More trips than work days is possible; fewer is not.
    expect(expectedFigures.trips.total).toBeGreaterThanOrEqual(expectedFigures.trips.workDays)
    // Competitions consolidate raw strings, so there cannot be more of them.
    expect(expectedFigures.ageGroups.competitions).toBeLessThanOrEqual(
      expectedFigures.ageGroups.rawStrings,
    )
  })

  it('throws on a key the file does not define, rather than returning undefined', () => {
    // A silently-absent expectation makes `toBe(undefined)` pass against
    // `undefined` — a test that asserts nothing while looking like it asserts
    // something. Failing loudly at the point of use is the whole reason for the proxy.
    expect(() => (expectedFigures.games as Record<string, unknown>)['notAKey']).toThrow(
      /not defined in/,
    )
    expect(() => (expectedFigures as unknown as Record<string, unknown>)['nope']).toThrow(
      /not defined in/,
    )
  })
})
