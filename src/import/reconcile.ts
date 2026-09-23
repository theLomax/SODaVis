/**
 * Reconciliation. Decides, per incoming game, whether it is new, unchanged, or
 * a conflict — and never writes anything itself.
 *
 * Two rules matter more than the rest:
 *  - A game missing from this file is left untouched. A narrower date range is
 *    not a deletion.
 *  - A changed field is a conflict shown as a field-level diff, not a silent
 *    overwrite, because the stored value may be the corrected one.
 */

import type { Game } from '../model/game'

export type FieldDiff = {
  field: string
  /** Rendered as text. Never HTML. */
  stored: string
  incoming: string
}

export type Reconciliation = {
  inserts: Game[]
  unchanged: Game[]
  conflicts: { stored: Game; incoming: Game; diffs: FieldDiff[] }[]
  /** Stored games this file did not mention. Reported, never deleted. */
  absentFromFile: Game[]
}

/**
 * Fields compared for conflict detection. Deliberately excludes `source`
 * (importId/importedAt always differ) and `flags` (derived from the values
 * being compared).
 */
const COMPARED_FIELDS = [
  'date',
  'startTime',
  'endTime',
  'venueRaw',
  'subVenueRaw',
  'ageGroupRaw',
  'status',
  'league',
  'sportCode',
  'gameType',
  'homeTeam',
  'awayTeam',
  'pattern',
  'payor',
  'paidVia',
  'assignor',
  'notes',
  'rulesUrl',
] as const

const show = (v: unknown): string =>
  v == null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v)

const money = (v: number | undefined): string => (v == null ? '—' : v.toFixed(2))

export function diffGames(stored: Game, incoming: Game): FieldDiff[] {
  const diffs: FieldDiff[] = []

  for (const field of COMPARED_FIELDS) {
    const a = stored[field]
    const b = incoming[field]
    if ((a ?? '') !== (b ?? '')) {
      diffs.push({ field, stored: show(a), incoming: show(b) })
    }
  }

  for (const key of ['scheduled', 'actual', 'travel'] as const) {
    if ((stored.fees[key] ?? null) !== (incoming.fees[key] ?? null)) {
      diffs.push({
        field: `fees.${key}`,
        stored: money(stored.fees[key]),
        incoming: money(incoming.fees[key]),
      })
    }
  }

  const crew = (g: Game) =>
    g.assignments.map((a) => `${a.position}: ${a.official}`).join(' | ')
  if (crew(stored) !== crew(incoming)) {
    diffs.push({ field: 'assignments', stored: show(crew(stored)), incoming: show(crew(incoming)) })
  }

  return diffs
}

export function reconcile(stored: Game[], incoming: Game[]): Reconciliation {
  const byKey = new Map(stored.map((g) => [g.source.dedupeKey, g]))
  const seen = new Set<string>()

  const result: Reconciliation = {
    inserts: [],
    unchanged: [],
    conflicts: [],
    absentFromFile: [],
  }

  for (const game of incoming) {
    const key = game.source.dedupeKey
    seen.add(key)
    const existing = byKey.get(key)

    if (!existing) {
      result.inserts.push(game)
      continue
    }

    const diffs = diffGames(existing, game)
    if (diffs.length === 0) result.unchanged.push(existing)
    else result.conflicts.push({ stored: existing, incoming: game, diffs })
  }

  for (const game of stored) {
    if (!seen.has(game.source.dedupeKey)) result.absentFromFile.push(game)
  }

  return result
}

/**
 * Applies a resolved conflict. `incoming` wins on the compared fields but the
 * stored game's internal id is kept, so annotations and any references to it
 * stay valid.
 */
export function resolveToIncoming(stored: Game, incoming: Game): Game {
  return { ...incoming, id: stored.id }
}
