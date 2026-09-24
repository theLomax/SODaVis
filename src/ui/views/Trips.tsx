/**
 * Trips. A table with drill-down, which is the right form here: the interesting
 * thing about a trip is its several numbers side by side, not its shape.
 *
 * This is also where a trip's manual figures are entered — miles, tolls, drive
 * time, and expenses — because that is where the user is looking when they
 * notice a figure is wrong.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Button, TextInput, selectStyle } from '../components/Controls'
import { Card, EmptyState, StatusChip } from '../components/Tiles'
import { FlagDialog } from '../components/FlagDialog'
import { flagMarker, flagTitle } from '../flags'
import { formatMoney } from '../../derive/money'
import { formatMinutes, tripTime } from '../../derive/time'
import { patchGameAnnotation, saveTripAnnotation } from '../../db/repo'
import { isCancelled } from '../../model/game'
import type { Trip } from '../../derive/trips'
import type { ResolvedGame } from '../../derive/resolve'
import type {
  CallType,
  GearLevel,
  GearLevelId,
  GearModifier,
  GearModifierId,
  SportProfile,
} from '../../model/reference'
import type { Expense, ExpenseCategory, TripAnnotation } from '../../model/annotation'
import { severityStatus } from '../charts/palette'

const CATEGORIES: ExpenseCategory[] = ['tolls', 'parking', 'meals', 'gear', 'fuel', 'dues', 'other']

export function Trips() {
  const { derived, reload, pendingFocus, clearPendingFocus } = useStore()
  const [openKey, setOpenKey] = useState<string | null>(null)
  /** Trip key whose flags are being reviewed in the dialog. */
  const [flagKey, setFlagKey] = useState<string | null>(null)

  const annotations = useMemo(
    () => new Map((derived?.snapshot.tripAnnotations ?? []).map((a) => [a.key, a])),
    [derived],
  )

  /**
   * Arriving from a warning elsewhere: expand that trip and scroll to it. `openKey`
   * already existed for the dialog's own "Open this trip" action, so a deep link is
   * the same state reached from further away.
   */
  const focusTrip = pendingFocus?.view === 'trips' ? pendingFocus.focus : undefined
  const focusRow = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    if (!focusTrip) return
    setOpenKey(focusTrip)
    focusRow.current?.scrollIntoView({ block: 'center' })
    clearPendingFocus()
  }, [focusTrip, clearPendingFocus])

  if (!derived) return null
  const { trips, timeCtx, money } = derived
  const flagTrip = flagKey ? (trips.find((t) => t.key === flagKey) ?? null) : null

  if (trips.length === 0) {
    return (
      <EmptyState
        title="No trips in this range"
        body="A trip is one visit to one park on one day, built from active games only. Widen the filter or import more games."
      />
    )
  }

  const currency = money.currency

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`${trips.length} trips`}
        subtitle={`Across ${new Set(trips.map((t) => t.date)).size} work days. Cancelled games are excluded by design.`}
      >
        {/* Cap by viewport rather than a fixed pixel height, so the last visible
            row is never sliced in half while the page has room below. */}
        <div className="overflow-auto" style={{ maxHeight: 'min(72vh, 900px)' }}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Date', 'Park', 'Games', 'First', 'Last end', 'Game time', 'Drive', 'Miles', 'Tolls', 'Income', ''].map(
                  (h, i) => (
                    <th
                      key={h || `spacer-${i}`}
                      scope="col"
                      className="sticky top-0 px-2 py-1.5 font-medium"
                      style={{
                        textAlign: i >= 2 && i <= 9 ? 'right' : 'left',
                        color: 'var(--text-secondary)',
                        background: 'var(--surface-1)',
                        borderBottom: '1px solid var(--gridline)',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const t = tripTime(trip, timeCtx)
                const gross = trip.games.reduce((s, g) => s + (g.game.fees.actual ?? 0), 0)
                const isOpen = openKey === trip.key
                return (
                  // The fragment carries the key: a trip renders two sibling rows.
                  <Fragment key={trip.key}>
                    <tr
                      {...(trip.key === focusTrip ? { ref: focusRow } : {})}
                      style={{ borderBottom: '1px solid var(--gridline)' }}
                    >
                      {/* The weekday is the thing you actually reason about —
                          "was that a Saturday?" — but it would cost a column, so
                          it rides the date's tooltip. */}
                      <Td>
                        <span title={weekdayOf(trip.date)}>{trip.date}</span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          {trip.parkName}
                          {trip.flags.length > 0 ? (
                            <StatusChip
                              role={severityStatus(trip.flags[0]!.severity)}
                              marker={flagMarker(trip.flags[0]!.severity)}
                              label={trip.flags.length === 1 ? 'Review' : `${trip.flags.length} issues`}
                              onClick={() => setFlagKey(trip.key)}
                              opensDialog
                              title={
                                trip.flags.length === 1
                                  ? `${flagTitle(trip.flags[0]!.code)} — open for detail`
                                  : `${trip.flags.length} items to review — open for detail`
                              }
                            />
                          ) : null}
                        </span>
                      </Td>
                      <Td right>{trip.games.length}</Td>
                      <Td right>{trip.firstStart}</Td>
                      <Td right>{trip.lastEnd ?? '—'}</Td>
                      <Td right>{formatMinutes(trip.gameMinutes)}</Td>
                      <Td right>
                        {formatMinutes(trip.driveMinutes)}
                        <SourceMark source={trip.driveMinutesSource} />
                      </Td>
                      <Td right>
                        {trip.miles == null ? '—' : trip.miles.toLocaleString()}
                        <SourceMark source={trip.milesSource} />
                      </Td>
                      <Td right>
                        {trip.tolls == null ? '—' : formatMoney(trip.tolls, currency)}
                        <SourceMark source={trip.tollsSource} />
                      </Td>
                      <Td right>{formatMoney(gross, currency)}</Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => setOpenKey(isOpen ? null : trip.key)}
                          aria-expanded={isOpen}
                          className="rounded px-1.5 py-0.5"
                          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}
                        >
                          {isOpen ? 'Close' : 'Open'}
                        </button>
                      </Td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={11} style={{ background: 'var(--surface-page)', padding: 0 }}>
                          <TripDetail
                            trip={trip}
                            onReviewFlag={() => setFlagKey(trip.key)}
                            sports={derived.snapshot.sports}
                            gearLevels={derived.snapshot.gearLevels}
                            gearModifiers={derived.snapshot.gearModifiers}
                            callTypes={derived.snapshot.callTypes}
                            annotation={annotations.get(trip.key)}
                            committedMinutes={t.byModel['committed']}
                            prepMinutes={t.prepMinutes}
                            wrapMinutes={t.wrapMinutes}
                            gapMinutes={t.gapMinutes}
                            currency={currency}
                            onSaved={reload}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* One dialog for the whole table, driven by which trip's chip was clicked.
          Its fix action expands that trip's row where the overrides live, and falls
          back to the flag's own destination where they do not. */}
      {flagTrip ? (
        <FlagDialog
          open
          onClose={() => setFlagKey(null)}
          subject={flagTrip.parkName}
          subjectDetail={`${flagTrip.date} · ${flagTrip.games.length} game${
            flagTrip.games.length === 1 ? '' : 's'
          }`}
          flags={flagTrip.flags}
          // Fixable here: keep the in-place action, which beats navigating away.
          // Otherwise pass none and the dialog falls back to the flag's own fix
          // target — a missing duration lives in Reference data, so that is where
          // its footer button goes.
          {...(canFixHere(flagTrip)
            ? {
                action: {
                  label: 'Open this trip to enter it',
                  onClick: () => setOpenKey(flagTrip.key),
                },
              }
            : {})}
        />
      ) : null}
    </div>
  )
}

