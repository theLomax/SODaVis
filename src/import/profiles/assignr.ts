import type { SourceProfile } from './types'

/**
 * Assignr game export.
 *
 * Two quirks worth naming, both observed in the sample export:
 *  - `Gender` is not gender, it is the sport code ('C-BB', 'C-FP', 'C-SP',
 *    'C-KB'). It is mapped to `sportCode` accordingly.
 *  - The file ends with a `TOTALS:` trailer row whose 'Default Fee' is the
 *    column sum. Left in, it becomes a phantom game worth the column total.
 */
export const assignrProfile: SourceProfile = {
  id: 'assignr',
  label: 'Assignr - game export (CSV)',
  fingerprint: [
    'Game ID',
    'Date',
    'Start Time',
    'Venue',
    'Sub-Venue',
    'Age Group',
    'Status',
    'Published',
    'Zone',
    'League',
    'Gender',
    'Game Type',
    'Home Team',
    'Away Team',
    'Pattern',
    'Payor',
    'Paid Via',
    'Assignor',
    'Notes',
    'Assignor Notes',
    'Assignr Database ID',
    'Default Fee',
    'Actual Fee',
    'Travel Fee',
    'Position 1',
    'Official 1',
    'Position 2',
    'Official 2',
  ],
  fieldMap: {
    sourceId: 'Assignr Database ID',
    date: 'Date',
    startTime: 'Start Time',
    venueRaw: 'Venue',
    subVenueRaw: 'Sub-Venue',
    ageGroupRaw: 'Age Group',
    status: 'Status',
    league: 'League',
    sportCode: 'Gender',
    gameType: 'Game Type',
    homeTeam: 'Home Team',
    awayTeam: 'Away Team',
    pattern: 'Pattern',
    payor: 'Payor',
    paidVia: 'Paid Via',
    assignor: 'Assignor',
    notes: 'Notes',
    feeScheduled: 'Default Fee',
    feeActual: 'Actual Fee',
    feeTravel: 'Travel Fee',
  },
  statusVocabulary: {
    Active: 'active',
    'Cancelled - No Pay': 'cancelled-nopay',
    'Cancelled - Pay': 'cancelled-paid',
    'Cancelled - Paid': 'cancelled-paid',
    Postponed: 'postponed',
    Rescheduled: 'postponed',
  },
  officialColumns: 'auto',
  dedupe: { strategy: 'natural', column: 'Assignr Database ID' },
  isDataRow: (row) => {
    // A row with no date carries no game.
    if (!(row['Date'] ?? '').trim()) return false
    // The export's totals trailer puts the literal 'TOTALS:' in the id column.
    const id = (row['Assignr Database ID'] ?? '').trim()
    if (!id || /^totals?:?$/i.test(id)) return false
    return true
  },
  notesSeparator: ':::',
}
