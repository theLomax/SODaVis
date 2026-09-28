import type { SourceProfile } from './types'
import { genericProfile } from './generic'

/**
 * RefTown games export (Schedules → Games → Quick Links → Export → Export to
 * Excel), an `.xlsx` named `games_<timestamp>`.
 *
 * Built from RefTown's own public import templates, since the export can be
 * edited and imported back and so shares their columns:
 * https://www.reftown.com/common/templates/game_import_template.xls
 * The export adds `GameID` and numbers its officials `Official_1`, `Official_2`…
 * (RefTown KB #237 and #267). No real export has been checked yet, so this is the
 * template's shape, not a confirmed one.
 *
 * Three things the template does not have, and how each is handled:
 *  - No status column: every row is taken as active (`defaultStatus`). If the
 *    export turns out to carry one, `Status` is mapped and wins.
 *  - No fee columns: games are marked `fees.notInSource`, so pay reads as
 *    unknown rather than $0 and no fee anomaly is raised for each one.
 *  - No position column: officials fill the crew duties in order, so a slot's
 *    position is left blank rather than guessed.
 */
export const reftownProfile: SourceProfile = {
  id: 'reftown',
  label: 'RefTown - games export (Excel)',
  platform: 'RefTown',
  fileTypes: ['excel', 'csv'],
  exportSteps: [
    'In RefTown, go to Schedules → Games.',
    'Search for the games you want, such as a date range.',
    'Open Quick Links → Export → Export to Excel. The file is named games_ followed by the date and time.',
  ],
  // The standard template's columns, plus the export's GameID. Official columns
  // are left out: detection ignores them, since their count follows the crew.
  fingerprint: [
    'GameID',
    'Reference',
    'Date',
    'Time',
    'Payor',
    'Location',
    'SubLocation',
    'Home',
    'Visitor',
    'Comment',
    'Assignor-Notes',
    'Count',
    'Rating',
    'League',
    'Type',
    'Level',
    'Sport',
    'CrewType',
    'Self-Assign',
    'Link-Group',
  ],
  fieldMap: {
    sourceId: 'GameID',
    date: 'Date',
    startTime: 'Time',
    venueRaw: 'Location',
    subVenueRaw: 'SubLocation',
    ageGroupRaw: 'Level',
    status: 'Status',
    league: 'League',
    sportCode: 'Sport',
    gameType: 'Type',
    homeTeam: 'Home',
    awayTeam: 'Visitor',
    pattern: 'CrewType',
    payor: 'Payor',
    notes: 'Comment',
  },
  statusVocabulary: {
    ...genericProfile.statusVocabulary,
    Scheduled: 'active',
    Final: 'active',
    Rescheduled: 'postponed',
  },
  defaultStatus: 'active',
  officialColumns: 'auto',
  dedupe: { strategy: 'natural', column: 'GameID' },
  isDataRow: (row) => Boolean((row['Date'] ?? '').trim()),
}
