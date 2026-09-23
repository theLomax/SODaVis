/**
 * Layer 1 — Facts. Imported from a source file, treated as immutable.
 *
 * Nothing in this layer is user-editable. Corrections live in Layer 3
 * (annotations) so that re-importing a source file can never destroy them.
 */

/** Canonical fields any source profile can map onto. */
export const CANONICAL_FIELDS = [
  'sourceId',
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
  'feeScheduled',
  'feeActual',
  'feeTravel',
] as const

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]

export type GameStatus =
  | 'active'
  | 'cancelled-nopay'
  | 'cancelled-paid'
  | 'postponed'
  | 'unknown'

/** Statuses that represent work that did not happen. */
export const CANCELLED_STATUSES: readonly GameStatus[] = [
  'cancelled-nopay',
  'cancelled-paid',
  'postponed',
]

export function isCancelled(status: GameStatus): boolean {
  return CANCELLED_STATUSES.includes(status)
}

export type DataQualityFlagCode =
  | 'unmatched-venue'
  | 'missing-duration'
  | 'crew-pattern-mismatch'
  | 'self-not-found'
  | 'multi-trip-day'
  | 'fee-adjusted-up'
  | 'fee-forfeited'
  | 'missing-sport-code'
  | 'missing-mileage'
  | 'missing-drive-time'
  | 'unparsed-date'
  | 'unparsed-time'
  | 'duplicate-dedupe-key'

export type DataQualityFlag = {
  code: DataQualityFlagCode
  /** Human-readable, safe to render as text. Never HTML. */
  message: string
  severity: 'info' | 'warning' | 'serious'
  /** Free-form pointer to the offending value, for the Data Quality table. */
  context?: string
}

export type Assignment = {
  position: string
  official: string
  isSelf: boolean
}

export type GameFees = {
  scheduled?: number
  actual?: number
  travel?: number
  currency: string
}

export type GameSource = {
  /** Profile id: 'assignr' | 'reftown' | 'custom:<name>' */
  system: string
  /** Natural key from the source, when it has one. */
  sourceId?: string
  /** sourceId when available, else a synthetic fingerprint hash. */
  dedupeKey: string
  importId: string
  importedAt: string
  /**
   * The source row, verbatim. Kept so a mis-mapped column can be re-mapped
   * without re-importing, and so nothing in the file is silently lost.
   */
  rawRow: Record<string, string>
}

export type Game = {
  id: string
  source: GameSource
  /** ISO date, 'YYYY-MM-DD'. */
  date: string
  /** 24h 'HH:mm'. */
  startTime: string
  endTime?: string
  venueRaw: string
  subVenueRaw?: string
  ageGroupRaw: string
  status: GameStatus
  league?: string
  /** Raw source sport code, e.g. 'C-BB'. Resolved to a SportProfile later. */
  sportCode?: string
  gameType?: string
  homeTeam?: string
  awayTeam?: string
  /** Crew pattern as the source states it, e.g. '2 umpires'. */
  pattern?: string
  payor?: string
  paidVia?: string
  assignor?: string
  notes?: string
  /** Split out of notes when the source packs a URL in alongside a note. */
  rulesUrl?: string
  fees: GameFees
  assignments: Assignment[]
  flags: DataQualityFlag[]
}

/** An import run. Retained so a run can be undone in one step. */
export type ImportRun = {
  id: string
  importedAt: string
  fileName: string
  profileId: string
  profileLabel: string
  counts: {
    rowsInFile: number
    rowsSkipped: number
    inserted: number
    updated: number
    unchanged: number
    conflicts: number
  }
  /** Games inserted by this run, for undo. */
  insertedGameIds: string[]
  /** Pre-image of games this run overwrote, for undo. */
  replacedGames: Game[]
  notes?: string
}
