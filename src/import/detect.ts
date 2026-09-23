/**
 * Profile detection by header fingerprint. Returns ranked candidates with a
 * confidence score rather than a single guess, so the import UI can show what
 * it thinks and let the user override.
 */

import type { SourceProfile } from './profiles'
import { BUILT_IN_PROFILES } from './profiles'
import { FIELD_SYNONYMS } from './profiles/generic'
import { CANONICAL_FIELDS, type CanonicalField } from '../model/game'

export type DetectionCandidate = {
  profile: SourceProfile
  /** Jaccard similarity over the header sets, 0..1. */
  confidence: number
  matchedHeaders: string[]
  missingHeaders: string[]
  extraHeaders: string[]
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export function detectProfile(
  headers: string[],
  profiles: SourceProfile[] = BUILT_IN_PROFILES,
): DetectionCandidate[] {
  const fileSet = new Set(headers.map(norm))

  return profiles
    .filter((p) => p.fingerprint.length > 0)
    .map((profile) => {
      const profSet = new Set(profile.fingerprint.map(norm))
      const matched = [...profSet].filter((h) => fileSet.has(h))
      const missing = [...profSet].filter((h) => !fileSet.has(h))
      const extra = [...fileSet].filter((h) => !profSet.has(h))
      const union = new Set([...profSet, ...fileSet]).size
      return {
        profile,
        confidence: union === 0 ? 0 : matched.length / union,
        matchedHeaders: matched,
        missingHeaders: missing,
        extraHeaders: extra,
      }
    })
    .sort((a, b) => b.confidence - a.confidence)
}

/** Above this, the import view offers a one-click import. */
export const CONFIDENT_THRESHOLD = 0.8

export type FieldSuggestion = {
  field: CanonicalField
  header: string | null
  score: number
}

/**
 * Fuzzy suggestions to pre-fill the mapping UI for an unknown source. Exact
 * synonym hits score 1; token overlap scores lower and is offered but not
 * assumed.
 */
export function suggestFieldMap(headers: string[]): FieldSuggestion[] {
  const taken = new Set<string>()
  const scored: { field: CanonicalField; header: string; score: number }[] = []

  for (const field of CANONICAL_FIELDS) {
    const synonyms = (FIELD_SYNONYMS[field] ?? []).map(norm)
    for (const header of headers) {
      const h = norm(header)
      let score = 0
      if (synonyms.includes(h)) score = 1
      else if (synonyms.some((s) => h === s.replace(/ /g, ''))) score = 0.95
      else if (synonyms.some((s) => h.includes(s) || s.includes(h))) score = 0.7
      else {
        const hTokens = new Set(h.split(' '))
        const best = synonyms.reduce((acc, s) => {
          const sTokens = s.split(' ')
          const hits = sTokens.filter((t) => hTokens.has(t)).length
          return Math.max(acc, hits / Math.max(sTokens.length, hTokens.size))
        }, 0)
        if (best >= 0.5) score = best * 0.6
      }
      if (score > 0) scored.push({ field, header, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const chosen = new Map<CanonicalField, { header: string; score: number }>()
  for (const s of scored) {
    if (chosen.has(s.field) || taken.has(s.header)) continue
    chosen.set(s.field, { header: s.header, score: s.score })
    taken.add(s.header)
  }

  return CANONICAL_FIELDS.map((field) => {
    const hit = chosen.get(field)
    return { field, header: hit?.header ?? null, score: hit?.score ?? 0 }
  })
}

/**
 * Discovers `Position N` / `Official N` column pairs, so a 3- or 4-official crew
 * needs no schema change. Also accepts `Official`/`Position` without a number,
 * and `Umpire N` / `Referee N` wordings.
 */
export function discoverOfficialColumns(
  headers: string[],
): { position: string; official: string }[] {
  const officialRe = /^(official|umpire|referee|judge)\s*(\d+)?$/i
  const positionRe = /^(position|role|slot)\s*(\d+)?$/i

  const officials = new Map<string, string>()
  const positions = new Map<string, string>()

  for (const h of headers) {
    const o = officialRe.exec(norm(h))
    if (o) officials.set(o[2] ?? '1', h)
    const p = positionRe.exec(norm(h))
    if (p) positions.set(p[2] ?? '1', h)
  }

  return [...officials.keys()]
    .sort((a, b) => Number(a) - Number(b))
    .map((slot) => ({
      position: positions.get(slot) ?? '',
      official: officials.get(slot)!,
    }))
}
