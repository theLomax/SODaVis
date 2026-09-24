/**
 * Data quality. Every flag the pipeline raised, grouped by kind, with the fix one
 * click away where a fix is mechanical.
 *
 * The premise: a number the app is unsure about should say so rather than quietly
 * being wrong. This view is where those admissions collect — and every row that can
 * be fixed in the app carries a button to the field that fixes it, focused on the
 * park, age group or trip the row is about.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Card, EmptyState, StatusChip } from '../components/Tiles'
import { severityStatus } from '../charts/palette'
import type { DataQualityFlagCode } from '../../model/game'
import { isCancelled } from '../../model/game'
import { formatMoney } from '../../derive/money'
import type { ResolvedGame } from '../../derive/resolve'
import { orphanedTripAnnotations, type Trip } from '../../derive/trips'
import {
  acknowledgeAnomaly,
  deleteTripAnnotation,
  patchGameAnnotation,
  reattachTripAnnotation,
} from '../../db/repo'
import {
  CANCEL_STAGES,
  FEE_ANOMALIES,
  parseTripKey,
  type CancelStage,
  type TripAnnotation,
} from '../../model/annotation'
import { feeAnomalies, groupAnomalies, type FeeAnomaly } from '../../derive/anomalies'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { FlagDialog } from '../components/FlagDialog'
import { flagGroupTitle, flagInfo, flagMarker } from '../flags'
import type { NavTarget } from '../store'

type Row = {
  code: DataQualityFlagCode
  severity: 'info' | 'warning' | 'serious'
  message: string
  context: string
  where: string
  /**
   * Where this particular row is fixed. The group's registry entry names the view
   * and tab; the row adds the id, so the button lands on this park, this age group
   * or this trip rather than the top of a long table.
   */
  target?: NavTarget
}

type FlagGroup = { code: DataQualityFlagCode; items: Row[]; severity: Row['severity'] }

