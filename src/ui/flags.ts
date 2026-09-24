/**
 * Human-facing copy for data-quality flags — the single source of truth for how
 * a flag is named and explained, shared by the Data quality view, the Trips
 * table and the flag dialog.
 *
 * The model layer (`DataQualityFlag`) carries a machine code and a one-line
 * message written where the flag was raised. That message says what happened on
 * one specific row; this registry says what the *kind* of problem means, what it
 * costs, and what to do about it. Keeping the two apart means a flag raised deep
 * in the derive layer never has to know how a dialog will present it.
 */

import type { DataQualityFlag, DataQualityFlagCode } from '../model/game'
import { STATUS, STATUS_ICON } from './charts/palette'

/**
 * Where a flag is fixed, as somewhere the app can actually go rather than as a
 * sentence describing it.
 *
 * `label` carries the wording that used to be a bare string, so a target that
 * cannot be actioned still reads the same on screen. `navigate()` in the store
 * takes one of these plus an optional `focus`, which is why the fix is one click
 * from wherever the flag was noticed.
 */
export type FixTarget =
  | { view: 'reference'; tab: 'parks' | 'durations' | 'identity'; label: string }
  | { view: 'trips'; label: string }
  | { view: 'quality'; label: string }
  | { view: 'import'; label: string }

export type FlagPresentation = {
  /** Singular, for one occurrence: 'Multi-park day'. */
  title: string
  /** Plural heading, for a group: 'Multi-park days needing a mileage figure'. */
  groupTitle: string
  /** What the app detected. */
  what: string
  /** What it costs — which numbers are affected, and how. */
  why: string
  /** What to do about it. */
  fix: string
  /** Where to do it: the navigation path as it reads on screen, and reachable. */
  fixTarget?: FixTarget
}

