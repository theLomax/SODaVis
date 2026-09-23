/**
 * Fee anomalies and their acknowledgement.
 *
 * The real export contains none of these — no active game at $0, no cancellation
 * that paid, no game without a scheduled fee — which is itself worth knowing, and is
 * exactly why this suite builds its own games rather than reading the file. The
 * behaviour has to be right before an export arrives carrying one.
 */

import { describe, expect, it } from 'vitest'

import { anomalyCodesFor, feeAnomalies, groupAnomalies } from './anomalies'
import type { Game, GameStatus } from '../model/game'
import type { GameAnnotation } from '../model/annotation'

let n = 0
function game(
  status: GameStatus,
  fees: { scheduled?: number | undefined; actual?: number },
  date = '2026-04-01',
): Game {
  const id = `g${++n}`
  return {
    id,
    source: {
      system: 'test',
      dedupeKey: `test:${id}`,
      importId: 'i',
      importedAt: '2026-01-01T00:00:00.000Z',
      rawRow: {},
    },
    date,
    startTime: '18:00',
    venueRaw: 'Somewhere Park',
    ageGroupRaw: '10U',
    status,
    fees: { currency: 'USD', ...fees },
    assignments: [],
    flags: [],
  }
}

describe('anomalyCodesFor', () => {
  it('finds an active game that paid nothing', () => {
    expect(anomalyCodesFor(game('active', { scheduled: 45, actual: 0 }))).toEqual([
      'zero-fee-active',
    ])
  })

  it('finds a cancellation that paid anyway', () => {
    expect(anomalyCodesFor(game('cancelled-nopay', { scheduled: 45, actual: 20 }))).toEqual([
      'paid-cancellation',
    ])
  })

  it('finds a game with no scheduled fee', () => {
    expect(anomalyCodesFor(game('active', { actual: 45 }))).toEqual(['no-scheduled-fee'])
  })

  it('reports both codes where a game exhibits both', () => {
    // Accepting one of these says nothing about the other, which is why they are
    // tracked separately rather than as one "this game is odd" flag.
    const codes = anomalyCodesFor(game('cancelled-nopay', { actual: 20 }))
    expect(codes).toEqual(['paid-cancellation', 'no-scheduled-fee'])
  })

  it('says nothing about an ordinary game', () => {
    expect(anomalyCodesFor(game('active', { scheduled: 45, actual: 45 }))).toEqual([])
    expect(anomalyCodesFor(game('cancelled-nopay', { scheduled: 45, actual: 0 }))).toEqual([])
  })

  it('does not call a postponed game with no fee an anomaly', () => {
    // It has not been played, so a zero fee is expected rather than odd.
    expect(anomalyCodesFor(game('postponed', { scheduled: 45, actual: 0 }))).toEqual([])
  })

  it('does not raise a zero-fee anomaly against an unknown status', () => {
    // An unknown status is already reported as its own problem; adding a fee
    // anomaly on top would be two complaints about one defect.
    expect(anomalyCodesFor(game('unknown', { scheduled: 45, actual: 0 }))).toEqual([])
  })
})

