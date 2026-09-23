/**
 * Age-group decomposition.
 *
 * The strings below keep the exact *forms* the real export uses — a slashed range,
 * a lowercase U on both halves, a division letter fused to the band, a duration in
 * parentheses — with invented league prefixes, since a league name is one person's
 * working history and this file is public.
 *
 * Sanctioning bodies (`ASA`, `ASA/USA`, `USSSA`, `TEBA`, `DFW Interlock`,
 * `DFW All-Stars`, `TX Blowout`) are kept verbatim: the parser matches them by name,
 * so an invented one would test nothing. They are public organizations, not personal
 * data.
 */

import { describe, expect, it } from 'vitest'

import { durationKey, durationKeyLabel, durationKeyScope, parseAgeGroup } from './ageGroup'

describe('parseAgeGroup: age band', () => {
  it('reads a single-number band', () => {
    expect(parseAgeGroup('FHV-Softball-12U-Rec').ageBand).toBe('12U')
    expect(parseAgeGroup('Summit Star 11U "AA" Select (90 min)').ageBand).toBe('11U')
  })

  it('reads a hyphenated range', () => {
    expect(parseAgeGroup('AMR / 9-10U DIV A / 90min').ageBand).toBe('9-10U')
    expect(parseAgeGroup('AMR / 13-14U / 110min').ageBand).toBe('13-14U')
  })

  it('normalises a slashed range to the hyphenated form', () => {
    // Same band, two spellings; they must not become two groups.
    expect(parseAgeGroup('ASA-Softball-14/16U-Rec').ageBand).toBe('14-16U')
    expect(parseAgeGroup('BRK-DFW Interlock-7/8U-CP (75 min)').ageBand).toBe('7-8U')
  })

  it('reads a band with a U after each number', () => {
    // 'WRN-9u/10u' — lowercase, and a U on both halves.
    expect(parseAgeGroup('WRN-9u/10u').ageBand).toBe('9-10U')
  })

  it('separates a division letter attached to the band', () => {
    const c = parseAgeGroup('PNH-Softball-10UC-Modified Kid Pitch')
    expect(c.ageBand).toBe('10U')
    expect(c.bandSuffix).toBe('C')
  })

  it('calls an adult league Adult rather than inventing a band', () => {
    // "Men's D" is a skill division, not an age. Adult is what it means.
    expect(parseAgeGroup("Norwood-ASA/USA-Monday-Men's D (3HR+1up)").ageBand).toBe('Adult')
    expect(parseAgeGroup("SRW Women's Kickball").ageBand).toBe('Adult')
    expect(parseAgeGroup('Norwood-USSSA-Tuesday-Co-Rec (3HR+1up)').ageBand).toBe('Adult')
  })

  it('leaves the band unset when the string states neither', () => {
    expect(parseAgeGroup('Some Unlabelled League').ageBand).toBeUndefined()
    expect(parseAgeGroup('').ageBand).toBeUndefined()
  })
})

describe('parseAgeGroup: rule set', () => {
  it('prefers the more specific of two overlapping names', () => {
    // ASA/USA must not be read as bare ASA.
    expect(parseAgeGroup("Norwood-ASA/USA-Wednesday-Men's D (3HR+1up)").ruleSet).toBe('ASA/USA')
    // The bare form keeps its ASA: that is the sanctioning body, and dropping it
    // would leave the more-specific-wins rule with nothing to be specific about.
    expect(parseAgeGroup('ASA-Softball-12U-Rec').ruleSet).toBe('ASA')
  })

  it('reads the rule sets this data uses', () => {
    expect(parseAgeGroup('BRK-DFW Interlock-10U (90 min)').ruleSet).toBe('DFW Interlock')
    expect(parseAgeGroup('BRK-TEBA-12U (90 min)').ruleSet).toBe('TEBA')
    expect(parseAgeGroup('DFW-ALL*STARS-SOFTBALL-10U').ruleSet).toBe('DFW All-Stars')
    expect(parseAgeGroup('Norwood-USSSA-Thursday-Co-Rec').ruleSet).toBe('USSSA')
  })

  it('leaves it unset rather than guessing', () => {
    // A wrong rule set would merge two competitions that keep different time, so
    // silence is the safe answer.
    expect(parseAgeGroup('FHV-Softball-12U-Rec').ruleSet).toBeUndefined()
    expect(parseAgeGroup('AMR / 9-10U DIV A / 90min').ruleSet).toBeUndefined()
  })
})

