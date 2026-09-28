/**
 * The Excel reader and the RefTown format, end to end: a workbook built here in
 * RefTown's template shape is read, detected, mapped and checked.
 *
 * Workbooks are built in the test rather than committed, so the dates are raw
 * Excel serials with date formats — what a real export holds — and no binary
 * fixture has to be kept in step with the code.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { isExcelData, parseWorkbook } from './excel'
import { CONFIDENT_THRESHOLD, detectProfile, discoverOfficialColumns } from './detect'
import { mapRows } from './map'
import { assignrProfile, reftownProfile } from './profiles'
import { anomalyCodesFor } from '../derive/anomalies'
import type { Identity } from '../model/reference'

/** Days since Excel's epoch, 1899-12-30, for an ISO date. */
const serial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000

type Cell = string | number | { date: string } | { time: number } | null

/** A one-sheet workbook with Excel-typed date and time cells. */
function workbook(rows: Cell[][], opts: { sheet?: string; extraSheets?: string[] } = {}): XLSX.WorkBook {
  const sheet: XLSX.WorkSheet = {}
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v == null) return
      const ref = XLSX.utils.encode_cell({ r, c })
      if (typeof v === 'string') sheet[ref] = { t: 's', v }
      else if (typeof v === 'number') sheet[ref] = { t: 'n', v }
      else if ('date' in v) sheet[ref] = { t: 'n', v: serial(v.date), z: 'm/d/yyyy' }
      else sheet[ref] = { t: 'n', v: v.time, z: 'h:mm AM/PM' }
    }),
  )
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rows.length - 1, c: Math.max(...rows.map((r) => r.length)) - 1 },
  })
  const wb = XLSX.utils.book_new()
  for (const name of opts.extraSheets ?? []) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['not games']]), name)
  }
  XLSX.utils.book_append_sheet(wb, sheet, opts.sheet ?? 'Games')
  return wb
}

const bytes = (wb: XLSX.WorkBook, bookType: 'xlsx' | 'biff8') =>
  new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer)

// RefTown's standard import template, column for column, plus the export's GameID.
const TEMPLATE = [
  'Reference', 'Date', 'Time', 'Payor', 'Location', 'SubLocation', 'Home', 'Visitor',
  'Comment', 'Assignor-Notes', 'Count', 'Rating', 'League', 'Type', 'Level', 'Sport',
  'CrewType', 'Self-Assign', 'Link-Group',
]
const OFFICIALS_REPEATED = Array(10).fill('Official')
const OFFICIALS_NUMBERED = Array.from({ length: 10 }, (_, i) => `Official_${i + 1}`)

function templateRow(overrides: Partial<Record<string, Cell>> = {}): Cell[] {
  const base: Record<string, Cell> = {
    GameID: '100234',
    Date: { date: '2026-09-12' },
    Time: { time: 0.75 },
    Payor: 'Lakeview Youth Baseball',
    Location: 'Lakeview Park',
    SubLocation: 'Field 3',
    Home: 'Hawks',
    Visitor: 'Owls',
    League: 'Lakeview YB',
    Type: 'League',
    Level: '12U',
    Sport: 'Baseball',
    CrewType: '2 Umpire',
    ...overrides,
  }
  return ['GameID', ...TEMPLATE].map((h) => base[h] ?? null)
}

const IDENTITY: Identity = { id: 'self', patterns: ['^Rivera.*Sam$'], displayName: 'Sam Rivera' }

describe('the Excel reader', () => {
  it('reads dates and times from their serials, and numbers as text', async () => {
    const wb = workbook([
      ['Date', 'Time', 'Kickoff', 'Fee', 'Note'],
      [{ date: '2026-09-12' }, { time: 0.75 }, { time: 0.40625 }, 45, '  padded  '],
      [{ date: '2025-12-31' }, { time: 0 }, null, 52.5, ''],
    ])
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    expect(parsed.headers).toEqual(['Date', 'Time', 'Kickoff', 'Fee', 'Note'])
    expect(parsed.rows).toEqual([
      { Date: '2026-09-12', Time: '18:00', Kickoff: '09:45', Fee: '45', Note: 'padded' },
      { Date: '2025-12-31', Time: '00:00', Kickoff: '', Fee: '52.5', Note: '' },
    ])
  })

  it('reads a date-time cell as the date and the time together', async () => {
    const wb = workbook([['When'], [null]])
    wb.Sheets['Games']!['A2'] = { t: 'n', v: serial('2026-09-12') + 0.75, z: 'm/d/yyyy h:mm' }
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    expect(parsed.rows[0]!['When']).toBe('2026-09-12 18:00')
  })

  it('reads the legacy .xls format RefTown templates use', async () => {
    const wb = workbook([
      ['Date', 'Time'],
      [{ date: '2026-09-12' }, { time: 0.75 }],
    ])
    const data = bytes(wb, 'biff8')
    expect(isExcelData(data)).toBe(true)
    expect((await parseWorkbook(data)).rows).toEqual([{ Date: '2026-09-12', Time: '18:00' }])
  })

  it('prefers a sheet named Games, and says when there were others', async () => {
    const wb = workbook([['Date'], [{ date: '2026-09-12' }]], { extraSheets: ['Instructions'] })
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    expect(parsed.headers).toEqual(['Date'])
    expect(parsed.errors[0]).toMatch(/"Games" sheet/)
  })

  it('tells spreadsheets from text by their first bytes, not their name', () => {
    expect(isExcelData(bytes(workbook([['A'], ['1']]), 'xlsx'))).toBe(true)
    expect(isExcelData(new TextEncoder().encode('Date,Time\n2026-09-12,6:00 PM'))).toBe(false)
  })
})

