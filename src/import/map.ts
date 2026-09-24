/**
 * Row -> canonical Game. This is the only place that knows how a source's
 * strings become facts, and it never throws: an unparseable value becomes a
 * data-quality flag on the game so the row still lands and the problem is
 * visible in the Data Quality panel.
 */

import type {
  Assignment,
  CanonicalField,
  DataQualityFlag,
  Game,
} from '../model/game'
import type { Identity } from '../model/reference'
import type { SourceProfile } from './profiles'
import { discoverOfficialColumns } from './detect'
import {
  cleanString,
  fingerprint,
  matchesIdentity,
  parseDate,
  parseMoney,
  parseStatus,
  parseTime,
  splitNotes,
} from './transforms'

export type MapContext = {
  profile: SourceProfile
  identity: Identity
  importId: string
  importedAt: string
  headers: string[]
  currency: string
}

export type MappedRow =
  | { ok: true; game: Game }
  | { ok: false; reason: string; rawRow: Record<string, string> }

/** Resolves a canonical field to the row's value, honoring multi-header maps. */
function pick(
  row: Record<string, string>,
  fieldMap: SourceProfile['fieldMap'],
  field: CanonicalField,
): string | undefined {
  const spec = fieldMap[field]
  if (!spec) return undefined
  const headers = Array.isArray(spec) ? spec : [spec]
  for (const h of headers) {
    const v = row[h]
    if (v != null && v.trim() !== '') return v
  }
  return undefined
}