export const FLAG_INFO: Record<DataQualityFlagCode, FlagPresentation> = {
  'unmatched-venue': {
    title: 'Unmatched venue',
    groupTitle: 'Unmatched venues',
    what: 'This game’s venue string does not match any park, by alias or by pattern.',
    why: 'A game with no park forms no trip, so it contributes no mileage, no tolls and no drive time. Its income still counts.',
    fix: 'Add the venue string as an alias of an existing park, or create a park from it. An unmatched venue is never turned into its own park automatically, because that would split one park into several.',
    fixTarget: { view: 'reference', tab: 'parks', label: 'Reference data → Parks & mileage' },
  },
  'missing-duration': {
    title: 'No game duration',
    groupTitle: 'Missing game durations',
    what: 'No game length is on record for this age group, and the source string does not state one.',
    why: 'The game is excluded from every time model and from rate-per-hour — along with its income, so the rate is not diluted. It still counts toward income and games worked.',
    fix: 'Enter a duration for the age group. One figure covers every game in that group.',
    fixTarget: { view: 'reference', tab: 'durations', label: 'Reference data → Game durations' },
  },
  'crew-pattern-mismatch': {
    title: 'Crew size mismatch',
    groupTitle: 'Crew size mismatches',
    what: 'The source states a larger crew than the officials it actually lists.',
    why: 'The missing official cannot be attributed to anyone, so this game reads as solo in the Partners view.',
    fix: 'Nothing here is guessed. If you remember who worked it, correct the export at the source and re-import — your annotations will survive the re-import.',
  },
  'multi-trip-day': {
    title: 'Multi-park day',
    groupTitle: 'Multi-park days needing a mileage figure',
    what: 'You worked more than one park on this date, so this trip is one of two or more that day.',
    why: 'Mileage defaults to a round trip per park, which counts the drive home twice on a day like this. Both the mileage total and the tax deduction are overstated until you say otherwise.',
    fix: 'Enter the actual miles for this trip as an override. Doing so clears this flag for the trip.',
    fixTarget: { view: 'trips', label: 'Trips → open the trip → Manual overrides' },
  },
  'missing-mileage': {
    title: 'No mileage for this park',
    groupTitle: 'Parks with no mileage',
    what: 'No one-way distance is on record for this park.',
    why: 'This trip adds nothing to the mileage total, so both the total and the IRS mileage deduction are a floor rather than a figure. Drive time cannot be estimated either.',
    fix: 'Add one-way miles to the park, which then covers every trip there, or enter a one-off override on this trip.',
    fixTarget: { view: 'reference', tab: 'parks', label: 'Reference data → Parks & mileage' },
  },
  'missing-drive-time': {
    title: 'No drive time',
    groupTitle: 'Trips with no drive time',
    what: 'This park has no stored drive time, and no mileage to estimate one from.',
    why: 'The trip is excluded from the game + drive and committed time models, along with its income.',
    fix: 'Add one-way miles or a one-way drive time to the park. With miles present, drive time is estimated from the fallback speed in Settings.',
    fixTarget: { view: 'reference', tab: 'parks', label: 'Reference data → Parks & mileage' },
  },
  'self-not-found': {
    title: 'You were not found in the crew',
    groupTitle: 'Games where you were not found in the crew',
    what: 'None of the officials on this game matched your identity patterns.',
    why: 'Without knowing which slot is yours, no partner can be derived, so this game is missing from the Partners view.',
    fix: 'Add or widen an identity pattern. Patterns are matched case-insensitively and are meant to tolerate a rotating season suffix such as (F25) or (S26).',
    fixTarget: { view: 'reference', tab: 'identity', label: 'Reference data → Identity' },
  },
  'missing-sport-code': {
    title: 'No sport code',
    groupTitle: 'Games with no sport code',
    what: 'The source row carried no sport code.',
    why: 'Prep and wrap time fall back to defaults rather than the sport’s own figures, so committed time for this trip is approximate.',
    fix: 'Nothing is broken. If the league reliably means one sport, the cleanest fix is at the source.',
  },
  'duplicate-dedupe-key': {
    title: 'Duplicate identity key',
    groupTitle: 'Duplicate identity keys',
    what: 'More than one row shares this game’s identity key.',
    why: 'The rows cannot be told apart on re-import, so one will overwrite the other and any annotation will attach to whichever survives.',
    fix: 'If the source has a unique id column, map it as the identity field so keys stop colliding.',
    fixTarget: { view: 'import', label: 'Import → Review column mapping' },
  },
  'fee-adjusted-up': {
    title: 'Paid above the assigned rate',
    groupTitle: 'Paid above the assigned rate',
    what: 'The actual fee is higher than the fee this game was assigned at.',
    why: 'Nothing is wrong. Actual fee is what counts as income; the difference is reported as pay above rate on the Cancellations view.',
    fix: 'No action needed. This is shown so the gap between scheduled and actual is always explainable.',
  },
  'fee-forfeited': {
    title: 'Paid below the assigned rate',
    groupTitle: 'Paid below the assigned rate',
    what: 'The actual fee is lower than the fee this game was assigned at.',
    why: 'Income reflects what actually arrived. The shortfall is reported as forfeited pay.',
    fix: 'If the figure is wrong, correct it at the source and re-import — the diff is shown for review before anything is written.',
  },
  'unparsed-time': {
    title: 'Unreadable start time',
    groupTitle: 'Unreadable start times',
    what: 'The start time in the source was blank or could not be read, so it is stored as midnight.',
    why: 'Trip ordering and committed time are wrong for this trip, since committed time runs from the first start to the last end.',
    fix: 'Correct the time at the source and re-import.',
  },
  'unrecognised-status': {
    title: 'Unrecognised status',
    groupTitle: 'Games with an unrecognised status',
    what: 'The source status is blank or is not one the importer knows, so the game is stored as unknown.',
    why: 'An unknown status is not counted as worked — it adds no income, forms no trip, and is not treated as a cancellation. Leaving it unreviewed silently drops the game from every total.',
    fix: 'Correct the status at the source and re-import, or map the wording in the source profile.',
    fixTarget: { view: 'import', label: 'Import → Review column mapping' },
  },
  'unparsed-date': {
    title: 'Unreadable date',
    groupTitle: 'Unreadable dates',
    what: 'The date in the source could not be read.',
    why: 'A row with no readable date carries no game and is skipped on import rather than stored.',
    fix: 'Correct the date at the source and re-import.',
  },
}

/** Falls back gracefully if a new code is added to the model before its copy. */
export function flagInfo(code: DataQualityFlagCode): FlagPresentation {
  return (
    FLAG_INFO[code] ?? {
      title: code,
      groupTitle: code,
      what: 'This flag has no description yet.',
      why: '',
      fix: '',
    }
  )
}

export function flagTitle(code: DataQualityFlagCode): string {
  return flagInfo(code).title
}

export function flagGroupTitle(code: DataQualityFlagCode, count: number): string {
  return `${flagInfo(code).groupTitle} (${count})`
}


/**
 * How a flag's severity is marked in the UI.
 *
 * `warning` and `serious` are genuine states and take their reserved status
 * tokens. `info` deliberately does NOT: mapping it onto the `good` token would
 * print a success checkmark beside something that is merely a note, which reads
 * as "this passed" — so it gets neutral ink and an informational glyph instead.
 * Either way the icon ships with a label, so hue never carries the meaning alone.
 */
export type FlagMarker = { color: string; icon: string }

export function flagMarker(severity: DataQualityFlag['severity']): FlagMarker {
  if (severity === 'serious') return { color: STATUS.serious, icon: STATUS_ICON.serious }
  if (severity === 'warning') return { color: STATUS.warning, icon: STATUS_ICON.warning }
  return { color: 'var(--text-muted)', icon: 'i' }
}