describe('RefTown games', () => {
  it('pairs repeated Official headers in order, as the template has them', async () => {
    const wb = workbook([
      ['GameID', ...TEMPLATE, ...OFFICIALS_REPEATED],
      [...templateRow(), 'Rivera, Sam', 'Lee, Pat'],
    ])
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    const slots = discoverOfficialColumns(parsed.headers)
    expect(slots).toHaveLength(10)
    expect(slots.slice(0, 3).map((s) => s.official)).toEqual(['Official', 'Official (2)', 'Official (3)'])
  })

  it('is detected confidently from the template shape and the export shape', () => {
    for (const officials of [OFFICIALS_REPEATED, OFFICIALS_NUMBERED]) {
      const [best] = detectProfile(['GameID', ...TEMPLATE, ...officials])
      expect(best!.profile.id).toBe('reftown')
      expect(best!.confidence).toBeGreaterThanOrEqual(CONFIDENT_THRESHOLD)
    }
  })

  it('maps a row: active without a status column, fees unknown rather than zero', async () => {
    const wb = workbook([
      ['GameID', ...TEMPLATE, ...OFFICIALS_NUMBERED],
      [...templateRow(), 'Rivera, Sam', 'Lee, Pat'],
      [...templateRow({ GameID: '100235', Time: { time: 0.8125 } }), 'Lee, Pat', 'Rivera, Sam'],
    ])
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    const { games, skipped } = mapRows(parsed.rows, {
      profile: reftownProfile,
      identity: IDENTITY,
      importId: 'test',
      importedAt: '2026-09-28T00:00:00.000Z',
      headers: parsed.headers,
      currency: 'USD',
    })
    expect(skipped).toEqual([])
    expect(games).toHaveLength(2)

    const [first, second] = games
    expect(first).toMatchObject({
      date: '2026-09-12',
      startTime: '18:00',
      status: 'active',
      venueRaw: 'Lakeview Park',
      subVenueRaw: 'Field 3',
      ageGroupRaw: '12U',
      league: 'Lakeview YB',
      pattern: '2 Umpire',
      homeTeam: 'Hawks',
      awayTeam: 'Owls',
      fees: { notInSource: true, currency: 'USD' },
    })
    expect(first!.source.dedupeKey).toBe('reftown:100234')
    expect(second!.startTime).toBe('19:30')
    // Officials fill the crew in order; the self match finds either slot.
    expect(first!.assignments.map((a) => [a.official, a.isSelf])).toEqual([
      ['Rivera, Sam', true],
      ['Lee, Pat', false],
    ])
    expect(second!.assignments.find((a) => a.isSelf)?.official).toBe('Rivera, Sam')
    // No status column and no fee column are the format, not problems per game.
    for (const g of games) {
      expect(g.flags.map((f) => f.code)).not.toContain('unrecognised-status')
      expect(anomalyCodesFor(g)).toEqual([])
    }
  })

  it('reads a status column when the file has one', async () => {
    const wb = workbook([
      ['GameID', 'Date', 'Time', 'Location', 'Level', 'Status', 'Official_1'],
      ['1', { date: '2026-09-12' }, { time: 0.75 }, 'Lakeview Park', '12U', 'Canceled', 'Rivera, Sam'],
      ['2', { date: '2026-09-13' }, { time: 0.75 }, 'Lakeview Park', '12U', '', 'Rivera, Sam'],
    ])
    const parsed = await parseWorkbook(bytes(wb, 'xlsx'))
    const { games } = mapRows(parsed.rows, {
      profile: reftownProfile,
      identity: IDENTITY,
      importId: 'test',
      importedAt: '2026-09-28T00:00:00.000Z',
      headers: parsed.headers,
      currency: 'USD',
    })
    expect(games[0]!.status).toBe('cancelled-nopay')
    // The column exists, so a blank is a gap in the data, not the format's default.
    expect(games[1]!.status).toBe('unknown')
  })

  it('leaves formats that do carry fees exactly as they were', () => {
    const headers = [...assignrProfile.fingerprint]
    const row = Object.fromEntries(headers.map((h) => [h, '']))
    Object.assign(row, {
      Date: '9/12/2026',
      'Start Time': '6:00 PM',
      Status: 'Active',
      'Assignr Database ID': '9',
      'Default Fee': '45',
      'Actual Fee': '45',
    })
    const { games } = mapRows([row], {
      profile: assignrProfile,
      identity: IDENTITY,
      importId: 'test',
      importedAt: '2026-09-28T00:00:00.000Z',
      headers,
      currency: 'USD',
    })
    expect(games[0]!.fees).toEqual({ scheduled: 45, actual: 45, currency: 'USD' })
  })
})
