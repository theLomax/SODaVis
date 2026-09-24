/**
 * Value coercers. Each takes the raw source string and returns a canonical
 * value, or `undefined` when the string carries no value. None of these throw -
 * an unparseable value becomes `undefined` and the caller raises a flag, so one
 * bad cell never aborts an import.
 */

import type { GameStatus } from '../model/game'

/** `'$1,234.00'` -> `1234`. `'-$1.91'` -> `-1.91`. Empty -> `undefined`. */
export function parseMoney(raw: string | undefined): number | undefined {
  if (raw == null) return undefined
  const s = raw.trim()
  if (!s) return undefined
  // Accounting negatives: '($5.00)'
  const negParen = /^\(.*\)$/.test(s)
  const cleaned = s.replace(/[()]/g, '').replace(/[^0-9.,+-]/g, '')
  if (!cleaned || !/[0-9]/.test(cleaned)) return undefined
  // Strip thousands separators, keep the decimal point.
  const n = Number(cleaned.replace(/,/g, ''))
  if (!Number.isFinite(n)) return undefined
  return negParen ? -Math.abs(n) : n
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Accepts ISO (`2025-08-27`), US slash/dash (`8/27/2025`, `08-27-25`), and
 * month-name forms (`Aug 27, 2025`, `27 Aug 2025`). Returns ISO `YYYY-MM-DD`.
 */
export function parseDate(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const s = raw.trim()
  if (!s) return undefined

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) return isoOrUndefined(+iso[1]!, +iso[2]!, +iso[3]!)

  const us = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s)
  if (us) {
    const yr = +us[3]!
    return isoOrUndefined(yr < 100 ? 2000 + yr : yr, +us[1]!, +us[2]!)
  }

  const named = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (named) {
    const m = MONTHS[named[1]!.slice(0, 3).toLowerCase()]
    if (m) return isoOrUndefined(+named[3]!, m, +named[2]!)
  }

  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(s)
  if (dayFirst) {
    const m = MONTHS[dayFirst[2]!.slice(0, 3).toLowerCase()]
    if (m) return isoOrUndefined(+dayFirst[3]!, m, +dayFirst[1]!)
  }

  return undefined
}

function isoOrUndefined(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  // Reject calendar-impossible dates (Feb 30) rather than rolling them over.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return undefined
  return `${y}-${pad(m)}-${pad(d)}`
}

/** `'6:00 PM'` -> `'18:00'`. `'18:00'` -> `'18:00'`. `'6PM'` -> `'18:00'`. */
export function parseTime(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const s = raw.trim()
  if (!s) return undefined

  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AaPp])\.?[Mm]?\.?$/.exec(s)
  if (m) {
    let h = +m[1]!
    const min = m[2] ? +m[2] : 0
    if (h < 1 || h > 12 || min > 59) return undefined
    const isPm = m[3]!.toLowerCase() === 'p'
    if (h === 12) h = 0
    return `${pad(isPm ? h + 12 : h)}:${pad(min)}`
  }

  const h24 = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (h24) {
    const h = +h24[1]!
    const min = +h24[2]!
    if (h > 23 || min > 59) return undefined
    return `${pad(h)}:${pad(min)}`
  }

  return undefined
}

/** Minutes between two `'HH:mm'` values, rolling past midnight. */
export function minutesBetween(start: string, end: string): number | undefined {
  const a = timeToMinutes(start)
  const b = timeToMinutes(end)
  if (a == null || b == null) return undefined
  return b >= a ? b - a : b + 24 * 60 - a
}

export function timeToMinutes(t: string | undefined): number | undefined {
  if (!t) return undefined
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return undefined
  return +m[1]! * 60 + +m[2]!
}

