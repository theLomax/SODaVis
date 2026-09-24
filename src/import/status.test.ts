/**
 * Status and start-time classification. These exist because of three bugs that
 * silently miscounted games:
 *  - "Cancelled - Not Paid" contains the substring "Paid", so the heuristic
 *    called it a paid cancellation.
 *  - An unseen status such as "Forfeit" became `unknown` and then counted as
 *    worked, because every non-cancelled status was treated as active.
 *  - A blank start time was stored as midnight with no flag.
 */

import { describe, expect, it } from 'vitest'

import { parseStatus } from './transforms'
import { mapRow, type MapContext } from './map'
import { assignrProfile, genericProfile } from './profiles'
import { SEED_IDENTITY } from '../model/reference'
import { isActive, isCancelled } from '../model/game'

const vocab = assignrProfile.statusVocabulary

const ctx: MapContext = {
  profile: assignrProfile,
  identity: SEED_IDENTITY,
  importId: 'test',
  importedAt: '2026-09-21T00:00:00.000Z',
  headers: assignrProfile.fingerprint,
  currency: 'USD',
}

function row(status: string, startTime = '6:00 PM'): Record<string, string> {
  const r: Record<string, string> = Object.fromEntries(assignrProfile.fingerprint.map((h) => [h, '']))
  r['Date'] = '2026-04-11'
  r['Start Time'] = startTime
  r['Venue'] = 'Northside Complex (Field 1)'
  r['Age Group'] = '10U'
  r['Status'] = status
  r['Assignr Database ID'] = '90000099'
  r['Official 1'] = 'Rivera, Sam'
  return r
}

describe('parseStatus', () => {
  it('does not treat "Cancelled - Not Paid" as a paid cancellation', () => {
    expect(parseStatus('Cancelled - Not Paid', vocab)).toBe('cancelled-nopay')
    expect(parseStatus('Cancelled - Not Paid', genericProfile.statusVocabulary)).toBe(
      'cancelled-nopay',
    )
    // The wording that made the substring "Paid" match first.
    expect(parseStatus('Cancelled - Not Paid', {})).toBe('cancelled-nopay')
  })

  it('still recognises an actually paid cancellation', () => {
    expect(parseStatus('Cancelled - Paid', vocab)).toBe('cancelled-paid')
    expect(parseStatus('Cancelled - Rain, paid', {})).toBe('cancelled-paid')
  })

  it('classifies a forfeit as a no-pay cancellation, not as worked', () => {
    expect(parseStatus('Forfeit', vocab)).toBe('cancelled-nopay')
    expect(parseStatus('Forfeited', {})).toBe('cancelled-nopay')
    expect(isActive('cancelled-nopay')).toBe(false)
    expect(isCancelled('cancelled-nopay')).toBe(true)
  })

  it('leaves a truly unknown wording as unknown, which is not worked', () => {
    expect(parseStatus('Weather hold', vocab)).toBe('unknown')
    expect(isActive('unknown')).toBe(false)
    expect(isCancelled('unknown')).toBe(false)
  })
})

describe('import flags', () => {
  it('flags a blank start time instead of silently using midnight', () => {
    const mapped = mapRow(row('Active', ''), ctx, 0)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.game.startTime).toBe('00:00')
    expect(mapped.game.flags.some((f) => f.code === 'unparsed-time')).toBe(true)
  })

  it('flags an unrecognised status so it cannot hide as active', () => {
    const mapped = mapRow(row('Weather hold'), ctx, 0)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.game.status).toBe('unknown')
    expect(mapped.game.flags.some((f) => f.code === 'unrecognised-status')).toBe(true)
  })

  it('does not flag a recognised cancellation', () => {
    const mapped = mapRow(row('Cancelled - Not Paid'), ctx, 0)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.game.status).toBe('cancelled-nopay')
    expect(mapped.game.flags.some((f) => f.code === 'unrecognised-status')).toBe(false)
  })
})