describe('feeAnomalies', () => {
  const games = [
    game('active', { scheduled: 45, actual: 0 }),
    game('cancelled-nopay', { scheduled: 50, actual: 25 }),
    game('active', { scheduled: 45, actual: 45 }),
  ]

  it('reports one entry per anomaly, not per game', () => {
    expect(feeAnomalies(games, new Map())).toHaveLength(2)
  })

  it('treats everything as outstanding until acknowledged', () => {
    expect(feeAnomalies(games, new Map()).every((a) => !a.acknowledged)).toBe(true)
  })

  it('marks an acknowledged anomaly as settled without removing it', () => {
    // The row stays: an accepted oddity that vanished could not be told from one
    // nobody had looked at.
    const key = games[1]!.source.dedupeKey
    const annotations = new Map<string, GameAnnotation>([
      [key, { dedupeKey: key, acknowledgedAnomalies: ['paid-cancellation'] }],
    ])
    const out = feeAnomalies(games, annotations)
    expect(out).toHaveLength(2)
    expect(out.find((a) => a.code === 'paid-cancellation')!.acknowledged).toBe(true)
    expect(out.find((a) => a.code === 'zero-fee-active')!.acknowledged).toBe(false)
  })

  it('carries the reason where one was given', () => {
    const key = games[1]!.source.dedupeKey
    const annotations = new Map<string, GameAnnotation>([
      [
        key,
        {
          dedupeKey: key,
          acknowledgedAnomalies: ['paid-cancellation'],
          anomalyNotes: { 'paid-cancellation': 'rainout, paid half rate' },
        },
      ],
    ])
    expect(feeAnomalies(games, annotations).find((a) => a.code === 'paid-cancellation')!.note).toBe(
      'rainout, paid half rate',
    )
  })

  it('acknowledges per code, so one acceptance does not settle another', () => {
    const both = game('cancelled-nopay', { actual: 20 })
    const key = both.source.dedupeKey
    const annotations = new Map<string, GameAnnotation>([
      [key, { dedupeKey: key, acknowledgedAnomalies: ['paid-cancellation'] }],
    ])
    const out = feeAnomalies([both], annotations)
    expect(out.find((a) => a.code === 'paid-cancellation')!.acknowledged).toBe(true)
    expect(out.find((a) => a.code === 'no-scheduled-fee')!.acknowledged).toBe(false)
  })

  it('sorts outstanding before settled', () => {
    const key = games[0]!.source.dedupeKey
    const annotations = new Map<string, GameAnnotation>([
      [key, { dedupeKey: key, acknowledgedAnomalies: ['zero-fee-active'] }],
    ])
    const out = feeAnomalies(games, annotations)
    expect(out[0]!.acknowledged).toBe(false)
    expect(out[out.length - 1]!.acknowledged).toBe(true)
  })
})

describe('groupAnomalies', () => {
  it('counts outstanding and settled separately', () => {
    // The outstanding count is the one worth showing as a warning: a fully accepted
    // group is not work to do.
    const a = game('active', { scheduled: 45, actual: 0 })
    const b = game('active', { scheduled: 50, actual: 0 })
    const annotations = new Map<string, GameAnnotation>([
      [a.source.dedupeKey, { dedupeKey: a.source.dedupeKey, acknowledgedAnomalies: ['zero-fee-active'] }],
    ])
    const groups = groupAnomalies(feeAnomalies([a, b], annotations))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.outstanding).toBe(1)
    expect(groups[0]!.acknowledged).toBe(1)
    expect(groups[0]!.items).toHaveLength(2)
  })

  it('puts the group with the most outstanding first', () => {
    const groups = groupAnomalies(
      feeAnomalies(
        [
          game('active', { scheduled: 45, actual: 0 }),
          game('active', { scheduled: 45, actual: 0 }),
          game('cancelled-nopay', { scheduled: 50, actual: 25 }),
        ],
        new Map(),
      ),
    )
    expect(groups.map((g) => g.code)).toEqual(['zero-fee-active', 'paid-cancellation'])
  })

  it('reports a fully accepted group with zero outstanding', () => {
    const a = game('active', { scheduled: 45, actual: 0 })
    const annotations = new Map<string, GameAnnotation>([
      [a.source.dedupeKey, { dedupeKey: a.source.dedupeKey, acknowledgedAnomalies: ['zero-fee-active'] }],
    ])
    const groups = groupAnomalies(feeAnomalies([a], annotations))
    expect(groups[0]!.outstanding).toBe(0)
    expect(groups[0]!.acknowledged).toBe(1)
  })

  it('returns nothing for clean data', () => {
    expect(groupAnomalies(feeAnomalies([game('active', { scheduled: 45, actual: 45 })], new Map()))).toEqual([])
  })
})
