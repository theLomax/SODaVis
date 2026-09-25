/**
 * The period a chart click opens. Pure date arithmetic, but the kind that goes
 * wrong at month ends, leap years and timezone boundaries.
 */

import { describe, expect, it } from 'vitest'
import { drillPeriod, monthLongLabel, monthPeriod } from './metrics'

describe('monthPeriod', () => {
  it('spans the whole month, inclusive', () => {
    expect(monthPeriod('2026-03')).toEqual({ start: '2026-03-01', end: '2026-03-31' })
    expect(monthPeriod('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('knows February, leap years included', () => {
    expect(monthPeriod('2026-02').end).toBe('2026-02-28')
    expect(monthPeriod('2028-02').end).toBe('2028-02-29')
  })

  it('ends December in the same year', () => {
    expect(monthPeriod('2025-12')).toEqual({ start: '2025-12-01', end: '2025-12-31' })
  })
})

describe('drillPeriod', () => {
  it('is the month itself when no period is in force', () => {
    expect(drillPeriod('2026-03', null)).toEqual({ start: '2026-03-01', end: '2026-03-31' })
  })

  it('never widens a range that starts or ends mid-month', () => {
    // The first column of a range starting on the 15th counted only half a month.
    const current = { start: '2026-03-15', end: '2026-05-10' }
    expect(drillPeriod('2026-03', current)).toEqual({ start: '2026-03-15', end: '2026-03-31' })
    expect(drillPeriod('2026-04', current)).toEqual({ start: '2026-04-01', end: '2026-04-30' })
    expect(drillPeriod('2026-05', current)).toEqual({ start: '2026-05-01', end: '2026-05-10' })
  })

  it('honours an open-ended bound', () => {
    expect(drillPeriod('2026-03', { start: '2026-03-20', end: null })).toEqual({
      start: '2026-03-20',
      end: '2026-03-31',
    })
  })
})

describe('monthLongLabel', () => {
  it('spells the month out for prose', () => {
    expect(monthLongLabel('2026-03')).toBe('March 2026')
    expect(monthLongLabel('2025-12')).toBe('December 2025')
  })
})