export function mapRow(
  row: Record<string, string>,
  ctx: MapContext,
  rowIndex: number,
): MappedRow {
  const { profile, identity } = ctx
  const flags: DataQualityFlag[] = []

  const rawDate = pick(row, profile.fieldMap, 'date')
  const date = parseDate(rawDate)
  if (!date) {
    return {
      ok: false,
      reason: `Row ${rowIndex + 2}: no readable date (${JSON.stringify(rawDate ?? '')})`,
      rawRow: row,
    }
  }

  const rawStart = pick(row, profile.fieldMap, 'startTime')
  const startTime = parseTime(rawStart)
  if (!startTime && rawStart) {
    flags.push({
      code: 'unparsed-time',
      severity: 'warning',
      message: 'Start time could not be read and is shown as midnight.',
      context: rawStart,
    })
  }

  const status = parseStatus(
    pick(row, profile.fieldMap, 'status'),
    profile.statusVocabulary,
  )

  // No flag raised here: whether a blank sport code still matters depends on
  // whether it has since been tagged by hand, which is a resolve-time question.
  const sportCode = cleanString(pick(row, profile.fieldMap, 'sportCode'))

  // --- Officials -----------------------------------------------------------
  const pairs =
    profile.officialColumns === 'auto'
      ? discoverOfficialColumns(ctx.headers)
      : profile.officialColumns

  const assignments: Assignment[] = []
  for (const pair of pairs) {
    const official = cleanString(row[pair.official])
    if (!official) continue
    assignments.push({
      position: cleanString(pair.position ? row[pair.position] : undefined) ?? '',
      official,
      isSelf: matchesIdentity(official, identity.patterns),
    })
  }

  if (assignments.length && !assignments.some((a) => a.isSelf)) {
    flags.push({
      code: 'self-not-found',
      severity: 'serious',
      message:
        'None of this game’s officials matched your identity patterns, so no partner could be derived.',
      context: assignments.map((a) => a.official).join('; '),
    })
  }

  // A stated crew size with an empty slot is surfaced, never guessed at.
  const pattern = cleanString(pick(row, profile.fieldMap, 'pattern'))
  const statedCrew = pattern ? /(\d+)/.exec(pattern)?.[1] : undefined
  if (statedCrew && assignments.length < Number(statedCrew)) {
    flags.push({
      code: 'crew-pattern-mismatch',
      severity: 'warning',
      message: `Source says "${pattern}" but lists ${assignments.length} official${
        assignments.length === 1 ? '' : 's'
      }.`,
      context: pattern,
    })
  }

  // --- Fees ----------------------------------------------------------------
  const scheduled = parseMoney(pick(row, profile.fieldMap, 'feeScheduled'))
  const actual = parseMoney(pick(row, profile.fieldMap, 'feeActual'))
  const travel = parseMoney(pick(row, profile.fieldMap, 'feeTravel'))

  if (scheduled != null && actual != null && scheduled !== actual) {
    flags.push(
      actual > scheduled
        ? {
            code: 'fee-adjusted-up',
            severity: 'info',
            message: `Paid more than scheduled (${scheduled} → ${actual}).`,
          }
        : {
            code: 'fee-forfeited',
            severity: 'info',
            message: `Paid less than scheduled (${scheduled} → ${actual}).`,
          },
    )
  }

  const { notes, rulesUrl } = splitNotes(
    pick(row, profile.fieldMap, 'notes'),
    profile.notesSeparator,
  )

  // --- Dedupe key ----------------------------------------------------------
  const sourceId = cleanString(pick(row, profile.fieldMap, 'sourceId'))
  const venueRaw = cleanString(pick(row, profile.fieldMap, 'venueRaw')) ?? ''
  const ageGroupRaw = cleanString(pick(row, profile.fieldMap, 'ageGroupRaw')) ?? ''

  let dedupeKey: string
  if (profile.dedupe.strategy === 'natural') {
    const natural = cleanString(row[profile.dedupe.column]) ?? sourceId
    if (natural) {
      dedupeKey = `${profile.id}:${natural}`
    } else {
      // The declared id column was empty; fall back rather than drop the row.
      dedupeKey = `${profile.id}:${fingerprint([date, startTime, venueRaw, ageGroupRaw])}`
      flags.push({
        code: 'duplicate-dedupe-key',
        severity: 'warning',
        message:
          'Source id was empty, so this game is keyed by date/time/venue instead. Two genuinely distinct games sharing those would merge.',
      })
    }
  } else {
    const values = profile.dedupe.columns.map((col) => {
      // Fingerprint columns may name canonical fields or raw headers.
      const asField = pick(row, profile.fieldMap, col as CanonicalField)
      return asField ?? row[col] ?? ''
    })
    dedupeKey = `${profile.id}:${fingerprint(values)}`
  }

  const game: Game = {
    id: `game_${dedupeKey.replace(/[^a-zA-Z0-9_:-]/g, '')}`,
    source: {
      system: profile.id,
      ...(sourceId ? { sourceId } : {}),
      dedupeKey,
      importId: ctx.importId,
      importedAt: ctx.importedAt,
      rawRow: { ...row },
    },
    date,
    startTime: startTime ?? '00:00',
    venueRaw,
    ageGroupRaw,
    status,
    fees: {
      ...(scheduled != null ? { scheduled } : {}),
      ...(actual != null ? { actual } : {}),
      ...(travel != null ? { travel } : {}),
      currency: ctx.currency,
    },
    assignments,
    flags,
  }

  const optional: [keyof Game, string | undefined][] = [
    ['endTime', parseTime(pick(row, profile.fieldMap, 'endTime'))],
    ['subVenueRaw', cleanString(pick(row, profile.fieldMap, 'subVenueRaw'))],
    ['league', cleanString(pick(row, profile.fieldMap, 'league'))],
    ['sportCode', sportCode],
    ['gameType', cleanString(pick(row, profile.fieldMap, 'gameType'))],
    ['homeTeam', cleanString(pick(row, profile.fieldMap, 'homeTeam'))],
    ['awayTeam', cleanString(pick(row, profile.fieldMap, 'awayTeam'))],
    ['pattern', pattern],
    ['payor', cleanString(pick(row, profile.fieldMap, 'payor'))],
    ['paidVia', cleanString(pick(row, profile.fieldMap, 'paidVia'))],
    ['assignor', cleanString(pick(row, profile.fieldMap, 'assignor'))],
    ['notes', notes],
    ['rulesUrl', rulesUrl],
  ]
  for (const [key, value] of optional) {
    if (value !== undefined) (game as Record<string, unknown>)[key] = value
  }

  return { ok: true, game }
}

export type MapResult = {
  games: Game[]
  skipped: { reason: string; rawRow: Record<string, string> }[]
  /** Rows dropped by the profile's isDataRow predicate. */
  nonDataRows: number
}

export function mapRows(
  rows: Record<string, string>[],
  ctx: MapContext,
): MapResult {
  const games: Game[] = []
  const skipped: MapResult['skipped'] = []
  let nonDataRows = 0

  rows.forEach((row, i) => {
    if (!ctx.profile.isDataRow(row)) {
      nonDataRows++
      return
    }
    const mapped = mapRow(row, ctx, i)
    if (mapped.ok) games.push(mapped.game)
    else skipped.push({ reason: mapped.reason, rawRow: mapped.rawRow })
  })

  // Within a single file, a repeated dedupe key is a source problem worth
  // naming rather than silently collapsing.
  const seen = new Map<string, number>()
  for (const g of games) {
    seen.set(g.source.dedupeKey, (seen.get(g.source.dedupeKey) ?? 0) + 1)
  }
  for (const g of games) {
    if ((seen.get(g.source.dedupeKey) ?? 0) > 1) {
      g.flags.push({
        code: 'duplicate-dedupe-key',
        severity: 'serious',
        message: 'This file contains more than one row with this same key.',
        context: g.source.dedupeKey,
      })
    }
  }

  return { games, skipped, nonDataRows }
}
