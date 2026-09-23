/**
 * The date-range filter.
 *
 * These exist because of a specific bug: with no period active, choosing a `To`
 * date filled `From` with `1900-01-01`, and choosing a `From` filled `To` with
 * `2999-12-31`. Both were sentinels for "open-ended", but a date input renders its
 * value literally, so setting one bound flung the other picker to 1900 or 2999.
 *
 * The fix is that an open bound is null, which means the range type allows a half
 * open range and the matcher has to honour it. Both halves are asserted here.
 */

import { describe, expect, it } from 'vitest'

import { withBound } from './components/Controls'
import { dateInFilterPeriod as inRange } from './store'

describe('setting one end of the date range', () => {
  it('leaves the other end unset rather than inventing a sentinel', () => {
    // The reported bug, in both directions.
    expect(withBound(null, 'end', '2026-09-22')).toEqual({ start: null, end: '2026-09-22' })
    expect(withBound(null, 'start', '2026-03-01')).toEqual({ start: '2026-03-01', end: null })
  })

  it('never produces a bound the user did not choose', () => {
    for (const which of ['start', 'end'] as const) {
      const period = withBound(null, which, '2026-06-01')
      const other = which === 'start' ? period!.end : period!.start
      expect(other).toBeNull()
      // Specifically not the old sentinels, which the picker rendered literally.
      expect(other).not.toBe('1900-01-01')
      expect(other).not.toBe('2999-12-31')
    }
  })

  it('keeps the end when the start changes, and vice versa', () => {
    const range = { start: '2026-01-01', end: '2026-12-31' }
    expect(withBound(range, 'start', '2026-03-01')).toEqual({
      start: '2026-03-01',
      end: '2026-12-31',
    })
    expect(withBound(range, 'end', '2026-06-30')).toEqual({
      start: '2026-01-01',
      end: '2026-06-30',
    })
  })

  it('clears one bound without discarding the other', () => {
    const range = { start: '2026-01-01', end: '2026-12-31' }
    expect(withBound(range, 'start', '')).toEqual({ start: null, end: '2026-12-31' })
    expect(withBound(range, 'end', '')).toEqual({ start: '2026-01-01', end: null })
  })

  it('treats clearing both as no filter at all', () => {
    const halfOpen = { start: null, end: '2026-12-31' }
    expect(withBound(halfOpen, 'end', '')).toBeNull()
    expect(withBound({ start: '2026-01-01', end: null }, 'start', '')).toBeNull()
  })
})

describe('matching a half-open range', () => {
  it('treats a null start as "everything up to the end"', () => {
    const period = { start: null, end: '2026-06-30' }
    expect(inRange('2019-01-01', period)).toBe(true)
    expect(inRange('2026-06-30', period)).toBe(true)
    expect(inRange('2026-07-01', period)).toBe(false)
  })

  it('treats a null end as "everything from the start onward"', () => {
    const period = { start: '2026-03-01', end: null }
    expect(inRange('2026-02-28', period)).toBe(false)
    expect(inRange('2026-03-01', period)).toBe(true)
    expect(inRange('2099-01-01', period)).toBe(true)
  })

  it('includes both endpoints of a closed range', () => {
    const period = { start: '2026-01-01', end: '2026-12-31' }
    expect(inRange('2025-12-31', period)).toBe(false)
    expect(inRange('2026-01-01', period)).toBe(true)
    expect(inRange('2026-12-31', period)).toBe(true)
    expect(inRange('2027-01-01', period)).toBe(false)
  })

  it('admits everything when there is no period', () => {
    expect(inRange('1999-01-01', null)).toBe(true)
    expect(inRange('2099-01-01', null)).toBe(true)
  })

  it('excludes everything when the range is inverted', () => {
    // The pickers' own min/max make this hard to reach, but the matcher should
    // not quietly reinterpret it as a valid range.
    const period = { start: '2026-12-31', end: '2026-01-01' }
    expect(inRange('2026-06-01', period)).toBe(false)
  })
})
