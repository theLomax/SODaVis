/**
 * Venue → park resolution, on invented venues.
 *
 * These are pure-function tests: `stripFieldDesignator` and `resolvePark` care about
 * the *shape* of a venue string — a trailing field number, a colour-named field, a
 * trailing period — and not about which park it is. So the strings here are invented
 * while keeping every shape the real data uses, and the suite runs on any clone.
 */

import { describe, expect, it } from 'vitest'

import { resolvePark, stripFieldDesignator } from './resolve'
import type { Park } from '../model/reference'

const PARKS: Park[] = [
  {
    id: 'riverside',
    name: 'Riverside Park',
    aliases: [],
    venuePatterns: ['Riverside Park*'],
    oneWayMiles: 10,
  },
  {
    id: 'lakeview',
    name: 'Lakeview Park',
    // The real data contains one venue written both with and without a trailing
    // period. A pattern alone cannot tell them apart, so both spellings are aliases.
    aliases: ['Westgate Athletic Park', 'Westgate Athletic Park.'],
    venuePatterns: ['Lakeview Park*'],
    oneWayMiles: 20,
  },
]

describe('stripFieldDesignator', () => {
  it('strips a trailing field number in each form the data uses', () => {
    expect(stripFieldDesignator('Riverside Park Field 1')).toBe('Riverside Park')
    expect(stripFieldDesignator('Northside Complex (Field 12)')).toBe('Northside Complex')
    expect(stripFieldDesignator('Hillcrest - Founders Park / Field A')).toBe(
      'Hillcrest - Founders Park',
    )
    expect(stripFieldDesignator('Lakeview Park: Red Field')).toBe('Lakeview Park')
  })

  it('leaves an artifact where a venue embeds a word that is not a designator', () => {
    // Documents the known limitation, which is exactly why aliases exist: the regex
    // is only ever a seed for naming a new park, never trusted as a match.
    expect(stripFieldDesignator('Cedar Ridge Park West Softball Field 2')).toBe(
      'Cedar Ridge Park West Softball',
    )
  })
})

describe('resolvePark', () => {
  it('collapses two spellings of one venue via aliases', () => {
    // The trailing period is the real case this exists for.
    expect(resolvePark('Westgate Athletic Park', PARKS).parkId).toBe('lakeview')
    expect(resolvePark('Westgate Athletic Park.', PARKS).parkId).toBe('lakeview')
    expect(resolvePark('Westgate Athletic Park', PARKS).via).toBe('alias')
  })

  it('keeps colour-named fields at one park', () => {
    expect(resolvePark('Lakeview Park: Red Field', PARKS).parkId).toBe('lakeview')
    expect(resolvePark('Lakeview Park: Blue Field', PARKS).parkId).toBe('lakeview')
  })

  it('matches a field number never seen before, via the park pattern', () => {
    const match = resolvePark('Riverside Park Field 99', PARKS)
    expect(match.parkId).toBe('riverside')
    expect(match.via).toBe('pattern')
  })

  it('surfaces an unknown venue with a suggested name rather than inventing a park', () => {
    const match = resolvePark('Somewhere New Field 3', PARKS)
    expect(match.parkId).toBeNull()
    expect(match.via).toBe('unmatched')
    if (match.parkId === null) expect(match.suggestedName).toBe('Somewhere New')
  })
})
