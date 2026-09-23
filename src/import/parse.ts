/**
 * PapaParse wrapper. Tolerant of the two things real exports do that a strict
 * parser rejects: ragged rows (a solo game omits its trailing Position/Official
 * columns) and trailer rows (a `TOTALS:` sum line).
 */

import Papa from 'papaparse'

export type ParsedFile = {
  headers: string[]
  /** One object per line, keyed by header. Missing trailing cells become ''. */
  rows: Record<string, string>[]
  /** Field counts seen, for reporting raggedness. */
  fieldCounts: Record<number, number>
  errors: string[]
}

export function parseDelimited(text: string): ParsedFile {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    // Ragged rows are expected, so do not let Papa normalize or complain.
    dynamicTyping: false,
    transform: (v) => v,
  })

  const errors = (result.errors ?? [])
    // A short row is not an error here; it is the shape of the data.
    .filter((e) => e.code !== 'TooFewFields' && e.code !== 'TooManyFields')
    .map((e) => `row ${e.row ?? '?'}: ${e.message}`)

  const table = (result.data ?? []).filter(
    (r) => Array.isArray(r) && r.some((c) => (c ?? '').trim() !== ''),
  )

  if (table.length === 0) {
    return { headers: [], rows: [], fieldCounts: {}, errors }
  }

  const headers = dedupeHeaders((table[0] ?? []).map((h) => (h ?? '').trim()))

  const fieldCounts: Record<number, number> = {}
  const rows: Record<string, string>[] = []

  for (const line of table.slice(1)) {
    fieldCounts[line.length] = (fieldCounts[line.length] ?? 0) + 1
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = (line[i] ?? '').trim()
    })
    rows.push(row)
  }

  return { headers, rows, fieldCounts, errors }
}

/** Blank or repeated headers get a positional suffix so no column is lost. */
function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h, i) => {
    const base = h || `Column ${i + 1}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base} (${n + 1})`
  })
}

export async function readFileAsText(file: File): Promise<string> {
  const text = await file.text()
  // Strip a UTF-8 BOM; it would otherwise poison the first header name.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