/**
 * True when the flag is fixable on this view. Mileage, tolls and drive time are
 * all trip overrides; a missing duration belongs to an age group, so it is fixed
 * in Reference data instead and gets no button here.
 */
function canFixHere(trip: Trip): boolean {
  return trip.flags.some((f) =>
    ['multi-trip-day', 'missing-mileage', 'missing-drive-time'].includes(f.code),
  )
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td
      className={right ? 'num-tabular px-2 py-1.5' : 'px-2 py-1.5'}
      style={{ textAlign: right ? 'right' : 'left', color: 'var(--text-primary)' }}
    >
      {children}
    </td>
  )
}

function TripDetail({
  trip,
  onReviewFlag,
  sports,
  gearLevels,
  gearModifiers,
  callTypes,
  annotation,
  committedMinutes,
  prepMinutes,
  wrapMinutes,
  gapMinutes,
  currency,
  onSaved,
}: {
  trip: Trip
  /** Opens the shared flag dialog for this trip. */
  onReviewFlag: () => void
  sports: SportProfile[]
  gearLevels: GearLevel[]
  gearModifiers: GearModifier[]
  callTypes: CallType[]
  annotation: TripAnnotation | undefined
  committedMinutes: number | null
  prepMinutes: number
  wrapMinutes: number
  gapMinutes: number | null
  currency: string
  onSaved: () => Promise<void>
}) {
  const [miles, setMiles] = useState(annotation?.milesOverride?.toString() ?? '')
  const [tolls, setTolls] = useState(annotation?.tollsOverride?.toString() ?? '')
  const [drive, setDrive] = useState(annotation?.driveMinutesOverride?.toString() ?? '')
  const [prep, setPrep] = useState(annotation?.prepMinutesOverride?.toString() ?? '')
  const [wrap, setWrap] = useState(annotation?.wrapMinutesOverride?.toString() ?? '')
  const [notes, setNotes] = useState(annotation?.notes ?? '')
  const [expenses, setExpenses] = useState<Expense[]>(annotation?.expenses ?? [])
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('parking')
  const [deductible, setDeductible] = useState(true)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const num = (v: string) => {
    const n = Number(v)
    return v.trim() && Number.isFinite(n) ? n : undefined
  }

  async function save(nextExpenses = expenses) {
    setSaving(true)
    try {
      const next: TripAnnotation = { key: trip.key, expenses: nextExpenses }
      const m = num(miles)
      const t = num(tolls)
      const d = num(drive)
      if (m != null) next.milesOverride = m
      if (t != null) next.tollsOverride = t
      if (d != null) next.driveMinutesOverride = d
      const p = num(prep)
      const w = num(wrap)
      if (p != null) next.prepMinutesOverride = p
      if (w != null) next.wrapMinutesOverride = w
      if (notes.trim()) next.notes = notes.trim()
      await saveTripAnnotation(next)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  function addExpense() {
    const a = num(amount)
    if (a == null) return
    const next: Expense[] = [
      ...expenses,
      {
        id: `exp_${Date.now().toString(36)}`,
        amount: a,
        category,
        deductible,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    ]
    setExpenses(next)
    setAmount('')
    setNote('')
    void save(next)
  }

  function removeExpense(id: string) {
    const next = expenses.filter((e) => e.id !== id)
    setExpenses(next)
    void save(next)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {trip.flags.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {trip.flags.map((f) => (
            <li key={f.code} className="flex items-center gap-2 text-xs">
              {/* The human title, not the machine code, with the detail a click away. */}
              <StatusChip
                role={severityStatus(f.severity)}
                marker={flagMarker(f.severity)}
                label={flagTitle(f.code)}
                onClick={onReviewFlag}
                opensDialog
                title="Open for detail"
              />
              <span style={{ color: 'var(--text-secondary)' }}>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h4 className="m-0 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            Games on this trip
          </h4>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {trip.games.map((g) => (
                <Fragment key={g.game.id}>
                  <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <Td>{g.game.startTime}</Td>
                    <Td>{g.game.ageGroupRaw}</Td>
                    <Td>{g.partners.map((p) => p.raw).join(', ') || 'Solo'}</Td>
                    <Td>
                      <SportTag game={g} sports={sports} onSaved={onSaved} />
                    </Td>
                    <Td right>
                      <DurationCell game={g} onSaved={onSaved} />
                    </Td>
                    <Td right>{formatMoney(g.game.fees.actual ?? 0, currency)}</Td>
                  </tr>
                  {/* Role and conditions on their own line: six controls would not
                      fit the row, and prep time is a property of the day rather
                      than of any single column above. */}
                  <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <Td>{''}</Td>
                    <td className="px-2 py-1 align-middle" colSpan={5}>
                      <GearCell
                        game={g}
                        gearLevels={gearLevels}
                        gearModifiers={gearModifiers}
                        onSaved={onSaved}
                      />
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--gridline)' }}>
                    <Td>{''}</Td>
                    <td className="px-2 py-1 align-middle" colSpan={5}>
                      <CallCell game={g} callTypes={callTypes} onSaved={onSaved} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
            Committed time {formatMinutes(committedMinutes)} — {formatMinutes(prepMinutes)} prep,{' '}
            {formatMinutes(wrapMinutes)} wrap, {formatMinutes(gapMinutes)} waiting between games.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h4 className="m-0 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            Manual overrides
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <Labeled label={`Miles (${trip.milesSource})`}>
              <TextInput value={miles} onChange={setMiles} type="number" step="0.1" placeholder={String(trip.miles ?? '')} ariaLabel="Miles override" />
            </Labeled>
            <Labeled label={`Tolls (${trip.tollsSource})`}>
              <TextInput value={tolls} onChange={setTolls} type="number" step="0.01" placeholder={String(trip.tolls ?? '')} ariaLabel="Tolls override" />
            </Labeled>
            <Labeled label={`Drive min (${trip.driveMinutesSource})`}>
              <TextInput value={drive} onChange={setDrive} type="number" placeholder={String(trip.driveMinutesSource === 'none' ? '' : (trip.driveMinutes ?? ''))} ariaLabel="Drive minutes override" />
            </Labeled>
          </div>
          {/* The two legs are rarely the same drive, so the total is shown split.
              Without this, a round-trip figure that is not twice the one-way one
              looks like an error rather than the point. */}
          {trip.driveOutMinutes != null && trip.driveHomeMinutes != null ? (
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatMinutes(trip.driveOutMinutes)} out
              {trip.outboundInRush ? (
                <span title="The first pitch falls in rush hour, so this leg uses the park's rush figure">
                  {' '}
                  (rush hour)
                </span>
              ) : null}{' '}
              + {formatMinutes(trip.driveHomeMinutes)} home
              {trip.returnInRush ? (
                <span title="The last game lets out inside rush hour, so the drive home uses the park's rush figure">
                  {' '}
                  (rush hour)
                </span>
              ) : null}
              .
            </p>
          ) : null}
          {/* Prep and wrap are normally derived from the sport, the role and the
              conditions. These are for the day that broke the pattern — an early
              arrival for a tournament, or a ground crew that kept you late. */}
          <div className="grid grid-cols-2 gap-2">
            <Labeled
              label={`Prep min (${annotation?.prepMinutesOverride != null ? 'yours' : 'from sport & gear'})`}
            >
              <TextInput value={prep} onChange={setPrep} type="number" placeholder={String(prepMinutes)} ariaLabel="Prep minutes override" />
            </Labeled>
            <Labeled
              label={`Wrap min (${annotation?.wrapMinutesOverride != null ? 'yours' : 'from sport'})`}
            >
              <TextInput value={wrap} onChange={setWrap} type="number" placeholder={String(wrapMinutes)} ariaLabel="Wrap minutes override" />
            </Labeled>
          </div>
          <Labeled label="Trip notes">
            <TextInput value={notes} onChange={setNotes} ariaLabel="Trip notes" />
          </Labeled>
          <div>
            <Button onClick={() => void save()} disabled={saving} variant="primary">
              {saving ? 'Saving…' : 'Save overrides'}
            </Button>
          </div>

          <h4 className="m-0 mt-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            Expenses
          </h4>
          {expenses.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {e.category}
                    {e.note ? ` — ${e.note}` : ''}
                    {e.deductible ? '' : ' (not deductible)'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num-tabular">{formatMoney(e.amount, currency)}</span>
                    <button
                      type="button"
                      onClick={() => removeExpense(e.id)}
                      aria-label={`Remove ${e.category} expense`}
                      style={{ color: 'var(--status-critical)' }}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              None logged for this trip.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <Labeled label="Amount">
              <TextInput value={amount} onChange={setAmount} type="number" step="0.01" width={90} ariaLabel="Expense amount" />
            </Labeled>
            <Labeled label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="rounded-md px-2 py-1 text-xs"
                style={selectStyle}
                aria-label="Expense category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Note">
              <TextInput value={note} onChange={setNote} width={160} ariaLabel="Expense note" />
            </Labeled>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={deductible} onChange={(e) => setDeductible(e.target.checked)} />
              Deductible
            </label>
            <Button onClick={addExpense} disabled={!amount.trim()}>
              Add expense
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}


/**
 * Sport tag for one game.
 *
 * Shown as plain text when the source stated a sport, and as a select when it did
 * not — the common case needs no widget, and the gap is where the work is. A tag
 * you set is marked, so a manual value is never mistaken for imported data.
 *
 * The override is a game annotation keyed by dedupeKey, so re-importing keeps it.
 */
function SportTag({
  game,
  sports,
  onSaved,
}: {
  game: ResolvedGame
  sports: SportProfile[]
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  async function set(code: string) {
    setSaving(true)
    try {
      // A patch, so a duration override, gear level or note on this game survives.
      await patchGameAnnotation(game.game.source.dedupeKey, {
        sportCodeOverride: code || undefined,
      })
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  // The source supplied one and it has not been overridden: nothing to do.
  if (game.game.sportCode && !game.sportCodeIsManual) {
    return (
      <span style={{ color: 'var(--text-secondary)' }}>
        {sports.find((s) => s.code === game.game.sportCode)?.label ?? game.game.sportCode}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={game.sportCode ?? ''}
        disabled={saving}
        onChange={(e) => void set(e.target.value)}
        aria-label={`Sport for the ${game.game.startTime} game`}
        className="rounded-md px-1.5 py-0.5 text-xs"
        style={selectStyle}
      >
        <option value="">Untagged</option>
        {sports.map((s) => (
          <option key={s.code} value={s.code}>
            {s.label}
          </option>
        ))}
      </select>
      {game.sportCodeIsManual ? (
        <span title="Tagged by hand, not from the import" style={{ color: 'var(--text-muted)' }}>
          manual
        </span>
      ) : null}
    </span>
  )
}

/**
 * Per-game duration, with the source named the way the trip's mileage names its
 * own: "90m (reference)" vs "75m (yours)". A figure on screen should say where it
 * came from without being clicked.
 *
 * The age-group table sets a duration for every game sharing a group; this is for
 * the one game that did not match it — a tournament game in a rec-league group, or
 * one cut short. Clearing the box returns the game to the group's figure.
 */
function DurationCell({
  game,
  onSaved,
}: {
  game: ResolvedGame
  onSaved: () => Promise<void>
}) {
  const stored = game.duration.source === 'annotation' ? String(game.duration.minutes ?? '') : ''
  const [value, setValue] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setValue(stored)
  }, [stored])

  async function commit() {
    const trimmed = value.trim()
    const parsed = trimmed === '' ? undefined : Number(trimmed)
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) return
    setSaving(true)
    try {
      await patchGameAnnotation(game.game.source.dedupeKey, {
        durationMinutesOverride: parsed,
      })
      await onSaved()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // A cancelled game was never played, so a duration would change nothing.
  if (isCancelled(game.game.status)) {
    return <span style={{ color: 'var(--text-muted)' }}>not played</span>
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md px-1 py-0.5 text-xs"
        style={{ color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
        aria-label={`Duration for the ${game.game.startTime} game — ${durationSourceLabel(game.duration.source)}. Click to change.`}
        title="Click to set this game's own duration"
      >
        {game.duration.minutes == null ? (
          <span style={{ color: 'var(--text-muted)' }}>no duration</span>
        ) : (
          <>
            {formatMinutes(game.duration.minutes)}{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              ({durationSourceLabel(game.duration.source)})
            </span>
          </>
        )}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="1"
        value={value}
        autoFocus
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') {
            setValue(stored)
            setEditing(false)
          }
        }}
        placeholder={String(game.duration.minutes ?? '')}
        aria-label={`Minutes for the ${game.game.startTime} game`}
        className="w-16 rounded-md px-1 py-0.5 text-xs"
        style={selectStyle}
      />
      <span style={{ color: 'var(--text-muted)' }}>min</span>
    </span>
  )
}

/**
 * Where a figure came from, marked on the value itself.
 *
 * A table has no room for the parenthetical the editors use ("Miles (override)"),
 * so each cell carries a short suffix instead — extending the `est.` marker the
 * drive column already had rather than inventing an asterisk convention that would
 * need a legend.
 *
 * Only non-obvious provenance is marked. A figure straight from reference data is
 * the expected case and says nothing; `yours` means you typed it, and `est.` means
 * the app derived it from something else and could be wrong.
 */
function SourceMark({
  source,
}: {
  source: Trip['milesSource'] | Trip['driveMinutesSource'] | Trip['tollsSource']
}) {
  const mark =
    source === 'override'
      ? { text: 'yours', title: 'You entered this figure for this trip' }
      : source === 'estimated'
        ? { text: 'est.', title: 'Estimated from mileage, not measured' }
        : source === 'park-rush'
          ? { text: 'rush', title: "Uses this park's rush-hour figure for at least one leg" }
          : null

  if (!mark) return null
  return (
    <span style={{ color: 'var(--text-muted)' }} title={mark.title}>
      {' '}
      {mark.text}
    </span>
  )
}

/**
 * The full weekday name for an ISO date. Parsed as UTC so the day never shifts
 * with the viewer's timezone — the same reason the metrics layer does it.
 */
function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

/** Where a duration came from, in the same voice as `trip.milesSource`. */
function durationSourceLabel(source: ResolvedGame['duration']['source']): string {
  switch (source) {
    case 'annotation':
      return 'yours'
    case 'reference':
      return 'age group'
    case 'extracted':
      return 'from name'
    default:
      return 'none'
  }
}

/**
 * The position worked, and what was worn.
 *
 * Genuinely independent: the position is one of two, while gear stacks. They are
 * separate because they do not track each other — a base umpire wears full gear
 * in some two-umpire baseball and none in kickball, slowpitch or coach pitch. The
 * plate assumes full gear as a convenience, but the tick can be cleared.
 *
 * Prep is charged once per trip from its first game, so this is where the
 * plate-versus-bases difference actually lands.
 */
function GearCell({
  game,
  gearLevels,
  gearModifiers,
  onSaved,
}: {
  game: ResolvedGame
  gearLevels: GearLevel[]
  gearModifiers: GearModifier[]
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const active = new Set(game.gearModifiers)

  async function patch(patchIn: {
    gearLevel?: GearLevelId | undefined
    gearModifiers?: GearModifierId[]
  }) {
    setSaving(true)
    try {
      await patchGameAnnotation(game.game.source.dedupeKey, patchIn)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  function toggle(id: GearModifierId, on: boolean) {
    const next = new Set(active)
    if (on) next.add(id)
    else next.delete(id)
    // Always writes a list, empty included: at the plate, "nothing recorded"
    // means full gear, so clearing the last tick has to be stated to stick.
    void patch({ gearModifiers: [...next] })
  }

  if (isCancelled(game.game.status) && !game.droveToCancelled) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        value={game.gearLevel ?? ''}
        disabled={saving}
        onChange={(e) =>
          void patch({ gearLevel: (e.target.value || undefined) as GearLevelId | undefined })
        }
        aria-label={`Position worked in the ${game.game.startTime} game`}
        className="rounded-md px-1.5 py-0.5 text-xs"
        style={selectStyle}
      >
        {/* Unset is a real answer: the export does not record who took the plate,
            and kickball and slowpitch do not imply a position at all. */}
        <option value="">Position not set</option>
        {gearLevels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      {gearModifiers
        // The shield is a choice of chest protection, so it only makes sense on
        // the plate. Hidden rather than disabled: an option that can never apply
        // is noise, not a disabled control to wonder about.
        .filter((m) => !m.plateOnly || game.gearLevel === 'plate')
        .map((m) => (
          <label key={m.id} className="flex items-center gap-1" title={m.hint}>
            <input
              type="checkbox"
              checked={active.has(m.id)}
              disabled={saving}
              onChange={(e) => toggle(m.id, e.target.checked)}
              aria-label={`${m.label} for the ${game.game.startTime} game`}
            />
            <span style={{ color: 'var(--text-muted)' }}>{m.label}</span>
          </label>
        ))}
    </span>
  )
}

/**
 * Rare-call chips for one game. Independent of position and gear: a Fourth Out
 * is a fact about the play, not about what was worn. Hidden on cancellations —
 * a game that never started has no calls.
 */
function CallCell({
  game,
  callTypes,
  onSaved,
}: {
  game: ResolvedGame
  callTypes: CallType[]
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const active = new Set(game.calls)
  const types = [...callTypes].sort((a, b) => a.label.localeCompare(b.label))

  async function toggle(id: string, on: boolean) {
    const next = new Set(active)
    if (on) next.add(id)
    else next.delete(id)
    setSaving(true)
    try {
      await patchGameAnnotation(game.game.source.dedupeKey, {
        calls: next.size ? [...next] : undefined,
      })
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (isCancelled(game.game.status)) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }

  if (types.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>Add call types in Reference data</span>
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span style={{ color: 'var(--text-muted)' }}>Calls</span>
      {types.map((t) => (
        <label key={t.id} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={active.has(t.id)}
            disabled={saving}
            onChange={(e) => void toggle(t.id, e.target.checked)}
            aria-label={`${t.label} for the ${game.game.startTime} game`}
          />
          <span style={{ color: 'var(--text-muted)' }}>{t.label}</span>
        </label>
      ))}
    </span>
  )
}