export function minutesToTime(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/**
 * Maps a source status string onto a canonical status via the profile's
 * vocabulary, falling back to substring heuristics so an unseen wording
 * ('Cancelled - Rain, paid') still classifies rather than landing in 'unknown'.
 */
export function parseStatus(
  raw: string | undefined,
  vocabulary: Record<string, GameStatus>,
): GameStatus {
  const s = (raw ?? '').trim()
  if (!s) return 'unknown'

  const exact = vocabulary[s] ?? vocabulary[s.toLowerCase()]
  if (exact) return exact

  const lower = s.toLowerCase()
  for (const [k, v] of Object.entries(vocabulary)) {
    if (lower === k.toLowerCase()) return v
  }

  if (/postpon|reschedul/.test(lower)) return 'postponed'
  if (/cancel/.test(lower)) {
    // "Not Paid" must win over the substring "Paid": otherwise
    // "Cancelled - Not Paid" is classified as a paid cancellation.
    if (/no\s*pay|unpaid|\bnp\b|not[\s-]*paid?/.test(lower)) return 'cancelled-nopay'
    if (/paid|pay/.test(lower)) return 'cancelled-paid'
    return 'cancelled-nopay'
  }
  if (/forfeit/.test(lower)) return 'cancelled-nopay'
  if (/active|accepted|assigned|confirm|played|complete/.test(lower)) return 'active'
  return 'unknown'
}

/**
 * Pulls a game duration out of an age-group string. Handles `/90min`,
 * `(75 min)`, `100min`, `90 minutes`, `1:45`.
 *
 * Guards against matching a group *name* number: `'ASA-Softball-12U-Rec'`
 * has no minutes token, and `'10U'` must not read as 10 minutes.
 */
export function extractDurationMinutes(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s) return undefined

  const mins = /(\d{2,3})\s*(?:min\b|mins\b|minutes\b|m\b)/i.exec(s)
  if (mins) {
    const n = +mins[1]!
    if (n >= 20 && n <= 300) return n
  }

  // 'H:MM' duration form, e.g. '1:45'. Only when clearly marked as a duration.
  const hm = /\b(\d):(\d{2})\s*(?:hr|hrs|hour|hours)?\b/i.exec(s)
  if (hm && /hr|hour|dur/i.test(s)) {
    const n = +hm[1]! * 60 + +hm[2]!
    if (n >= 20 && n <= 300) return n
  }

  return undefined
}

/**
 * Some sources pack two values into one notes cell with a separator. Splits a
 * leading URL out from the human note.
 */
export function splitNotes(
  raw: string | undefined,
  separator = ':::',
): { notes?: string; rulesUrl?: string } {
  const s = (raw ?? '').trim()
  if (!s) return {}

  const parts = s.split(separator).map((p) => p.trim()).filter(Boolean)
  const urls = parts.filter((p) => /^https?:\/\//i.test(p))
  const notes = parts.filter((p) => !/^https?:\/\//i.test(p))

  return {
    ...(urls.length ? { rulesUrl: urls[0] } : {}),
    ...(notes.length ? { notes: notes.join(' / ') } : {}),
  }
}

/**
 * Strips a rotating season suffix so `'Rivera (F25), Sam'` and
 * `'Rivera (S26), Sam'` normalize to the same string. Used for partner
 * identity grouping, not for display.
 */
export function normalizeOfficialName(raw: string): string {
  return raw
    .replace(/\((?:[FSWfsw]\d{2}|\d{2}[FSWfsw])\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
}

/** `'Rivera, Sam'` -> `'Sam Rivera'` for display. */
export function displayOfficialName(raw: string): string {
  const n = normalizeOfficialName(raw)
  const comma = n.indexOf(',')
  if (comma === -1) return n
  const last = n.slice(0, comma).trim()
  const first = n.slice(comma + 1).trim()
  return first ? `${first} ${last}` : last
}

/** Trims, collapses inner whitespace, and returns `undefined` for empty. */
export function cleanString(raw: string | undefined): string | undefined {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim()
  return s || undefined
}

/** A stable, order-dependent hash for synthetic dedupe keys. */
export function fingerprint(values: (string | undefined)[]): string {
  // A separator no field can contain, so ['ab','c'] and ['a','bc'] cannot collide.
  // Written as an escape rather than a literal control character: a raw NUL makes
  // the file read as binary to git and to every diff tool.
  const joined = values.map((v) => (v ?? '').trim().toLowerCase()).join('\u001f')
  // FNV-1a, 32-bit, widened with a second accumulator to cut collisions.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i)
    h1 = (h1 ^ c) >>> 0
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 + c) >>> 0
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
  }
  return `fp_${h1.toString(36)}${h2.toString(36)}`
}
