/**
 * Label abbreviation.
 *
 * The names below are invented, but they keep the *shape* of the real ones: the same
 * word counts, the same shared filler ("Baseball Softball Association"), and the
 * same 46-character worst case against a y-axis band that fits about 20. The parser
 * cares about shape rather than identity, so nothing is lost by not naming real
 * organizations — and this file is public.
 */

import { describe, expect, it } from 'vitest'

import { abbreviateLabel, abbreviateLabels } from './labels'

/** One invented league per real one in the sample export, longest first. */
const LEAGUES = [
  'Ashford Meadow Ridge Baseball Association',
  'Summit Shootout / Harlow Softball Tournament',
  'Brookfield Baseball Softball Association',
  "South Ridge Women's Kickball Association",
  'Crown Park Ashbury Baseball Association',
  'Fairhaven Baseball Softball Association',
  'Kestrel Baseball Softball Association',
  'Pinehurst Girls Softball Association',
  'Norwood Sports Association Softball',
  'Loxley Youth Association Softball',
  'Parks At Summit Star',
  'Wrenfield',
  'Norwood PARD',
]

describe('abbreviateLabel', () => {
  it('leaves a name that already fits untouched', () => {
    expect(abbreviateLabel('Norwood PARD')).toBe('Norwood PARD')
    expect(abbreviateLabel('Wrenfield')).toBe('Wrenfield')
  })

  it('drops the words every league shares before touching the rest', () => {
    // "Baseball Softball Association" separates nothing when every league has it.
    expect(abbreviateLabel('Kestrel Baseball Softball Association')).toBe('Kestrel')
    expect(abbreviateLabel('Fairhaven Baseball Softball Association')).toBe('Fairhaven')
    expect(abbreviateLabel('Pinehurst Girls Softball Association')).toBe('Pinehurst')
  })

  it('initialises what is left when dropping words is not enough', () => {
    // Three significant words, so it initialises — which is how a real league's
    // own venue strings abbreviate it too.
    expect(abbreviateLabel('Ashford Meadow Ridge Baseball Association')).toBe('AMR')
  })

  it('keeps every league within the limit', () => {
    for (const name of LEAGUES) {
      expect(abbreviateLabel(name).length).toBeLessThanOrEqual(18)
    }
  })

  it('never returns a single letter, which is not a label', () => {
    // Truncation is the lesser evil here.
    const out = abbreviateLabel('Ashford', 4)
    expect(out.length).toBeGreaterThan(1)
    expect(out).toBe('Ash…')
  })

  it('preserves the distinguishing part rather than the prefix', () => {
    // The failure mode being avoided: "Ashford Meadow…" and "Ashford Youth…"
    // truncate identically while abbreviating to different things.
    const a = abbreviateLabel('Ashford Meadow Ridge Baseball Association')
    const b = abbreviateLabel('Ashford Youth Recreation Association')
    expect(a).not.toBe(b)
  })
})

describe('abbreviateLabels', () => {
  it('shortens every real league without a collision', () => {
    const map = abbreviateLabels(LEAGUES)
    const shortened = LEAGUES.map((n) => map.get(n)!)
    expect(new Set(shortened).size).toBe(LEAGUES.length)
  })

  it('falls back to full names for a pair that would collide', () => {
    // Two leagues sharing a label is worse than two long ones: the reader merges
    // the rows. Which of the pair to keep short is not ours to decide, so neither is.
    // Both reduce to "Norwood", then to "N" — too short to be a label, so both
    // initialise to the same string.
    const clashing = ['Norwood Baseball Association', 'Norwood Softball Association']
    const map = abbreviateLabels(clashing, 10)
    expect(map.get(clashing[0]!)).toBe(clashing[0])
    expect(map.get(clashing[1]!)).toBe(clashing[1])
  })

  it('leaves non-colliding names shortened even when another pair collides', () => {
    const names = [
      'Norwood Baseball Association',
      'Norwood Softball Association',
      'Kestrel Baseball Softball Association',
    ]
    const map = abbreviateLabels(names, 10)
    expect(map.get('Kestrel Baseball Softball Association')).toBe('Kestrel')
  })

  it('maps every input, so a lookup never misses', () => {
    const map = abbreviateLabels(LEAGUES)
    for (const name of LEAGUES) expect(map.get(name)).toBeTruthy()
  })
})
