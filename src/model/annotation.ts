/**
 * Layer 3 — Annotations. Manual corrections and additions, keyed by stable
 * identity (never by row index) so re-importing a corrected export keeps every
 * manual number attached to the thing it describes.
 */

import type { GearLevelId, GearModifierId } from './reference'

/**
 * How far into the commitment a cancellation was called, which decides what it
 * actually cost. Fee and status stay report-owned; this is the part only the
 * official knows.
 */
export type CancelStage =
  /** Called before leaving home: no drive, no cost. */
  | 'before-travel'
  /** Arrived, never started: the full drive, and the prep, were spent. */
  | 'after-arrival'
  /** Called during a day already under way, so the drive is another trip's. */
  | 'mid-day'

export const CANCEL_STAGES: { id: CancelStage; label: string; hint: string }[] = [
  { id: 'before-travel', label: 'Before I left', hint: 'No drive was made.' },
  { id: 'after-arrival', label: 'After I arrived', hint: 'The drive and prep were spent.' },
  { id: 'mid-day', label: 'Mid-day', hint: 'Part of a day already under way.' },
]

export type GameAnnotation = {
  /** Same dedupeKey as the game's `source.dedupeKey`. */
  dedupeKey: string
  durationMinutesOverride?: number
  /** What was worked: plate, bases, or the partner took the plate. */
  gearLevel?: GearLevelId
  /**
   * Conditions on top of the role — shield, dressed down, cold, rain. Independent
   * of `gearLevel` and of each other, so a cold plate game carries both.
   */
  gearModifiers?: GearModifierId[]
  /**
   * Sport code entered by hand, for rows the source left blank or wrong. Takes
   * precedence over `game.sportCode`, which stays untouched as the imported fact —
   * so a later export that fills the column in can be diffed against what you said.
   */
  sportCodeOverride?: string

  // --- Cancellations ------------------------------------------------------
  // A cancelled game earns nothing and takes no game time, so it never affects
  // income or rate. It can still have cost a drive, and the export cannot say
  // whether it did. These three fields are the only way that is knowable.

  /** How far the commitment got before it was called. */
  cancelStage?: CancelStage
  /**
   * True when the drive was actually made. This is what admits the game to the
   * trip layer: without it a cancellation forms no trip, so the app never
   * asserts a journey on the strength of a schedule entry alone.
   */
  droveToCancelled?: boolean
  /**
   * True when weather or field conditions caused it. Tracked separately from
   * the stage because it is the pattern worth watching over seasons — which
   * leagues and venues lose games to weather, and how often.
   */
  weatherRelated?: boolean

  // --- Acknowledged anomalies ---------------------------------------------
  // The app raises a fee anomaly where money and status disagree — an active game
  // paying nothing, a cancellation that paid anyway. Some of those are real and
  // correct: a rainout paid at half rate is genuinely a paid cancellation.
  //
  // The rule is to surface, never override. So an acknowledgement does not touch
  // the fee or the status, and does not make the oddity go away: it records that
  // it has been looked at, with room to say why, and the panel then shows it as
  // settled rather than outstanding. Keyed by `dedupeKey` like everything here, so
  // a re-import does not reopen a question already answered.

  /** Anomaly codes that have been reviewed and accepted as correct. */
  acknowledgedAnomalies?: FeeAnomalyCode[]
  /** Why each was accepted. Optional — an acknowledgement without a reason is still one. */
  anomalyNotes?: Partial<Record<FeeAnomalyCode, string>>

  /**
   * Rare calls made in this game, as ids into the call-types reference list.
   * Optional and unordered. An empty list is the same as unset — unlike gear,
   * there is no assumed call that clearing would have to override.
   */
  calls?: string[]

  notes?: string
}

/**
 * The kinds of fee anomaly the app raises.
 *
 * Each is a disagreement between two things the source stated, not a figure the app
 * computed — which is why the answer is to ask rather than to correct.
 */
export type FeeAnomalyCode = 'zero-fee-active' | 'paid-cancellation' | 'no-scheduled-fee'

export const FEE_ANOMALIES: {
  code: FeeAnomalyCode
  label: string
  note: string
  /** What an acknowledgement means, so accepting one is a considered act. */
  acknowledgeHint: string
}[] = [
  {
    code: 'zero-fee-active',
    label: 'Active games with a zero fee',
    note: 'Either the fee is missing from the source or the status is wrong.',
    acknowledgeHint: 'Accept where the game really was unpaid — a scrimmage or a favour.',
  },
  {
    code: 'paid-cancellation',
    label: 'Cancelled games that still paid',
    note: 'These are excluded from metrics as cancellations, but they did pay — check the status.',
    acknowledgeHint: 'Accept where a rainout paid a partial fee, which is normal.',
  },
  {
    code: 'no-scheduled-fee',
    label: 'Games with no scheduled fee',
    note: 'Scheduled-vs-actual variance cannot be computed for these.',
    acknowledgeHint: 'Accept where the assignment genuinely carried no rate.',
  },
]

export type ExpenseCategory =
  | 'tolls'
  | 'parking'
  | 'meals'
  | 'gear'
  | 'fuel'
  | 'dues'
  | 'other'

export type Expense = {
  id: string
  amount: number
  category: ExpenseCategory
  /** Whether this expense counts toward the tax view's deductible subtotal. */
  deductible: boolean
  note?: string
}

/** Keyed `${date}|${parkId}` — the trip's natural identity. */
export type TripAnnotation = {
  key: string
  milesOverride?: number
  tollsOverride?: number
  driveMinutesOverride?: number
  prepMinutesOverride?: number
  wrapMinutesOverride?: number
  expenses: Expense[]
  notes?: string
}

export function tripKey(date: string, parkId: string): string {
  return `${date}|${parkId}`
}

/** Splits a trip key back into its date and park. The date never contains `|`. */
export function parseTripKey(key: string): { date: string; parkId: string } {
  const i = key.indexOf('|')
  return i === -1 ? { date: key, parkId: '' } : { date: key.slice(0, i), parkId: key.slice(i + 1) }
}

/**
 * Folds two annotations for what has become one trip — a park merge on a day both
 * parks were worked. Nothing entered is dropped: expenses are concatenated, notes
 * joined, and where both set the same override the surviving park's figure wins,
 * as it does for the park's own figures.
 */
export function mergeTripAnnotations(
  keep: TripAnnotation,
  merge: TripAnnotation,
): TripAnnotation {
  const notes = [keep.notes, merge.notes].filter((n) => n?.trim()).join(' / ')
  const out: TripAnnotation = {
    ...merge,
    ...keep,
    expenses: [...keep.expenses, ...merge.expenses],
  }
  for (const k of [
    'milesOverride',
    'tollsOverride',
    'driveMinutesOverride',
    'prepMinutesOverride',
    'wrapMinutesOverride',
  ] as const) {
    const v = keep[k] ?? merge[k]
    if (v != null) out[k] = v
    else delete out[k]
  }
  if (notes) out.notes = notes
  else delete out.notes
  return out
}