export function DataQuality() {
  const { derived, navigate } = useStore()
  const [hideInfo, setHideInfo] = useState(true)
  /** The flag group open in the dialog. */
  const [reviewing, setReviewing] = useState<FlagGroup | null>(null)

  const rows = useMemo<Row[]>(() => {
    if (!derived) return []
    const out: Row[] = []

    for (const r of derived.allResolved) {
      for (const f of r.flags) {
        const target = gameFixTarget(f.code, r)
        out.push({
          code: f.code,
          severity: f.severity,
          message: f.message,
          context: f.context ?? '',
          where: `${r.game.date} ${r.game.startTime} · ${r.game.venueRaw}`,
          ...(target ? { target } : {}),
        })
      }
    }
    for (const t of derived.trips) {
      for (const f of t.flags) {
        const target = tripFixTarget(f.code, t)
        out.push({
          code: f.code,
          severity: f.severity,
          message: f.message,
          context: f.context ?? '',
          where: `${t.date} · ${t.parkName} (trip)`,
          ...(target ? { target } : {}),
        })
      }
    }
    return out
  }, [derived])

  const grouped = useMemo(() => {
    const byCode = new Map<DataQualityFlagCode, Row[]>()
    for (const row of rows) {
      const bucket = byCode.get(row.code)
      if (bucket) bucket.push(row)
      else byCode.set(row.code, [row])
    }
    const order: Record<string, number> = { serious: 0, warning: 1, info: 2 }
    return [...byCode.entries()]
      .map(([code, items]) => ({ code, items, severity: items[0]!.severity }))
      .filter((g) => !(hideInfo && g.severity === 'info'))
      .sort((a, b) => order[a.severity]! - order[b.severity]! || b.items.length - a.items.length)
  }, [rows, hideInfo])

  if (!derived) return null

  const serious = rows.filter((r) => r.severity === 'serious').length
  const warnings = rows.filter((r) => r.severity === 'warning').length

  const orphans = orphanedTripAnnotations(
    derived.snapshot.tripAnnotations,
    derived.snapshot.parks,
  )

  if (rows.length === 0 && orphans.length === 0) {
    return (
      <EmptyState
        title="Nothing to flag"
        body="Every game resolved to a park, every age group has a duration, and every crew matches its stated pattern."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {rows.length} flags across {derived.allResolved.length} games and {derived.trips.length} trips
        </span>
        {serious > 0 ? <StatusChip role="serious" label={`${serious} serious`} /> : null}
        {warnings > 0 ? <StatusChip role="warning" label={`${warnings} warnings`} /> : null}
        <label className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={hideInfo} onChange={(e) => setHideInfo(e.target.checked)} />
          Hide informational flags
        </label>
      </div>

      {grouped.map((group) => (
        <Card
          key={group.code}
          title={flagGroupTitle(group.code, group.items.length)}
          subtitle={flagInfo(group.code).what}
          action={
            <StatusChip
              role={severityStatus(group.severity)}
              marker={flagMarker(group.severity)}
              label="What to do"
              onClick={() => setReviewing(group)}
              opensDialog
              title="Open for detail and the fix"
            />
          }
        >
          <div className="overflow-auto" style={{ maxHeight: 320 }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {['Where', 'Detail', ''].map((h, i) => (
                    <th
                      key={h || `sp-${i}`}
                      scope="col"
                      className="sticky top-0 px-2 py-1.5 text-left font-medium"
                      style={{
                        color: 'var(--text-secondary)',
                        background: 'var(--surface-1)',
                        borderBottom: '1px solid var(--gridline)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dedupeByContext(group.items).map((row, i) => (
                  <tr key={`${row.where}-${i}`} style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                      {row.where}
                      {row.count > 1 ? (
                        <span style={{ color: 'var(--text-muted)' }}> +{row.count - 1} more</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {row.message}
                    </td>
                    {/* The fix, on the row that needs it — not a path to read and
                        follow by hand. */}
                    <td className="px-2 py-1.5 text-right">
                      {row.target ? (
                        <button
                          type="button"
                          onClick={() => navigate(row.target!)}
                          className="rounded-md px-2 py-0.5 text-xs whitespace-nowrap"
                          style={{
                            color: 'var(--text-primary)',
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border-hairline)',
                          }}
                        >
                          Fix this
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <OrphanedTripAnnotations orphans={orphans} />

      <CancelledDrives />

      <UntaggedSports />

      <FeeAnomalies />

      {/* One representative flag stands for the group: every row in it shares a
          code, so the explanation and the fix are the same for all of them. */}
      {reviewing ? (
        <FlagDialog
          open
          onClose={() => setReviewing(null)}
          subject={flagInfo(reviewing.code).groupTitle}
          subjectDetail={`${reviewing.items.length} occurrence${
            reviewing.items.length === 1 ? '' : 's'
          }`}
          flags={[
            {
              code: reviewing.code,
              severity: reviewing.severity,
              message:
                reviewing.items.length === 1
                  ? reviewing.items[0]!.message
                  : `First of ${reviewing.items.length}: ${reviewing.items[0]!.message}`,
            },
          ]}
        />
      ) : null}
    </div>
  )
}

/**
 * Where a game-level flag is fixed, with the id of the thing to fix.
 *
 * The registry supplies the view and the tab; only the row knows which park or
 * age group it is about, so the two are combined here rather than in the registry.
 * A flag whose fix is at the source, not in the app, gets no button.
 */
function gameFixTarget(code: DataQualityFlagCode, r: ResolvedGame): NavTarget | undefined {
  const base = flagInfo(code).fixTarget
  if (!base) return undefined
  if (base.view === 'reference' && base.tab === 'durations') {
    return { ...base, focus: r.game.ageGroupRaw }
  }
  if (base.view === 'reference' && base.tab === 'parks' && r.parkId) {
    return { ...base, focus: r.parkId }
  }
  return base
}

/** The same for a trip-level flag: mileage and drive time are the park's figures. */
function tripFixTarget(code: DataQualityFlagCode, trip: Trip): NavTarget | undefined {
  const base = flagInfo(code).fixTarget
  if (!base) return undefined
  if (base.view === 'reference' && base.tab === 'parks') return { ...base, focus: trip.parkId }
  if (base.view === 'trips') return { ...base, focus: trip.key }
  return base
}

/**
 * Collapses repeats of the same context (one row per age group rather than one
 * per game), so a 60-game duration gap does not fill the panel.
 */
function dedupeByContext(items: Row[]): (Row & { count: number })[] {
  const byContext = new Map<string, Row & { count: number }>()
  for (const item of items) {
    const key = item.context || item.where
    const existing = byContext.get(key)
    if (existing) existing.count++
    else byContext.set(key, { ...item, count: 1 })
  }
  return [...byContext.values()].sort((a, b) => b.count - a.count)
}

/**
 * Games the source left without a sport, with the tag control inline — the panel
 * that reports the gap is the natural place to close it.
 */
function UntaggedSports() {
  const { derived, reload } = useStore()
  const [saving, setSaving] = useState<string | null>(null)

  if (!derived) return null
  const untagged = derived.allResolved.filter((r) => !r.sportCode)
  const tagged = derived.allResolved.filter((r) => r.sportCodeIsManual)

  if (untagged.length === 0 && tagged.length === 0) return null

  async function tag(r: (typeof untagged)[number], code: string) {
    const key = r.game.source.dedupeKey
    setSaving(key)
    try {
      await patchGameAnnotation(key, { sportCodeOverride: code || undefined })
      await reload()
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card
      title={`Sport tagging (${untagged.length} untagged)`}
      subtitle="The source left these blank. A tag here fixes the sport breakdown, and prep and wrap time, without touching the imported row."
    >
      {untagged.length > 0 ? (
        <div className="overflow-auto" style={{ maxHeight: 320 }}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Date', 'Venue', 'Age group', 'League', 'Sport'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="sticky top-0 px-2 py-1.5 text-left font-medium"
                    style={{
                      color: 'var(--text-secondary)',
                      background: 'var(--surface-1)',
                      borderBottom: '1px solid var(--gridline)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {untagged.map((r) => (
                <tr
                  key={r.game.id}
                  style={{ borderBottom: '1px solid var(--gridline)' }}
                >
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {r.game.date}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {r.game.venueRaw}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {r.game.ageGroupRaw}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {r.game.league ?? '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value=""
                      disabled={saving === r.game.source.dedupeKey}
                      onChange={(e) => void tag(r, e.target.value)}
                      // Start time included because two games at one venue on one
                      // date is the norm, not the exception: without it, several
                      // rows share a name and a screen reader cannot tell them
                      // apart. The status says which rows move money when tagged.
                      aria-label={`Sport for the ${
                        isCancelled(r.game.status) ? 'cancelled ' : ''
                      }game at ${r.game.venueRaw} on ${r.game.date} at ${r.game.startTime}`}
                      className="rounded-md px-1.5 py-0.5 text-xs"
                      style={selectStyle}
                    >
                      <option value="">Tag as…</option>
                      {derived.snapshot.sports.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
          Every game has a sport.
        </p>
      )}

      {tagged.length > 0 ? (
        <p className="m-0 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {tagged.length} game{tagged.length === 1 ? '' : 's'} tagged by hand. Those tags are keyed
          to the game, so a re-import keeps them.
        </p>
      ) : null}
    </Card>
  )
}

/** Fee anomalies are worth their own panel: they are money, not metadata. */
/**
 * Fee anomalies, each of which can be accepted rather than merely reported.
 *
 * The rule is surface, never override — so accepting one does not change the fee,
 * the status, or the metrics, and does not remove the row. It records that the
 * oddity has been looked at and found correct, with room to say why, and the panel
 * then counts it as settled instead of outstanding. A known-good oddity that
 * disappeared would be indistinguishable from one nobody had examined.
 *
 * Some of these really are correct: a rainout paid at half rate is genuinely a paid
 * cancellation, and without a way to say so the panel would report it forever.
 */
function FeeAnomalies() {
  const { derived, reload } = useStore()
  const [saving, setSaving] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const groups = useMemo(() => {
    if (!derived) return []
    const annotations = new Map(
      derived.snapshot.gameAnnotations.map((a) => [a.dedupeKey, a]),
    )
    return groupAnomalies(feeAnomalies(derived.resolved.map((r) => r.game), annotations))
  }, [derived])

  if (!derived || groups.length === 0) return null

  const currency = derived.money.currency
  const outstanding = groups.reduce((n, g) => n + g.outstanding, 0)
  const settled = groups.reduce((n, g) => n + g.acknowledged, 0)

  /** Row identity for the pending-note state: one anomaly is a game plus a code. */
  const rowId = (a: FeeAnomaly) => `${a.game.source.dedupeKey}|${a.code}`

  async function accept(a: FeeAnomaly, note: string | undefined) {
    const id = rowId(a)
    setSaving(id)
    try {
      await acknowledgeAnomaly(a.game.source.dedupeKey, a.code, true, note)
      await reload()
      setNoteFor(null)
      setNoteText('')
    } finally {
      setSaving(null)
    }
  }

  async function reopen(a: FeeAnomaly) {
    const id = rowId(a)
    setSaving(id)
    try {
      await acknowledgeAnomaly(a.game.source.dedupeKey, a.code, false, undefined)
      await reload()
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card
      title={`Fee anomalies (${outstanding} to review)`}
      subtitle={
        settled > 0
          ? `Where money and status disagree. ${settled} accepted as correct — still listed, because an accepted oddity that vanished could not be told from one nobody looked at.`
          : 'Where money and status disagree. Accepting one records that you checked it; it never changes the figure.'
      }
    >
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const meta = FEE_ANOMALIES.find((f) => f.code === group.code)!
          return (
            <div key={group.code} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {/* Only the outstanding count warrants a warning: a group that has
                    been fully accepted is not work to do, and marking it as such
                    would teach the reader to ignore this panel. */}
                <StatusChip
                  role={group.outstanding > 0 ? severityStatus('warning') : 'good'}
                  label={group.outstanding > 0 ? String(group.outstanding) : 'all reviewed'}
                />
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {meta.label}
                </span>
                {group.acknowledged > 0 && group.outstanding > 0 ? (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {group.acknowledged} accepted
                  </span>
                ) : null}
              </div>
              <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                {meta.note} {meta.acknowledgeHint}
              </p>

              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {group.items.map((a) => {
                  const id = rowId(a)
                  const busy = saving === id
                  return (
                    <li key={id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {a.game.date} · {a.game.venueRaw} · scheduled{' '}
                          {formatMoney(a.scheduled, currency)}, actual{' '}
                          {formatMoney(a.actual, currency)}
                        </span>

                        {a.acknowledged ? (
                          <>
                            <StatusChip role="good" label="accepted" />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void reopen(a)}
                              className="rounded-md px-2 py-0.5 text-xs"
                              style={{
                                color: 'var(--text-secondary)',
                                background: 'var(--surface-1)',
                                border: '1px solid var(--border-hairline)',
                              }}
                            >
                              Reopen
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setNoteFor(noteFor === id ? null : id)
                              setNoteText('')
                            }}
                            aria-expanded={noteFor === id}
                            className="rounded-md px-2 py-0.5 text-xs"
                            style={{
                              color: 'var(--text-primary)',
                              background: 'var(--surface-1)',
                              border: '1px solid var(--border-hairline)',
                            }}
                          >
                            Accept as correct
                          </button>
                        )}
                      </div>

                      {a.note ? (
                        <p
                          className="m-0 pl-1 text-xs"
                          style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}
                        >
                          {a.note}
                        </p>
                      ) : null}

                      {/* The reason is optional: an acknowledgement without one is
                          still an acknowledgement, so Accept is reachable either way. */}
                      {noteFor === id ? (
                        <div className="flex flex-wrap items-center gap-2 pl-1">
                          <TextInput
                            value={noteText}
                            onChange={setNoteText}
                            placeholder="Why is this correct? (optional)"
                            width={280}
                            ariaLabel={`Reason the ${a.code} on ${a.game.date} is correct`}
                          />
                          <Button
                            onClick={() => void accept(a, noteText)}
                            disabled={busy}
                            variant="primary"
                          >
                            {busy ? 'Saving…' : 'Accept'}
                          </Button>
                          <button
                            type="button"
                            onClick={() => setNoteFor(null)}
                            className="text-xs"
                            style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/**
 * Cancellations that may have cost a drive.
 *
 * A cancelled game earns nothing and takes no game time, so it never affects
 * income or rate. But the drive may have happened anyway, and the export cannot
 * say: it records that a game was cancelled, not how far into the commitment it
 * was called. Only the official knows.
 *
 * So this panel asks, one would-be trip at a time — a single drive covers every
 * game at one park on one day, which is the unit a ruling applies to. Until it is
 * answered the mileage stays uncounted, because inventing a journey is the same
 * class of error as inventing a distance.
 */
function CancelledDrives() {
  const { derived, reload } = useStore()
  const [saving, setSaving] = useState<string | null>(null)

  /** Would-be trips: cancellations grouped by the drive they'd have shared. */
  const groups = useMemo(() => {
    if (!derived) return []
    const byTrip = new Map<
      string,
      { date: string; parkName: string; parkId: string | null; games: ResolvedGame[] }
    >()
    for (const r of derived.cancelled) {
      const parkId = r.parkId
      const key = `${r.game.date}|${parkId ?? r.game.venueRaw}`
      const park =
        (parkId ? derived.snapshot.parks.find((p) => p.id === parkId)?.name : null) ??
        r.game.venueRaw
      const existing = byTrip.get(key)
      if (existing) existing.games.push(r)
      else byTrip.set(key, { date: r.game.date, parkName: park, parkId, games: [r] })
    }
    return [...byTrip.entries()]
      .map(([key, g]) => {
        // A day when a game at this park was actually worked already counts the
        // drive, so a ruling here would double it. Tested on played games rather
        // than on the trip's existence: confirming a wasted drive *creates* a
        // trip, and matching that would both mislabel the row and hide the
        // control that undoes it.
        const coveredByActive = derived.trips.some(
          (t) =>
            t.date === g.date &&
            t.parkId === g.parkId &&
            t.games.some((tg) => !isCancelled(tg.game.status)),
        )
        const first = g.games[0]!
        return {
          key,
          ...g,
          coveredByActive,
          stage: first.cancelStage,
          drove: first.droveToCancelled,
          weather: first.weatherRelated,
          forfeited: g.games.reduce(
            (sum, r) => sum + Math.max((r.game.fees.scheduled ?? 0) - (r.game.fees.actual ?? 0), 0),
            0,
          ),
          estimatedMiles: g.parkId
            ? (derived.snapshot.parks.find((p) => p.id === g.parkId)?.oneWayMiles ?? null)
            : null,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [derived])

  if (!derived || groups.length === 0) return null

  // Unanswered means nothing has been said either way. Ticking the drive box is
  // an answer on its own — the stage is extra detail, not a prerequisite — so it
  // clears the question without forcing a second choice.
  const unanswered = groups.filter(
    (g) => !g.coveredByActive && g.stage == null && g.drove == null,
  )
  const counted = groups.filter((g) => g.drove === true)

  /** Applies a ruling to every cancelled game sharing the drive. */
  async function rule(
    group: (typeof groups)[number],
    patch: { cancelStage?: CancelStage; droveToCancelled?: boolean; weatherRelated?: boolean },
  ) {
    setSaving(group.key)
    try {
      for (const r of group.games) {
        await patchGameAnnotation(r.game.source.dedupeKey, patch)
      }
      await reload()
    } finally {
      setSaving(null)
    }
  }

  const currency = derived.money.currency
  const th = 'sticky top-0 px-2 py-1.5 text-left font-medium'
  const thStyle = {
    color: 'var(--text-secondary)',
    background: 'var(--surface-1)',
    borderBottom: '1px solid var(--gridline)',
  }

  return (
    <Card
      title={`Cancelled games — did you drive? (${unanswered.length} unanswered)`}
      subtitle="A cancellation still earns nothing, but the drive may have happened. Mileage is only counted once you say it did, so these are asked rather than assumed."
    >
      <div className="overflow-auto" style={{ maxHeight: 360 }}>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Date', 'Park', 'Games', 'Forfeited', 'Called', 'Drive', 'Weather'].map((h) => (
                <th key={h} scope="col" className={th} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} style={{ borderBottom: '1px solid var(--gridline)' }}>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                  {g.date}
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {g.parkName}
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {g.games.length}
                </td>
                <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {formatMoney(g.forfeited, currency)}
                </td>

                {g.coveredByActive ? (
                  <td
                    className="px-2 py-1.5"
                    colSpan={3}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Already counted — you worked another game at this park that day.
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-1.5">
                      <select
                        value={g.stage ?? ''}
                        disabled={saving === g.key}
                        onChange={(e) =>
                          void rule(g, {
                            cancelStage: (e.target.value || undefined) as CancelStage | undefined,
                            // "Before I left" settles the drive question too.
                            ...(e.target.value === 'before-travel'
                              ? { droveToCancelled: false }
                              : {}),
                          })
                        }
                        aria-label={`When the game at ${g.parkName} on ${g.date} was called`}
                        className="rounded-md px-1.5 py-0.5 text-xs"
                        style={selectStyle}
                      >
                        <option value="">Not said…</option>
                        {CANCEL_STAGES.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={g.drove === true}
                          disabled={saving === g.key}
                          onChange={(e) => void rule(g, { droveToCancelled: e.target.checked })}
                          aria-label={`Drove to ${g.parkName} on ${g.date}`}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>
                          {g.drove === true
                            ? g.estimatedMiles != null
                              ? `${(g.estimatedMiles * 2).toFixed(1)} mi counted`
                              : 'no mileage on file'
                            : 'I drove'}
                        </span>
                      </label>
                    </td>
                    <td className="px-2 py-1.5">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={g.weather === true}
                          disabled={saving === g.key}
                          onChange={(e) => void rule(g, { weatherRelated: e.target.checked })}
                          aria-label={`Weather or field conditions caused the cancellation at ${g.parkName} on ${g.date}`}
                        />
                        <span style={{ color: 'var(--text-muted)' }}>Weather</span>
                      </label>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="m-0 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {counted.length > 0
          ? `${counted.length} wasted drive${counted.length === 1 ? '' : 's'} now counted toward mileage and the tax view. `
          : ''}
        Rulings are keyed to the game, so a re-import keeps them.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Orphaned trip annotations
// ---------------------------------------------------------------------------

/** What an orphaned annotation still holds, so discarding it is an informed act. */
function describeTripAnnotation(a: TripAnnotation, currency: string): string {
  const parts: string[] = []
  if (a.milesOverride != null) parts.push(`${a.milesOverride} mi`)
  if (a.tollsOverride != null) parts.push(`tolls ${formatMoney(a.tollsOverride, currency)}`)
  if (a.driveMinutesOverride != null) parts.push(`drive ${a.driveMinutesOverride} min`)
  if (a.prepMinutesOverride != null) parts.push(`prep ${a.prepMinutesOverride} min`)
  if (a.wrapMinutesOverride != null) parts.push(`wrap ${a.wrapMinutesOverride} min`)
  if (a.expenses.length) {
    const total = a.expenses.reduce((s, e) => s + e.amount, 0)
    parts.push(
      `${a.expenses.length} expense${a.expenses.length === 1 ? '' : 's'} (${formatMoney(total, currency)})`,
    )
  }
  if (a.notes?.trim()) parts.push('a note')
  return parts.join(', ') || 'nothing'
}

/**
 * Trip annotations keyed to a park that no longer exists. They cannot reach any
 * trip, so what they record has stopped counting; each can be moved to a park that
 * exists or discarded.
 */
function OrphanedTripAnnotations({ orphans }: { orphans: TripAnnotation[] }) {
  const { derived, reload } = useStore()
  const [saving, setSaving] = useState<string | null>(null)

  if (!derived || orphans.length === 0) return null
  const currency = derived.snapshot.settings.currency
  const parks = [...derived.snapshot.parks].sort((a, b) => a.name.localeCompare(b.name))

  async function act(key: string, run: () => Promise<void>) {
    setSaving(key)
    try {
      await run()
      await reload()
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card
      title={`Trip notes with no park (${orphans.length})`}
      subtitle="These overrides and expenses belong to a park that was deleted, so they no longer count toward any trip. Move each to the park it belongs to, or discard it."
      action={<StatusChip role="warning" label={`${orphans.length} detached`} />}
    >
      <div className="overflow-auto" style={{ maxHeight: 320 }}>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Date', 'Former park', 'Records', ''].map((h, i) => (
                <th
                  key={h || `sp-${i}`}
                  scope="col"
                  className="sticky top-0 px-2 py-1.5 text-left font-medium"
                  style={{
                    color: 'var(--text-secondary)',
                    background: 'var(--surface-1)',
                    borderBottom: '1px solid var(--gridline)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orphans.map((a) => {
              const { date, parkId } = parseTripKey(a.key)
              return (
                <tr key={a.key} style={{ borderBottom: '1px solid var(--gridline)' }}>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    {date}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {parkId || '—'}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {describeTripAnnotation(a, currency)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <select
                      value=""
                      disabled={saving === a.key || parks.length === 0}
                      onChange={(e) => {
                        const to = e.target.value
                        if (to) void act(a.key, () => reattachTripAnnotation(a.key, to))
                      }}
                      aria-label={`Move the ${date} trip notes to a park`}
                      className="mr-2 rounded-md px-1.5 py-0.5 text-xs"
                      style={selectStyle}
                    >
                      <option value="">Move to…</option>
                      {parks.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="danger"
                      disabled={saving === a.key}
                      onClick={() => void act(a.key, () => deleteTripAnnotation(a.key))}
                    >
                      Discard
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