describe('parseAgeGroup: pitch style and stage', () => {
  it('distinguishes modified kid pitch from kid pitch', () => {
    expect(parseAgeGroup('PNH-Softball-10UC-Modified Kid Pitch').pitchStyle).toBe(
      'Modified Kid Pitch',
    )
    expect(parseAgeGroup('PNH-Softball-10UK-Kid Pitch').pitchStyle).toBe('Kid Pitch')
  })

  it('reads the abbreviated forms', () => {
    expect(parseAgeGroup('AMR / 7-8U DIV A / CP / 90min').pitchStyle).toBe('Coach Pitch')
    expect(parseAgeGroup('AMR / 5-6U / MOD / CP / 75min').pitchStyle).toBe('Modified')
  })

  it('reads a tournament stage', () => {
    expect(
      parseAgeGroup('8U Coach Pitch TX Blowout Tourney Softball Pool Play (60 min)').stage,
    ).toBe('Pool')
    expect(
      parseAgeGroup('8U Coach Pitch TX Blowout Tourney Softball Bracket (75 min)').stage,
    ).toBe('Bracket')
  })
})

describe('durationKey', () => {
  const key = (s: string, league?: string) => durationKey(parseAgeGroup(s), league)

  it('keys on the rule set where one is stated, so every league shares the entry', () => {
    // The point of the whole module: one figure covers DFW Interlock 10U wherever
    // it is played.
    expect(key('BRK-DFW Interlock-10U (90 min)', 'Brookfield Baseball Softball Association')).toBe(
      'rs:DFW Interlock · 10U',
    )
    expect(key('Some Other League DFW Interlock 10U', 'Another League')).toBe(
      'rs:DFW Interlock · 10U',
    )
  })

  it('falls back to the league when no rule set is stated', () => {
    expect(key('FHV-Softball-12U-Rec', 'Fairhaven Baseball Softball Association')).toBe(
      'lg:Fairhaven Baseball Softball Association · 12U',
    )
  })

  it('falls back to the raw string when there is no band at all', () => {
    // Never returns nothing: a duration must always be recordable somewhere.
    expect(key('Unlabelled Scrimmage', 'Some League')).toBe('raw:Unlabelled Scrimmage')
  })

  it('keeps pitch style in the key, because it changes the clock', () => {
    const cp = key('FHV-Softball-8U-Coach Pitch', 'Fairhaven')
    const kp = key('FHV-Softball-8U-Kid Pitch', 'Fairhaven')
    expect(cp).not.toBe(kp)
  })

  it('keeps tournament stage in the key, because pool and bracket differ', () => {
    // TX Blowout runs 8U coach pitch for 60 minutes in pool and 75 in bracket;
    // merging them would average a real difference away.
    const pool = key('8U Coach Pitch TX Blowout Tourney Softball Pool Play (60 min)')
    const bracket = key('8U Coach Pitch TX Blowout Tourney Softball Bracket (75 min)')
    expect(pool).not.toBe(bracket)
  })

  it('merges two spellings of one competition', () => {
    // A slashed and a hyphenated range in the same league are one scope.
    expect(key('BRK 7/8U', 'Brookfield')).toBe(key('BRK 7-8U', 'Brookfield'))
  })

  it('does not merge different divisions of the same band into different keys', () => {
    // DIV A and DIV AA keep the same clock, so they share an entry — the division
    // is parsed for display but deliberately left out of the key.
    expect(key('AMR / 9-10U DIV A / 90min', 'Ashford')).toBe(key('AMR / 9-10U DIV AA / 90min', 'Ashford'))
  })
})

describe('durationKeyScope and label', () => {
  it('reports which scope a key belongs to', () => {
    expect(durationKeyScope('rs:USSSA · 10U')).toBe('ruleSet')
    expect(durationKeyScope('lg:Some League · 10U')).toBe('league')
    expect(durationKeyScope('raw:Whatever')).toBe('raw')
  })

  it('strips the prefix for display', () => {
    expect(durationKeyLabel('rs:USSSA · 10U')).toBe('USSSA · 10U')
    expect(durationKeyLabel('lg:Fairhaven · 12U')).toBe('Fairhaven · 12U')
    expect(durationKeyLabel('raw:Odd String')).toBe('Odd String')
  })
})
