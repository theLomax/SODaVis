/**
 * Layer 4 — Derived. Fee anomalies, and which of them have been accepted.
 *
 * An anomaly here is a disagreement between two things the *source* stated — an
 * active game paying nothing, a cancellation that paid anyway — not a figure the
 * app computed. That is why the answer is to ask rather than to correct: the export
 * is the record, and the app has no standing to overwrite it.
 *
 * Some of these are genuinely correct. A rainout paid at half rate really is a paid
 * cancellation. So an anomaly can be *acknowledged*: the fee and the status are
 * untouched, the anomaly is still listed, but it is marked as settled rather than
 * outstanding, with room to record why. Nothing is ever suppressed — a known-good
 * oddity that vanished would be indistinguishable from one nobody had looked at.
 */

import type { Game } from '../model/game'
import { isCancelled } from '../model/game'
import type { FeeAnomalyCode, GameAnnotation } from '../model/annotation'

export type FeeAnomaly = {
  code: FeeAnomalyCode
  game: Game
  scheduled: number | null
  actual: number | null
  /** True once reviewed and accepted as correct. */
  acknowledged: boolean
  /** Why it was accepted, where a reason was given. */
  note?: string
}

/** Which anomalies, if any, a game exhibits. */
export function anomalyCodesFor(game: Game): FeeAnomalyCode[] {
  const codes: FeeAnomalyCode[] = []
  const actual = game.fees.actual ?? 0

  // An active game that paid nothing: either the fee is missing from the source or
  // the status is wrong. Both are worth a look; neither is ours to decide.
  //
  // Only `active`, not merely "not cancelled": a postponed game has not been played
  // and an `unknown` status is already reported as its own problem, so a zero fee
  // against either is expected rather than odd.
  if (game.status === 'active' && actual === 0) codes.push('zero-fee-active')
  // A cancellation that paid: excluded from metrics as a cancellation, yet money
  // arrived. Often correct — a partial rainout fee — which is why it is askable.
  if (isCancelled(game.status) && actual > 0) codes.push('paid-cancellation')
  // No scheduled fee at all, so scheduled-vs-actual variance cannot be computed.
  if (game.fees.scheduled == null) codes.push('no-scheduled-fee')

  return codes
}

/**
 * Every anomaly across a set of games, each carrying its own acknowledgement.
 *
 * Acknowledgement is per game *and* per code, not per game: accepting that a
 * cancellation legitimately paid says nothing about whether its missing scheduled
 * fee is also fine.
 */
export function feeAnomalies(
  games: Game[],
  annotations: Map<string, GameAnnotation>,
): FeeAnomaly[] {
  const out: FeeAnomaly[] = []

  for (const game of games) {
    const annotation = annotations.get(game.source.dedupeKey)
    for (const code of anomalyCodesFor(game)) {
      const acknowledged = annotation?.acknowledgedAnomalies?.includes(code) === true
      const note = annotation?.anomalyNotes?.[code]
      out.push({
        code,
        game,
        scheduled: game.fees.scheduled ?? null,
        actual: game.fees.actual ?? null,
        acknowledged,
        ...(note ? { note } : {}),
      })
    }
  }

  return out.sort(
    (a, b) =>
      Number(a.acknowledged) - Number(b.acknowledged) ||
      a.game.date.localeCompare(b.game.date) ||
      a.code.localeCompare(b.code),
  )
}

export type AnomalyGroup = {
  code: FeeAnomalyCode
  items: FeeAnomaly[]
  /** Still to be looked at. This is the number worth showing as a warning. */
  outstanding: number
  acknowledged: number
}

/**
 * Anomalies grouped by kind, outstanding first.
 *
 * The count that matters is `outstanding`: a group whose every member has been
 * accepted is no longer work to do, and showing it as a warning would train the
 * reader to ignore the panel.
 */
export function groupAnomalies(anomalies: FeeAnomaly[]): AnomalyGroup[] {
  const byCode = new Map<FeeAnomalyCode, FeeAnomaly[]>()
  for (const a of anomalies) {
    const bucket = byCode.get(a.code)
    if (bucket) bucket.push(a)
    else byCode.set(a.code, [a])
  }

  return [...byCode.entries()]
    .map(([code, items]) => ({
      code,
      items,
      outstanding: items.filter((i) => !i.acknowledged).length,
      acknowledged: items.filter((i) => i.acknowledged).length,
    }))
    .sort((a, b) => b.outstanding - a.outstanding || a.code.localeCompare(b.code))
}
