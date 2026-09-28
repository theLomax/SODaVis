/**
 * Excel reader, for `.xlsx` and legacy `.xls`. RefTown's games export is an
 * `.xlsx` and its import templates are `.xls`, so a text-only importer could not
 * read either.
 *
 * The workbook becomes the same grid of strings the CSV path produces, and from
 * there `parseTable` takes over — detection, mapping and reconciling never know
 * the file was a spreadsheet.
 *
 * SheetJS is loaded only when an Excel file is actually picked: it is large, and
 * most imports are CSV.
 */

import type { ParsedFile } from './parse'
import { parseTable } from './parse'

/** True for the zip container of `.xlsx`/`.xlsm` and the OLE container of `.xls`. */
export function isExcelData(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const ole =
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1
  return zip || ole
}

const pad = (n: number) => String(n).padStart(2, '0')

export async function parseWorkbook(data: ArrayBuffer | Uint8Array): Promise<ParsedFile> {
  const XLSX = await import('xlsx')
  // `cellNF` keeps each cell's number format, which is the only thing that says
  // whether 46277 is a count, a fee, or a date.
  const wb = XLSX.read(data, { type: 'array', cellNF: true, cellDates: false })

  // RefTown names its sheet "Games"; otherwise the first sheet is the data.
  const sheetName = wb.SheetNames.find((n) => /^games?$/i.test(n.trim())) ?? wb.SheetNames[0]
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined
  if (!sheet || !sheet['!ref']) {
    return { headers: [], rows: [], fieldCounts: {}, errors: ['The workbook has no sheet with data.'] }
  }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid: string[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
        | { t: string; v?: unknown; z?: string | number; w?: string }
        | undefined
      line.push(cell ? cellText(cell, XLSX.SSF) : '')
    }
    grid.push(line)
  }

  const errors =
    wb.SheetNames.length > 1 ? [`Read the "${sheetName}" sheet; the workbook has ${wb.SheetNames.length}.`] : []
  return parseTable(grid, errors)
}

type Ssf = {
  is_date: (fmt: string | number) => boolean
  parse_date_code: (v: number) => { y: number; m: number; d: number; H: number; M: number; S: number }
}

/**
 * One cell as the text a CSV would have held. Dates and times come back in the
 * forms `parseDate` and `parseTime` already read: `YYYY-MM-DD`, `HH:mm`, or both.
 * `parse_date_code` works on the serial number itself, so no timezone can move a
 * game to the day before.
 */
function cellText(cell: { t: string; v?: unknown; z?: string | number; w?: string }, ssf: Ssf): string {
  if (cell.v == null) return ''
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE'
  if (cell.t === 'e') return ''
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const v = cell.v
    if (cell.z != null && ssf.is_date(cell.z)) {
      const d = ssf.parse_date_code(v)
      const time = `${pad(d.H)}:${pad(d.M)}`
      // A serial below 1 has no date part: a time-of-day cell.
      if (v < 1) return time
      const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`
      return Number.isInteger(v) ? date : `${date} ${time}`
    }
    return String(v)
  }
  return String(cell.v).trim()
}
