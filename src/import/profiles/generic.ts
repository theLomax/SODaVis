import type { SourceProfile } from './types'

/**
 * Fallback profile. Matches nothing by fingerprint, so detection never picks it
 * silently; the mapping UI starts from it when a file is unrecognized, and the
 * result is saved as a named custom profile.
 *
 * Dedupe is by fingerprint because an unknown source cannot be assumed to carry
 * a stable id - this is the likely RefTown case.
 */
export const genericProfile: SourceProfile = {
  id: 'generic',
  label: 'Generic / unrecognized source',
  fingerprint: [],
  fieldMap: {},
  statusVocabulary: {
    Active: 'active',
    Accepted: 'active',
    Assigned: 'active',
    Confirmed: 'active',
    Played: 'active',
    Cancelled: 'cancelled-nopay',
    Canceled: 'cancelled-nopay',
    'Cancelled - No Pay': 'cancelled-nopay',
    'Cancelled - Pay': 'cancelled-paid',
    Postponed: 'postponed',
  },
  officialColumns: 'auto',
  dedupe: {
    strategy: 'fingerprint',
    columns: ['date', 'startTime', 'venueRaw', 'ageGroupRaw'],
  },
  isDataRow: (row) => Object.values(row).some((v) => (v ?? '').trim() !== ''),
}

/**
 * Header name candidates per canonical field, used to pre-fill the mapping UI's
 * suggestions for an unknown source. Lowercased, compared loosely.
 */
export const FIELD_SYNONYMS: Record<string, string[]> = {
  sourceId: ['id', 'game id', 'gameid', 'database id', 'assignment id', 'contest id', 'number'],
  date: ['date', 'game date', 'contest date', 'event date', 'day'],
  startTime: ['start time', 'time', 'start', 'game time', 'first pitch', 'kickoff'],
  endTime: ['end time', 'end', 'finish time', 'stop time'],
  venueRaw: ['venue', 'site', 'location', 'field', 'facility', 'park', 'complex'],
  subVenueRaw: ['sub-venue', 'sub venue', 'subvenue', 'field number', 'diamond'],
  ageGroupRaw: ['age group', 'agegroup', 'level', 'division', 'group', 'age'],
  status: ['status', 'game status', 'state'],
  league: ['league', 'organization', 'org', 'client', 'program'],
  sportCode: ['sport', 'gender', 'sport code', 'activity', 'discipline'],
  gameType: ['game type', 'type', 'contest type'],
  homeTeam: ['home team', 'home'],
  awayTeam: ['away team', 'away', 'visitor', 'visiting team'],
  pattern: ['pattern', 'crew', 'crew size', 'officials required', 'positions'],
  payor: ['payor', 'payer', 'paid by', 'billing'],
  paidVia: ['paid via', 'payment method', 'pay method'],
  assignor: ['assignor', 'assigner', 'scheduler'],
  notes: ['notes', 'note', 'comments', 'remarks', 'description'],
  feeScheduled: ['default fee', 'scheduled fee', 'fee', 'rate', 'game fee', 'amount'],
  feeActual: ['actual fee', 'paid amount', 'earned', 'net fee', 'payment'],
  feeTravel: ['travel fee', 'mileage fee', 'travel'],
}
