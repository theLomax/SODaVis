/**
 * A source profile describes one assignment platform's export shape. Adding a
 * platform means adding a profile (or building one in the mapping UI) - never
 * editing the pipeline.
 */

import type { CanonicalField, GameStatus } from '../../model/game'

export type OfficialColumnPair = { position: string; official: string }

export type DedupeSpec =
  /** The source has a stable unique id column. */
  | { strategy: 'natural'; column: string }
  /** No stable id: hash these columns instead. */
  | { strategy: 'fingerprint'; columns: string[] }

export type SourceProfile = {
  id: string
  label: string
  /** Headers expected in this source, used for detection. */
  fingerprint: string[]
  /**
   * Canonical field -> source header. An array means "first header present
   * wins", which lets one profile cover minor export variants.
   */
  fieldMap: Partial<Record<CanonicalField, string | string[] | null>>
  statusVocabulary: Record<string, GameStatus>
  /**
   * Explicit position/official column pairs, or `'auto'` to discover
   * `Position N` / `Official N` pairs by pattern - so a 3- or 4-official crew
   * works without a schema change.
   */
  officialColumns: OfficialColumnPair[] | 'auto'
  dedupe: DedupeSpec
  /** Rows failing this predicate are dropped (blank rows, totals trailers). */
  isDataRow: (row: Record<string, string>) => boolean
  /** Per-field overrides for the default coercers. */
  transforms?: Partial<Record<CanonicalField, (v: string) => unknown>>
  /** Separator when a source packs several values into the notes cell. */
  notesSeparator?: string
  /** True when this profile was built in the mapping UI and is user-owned. */
  isCustom?: boolean
}
