/**
 * App state. Holds the loaded snapshot, the current filter and the current view,
 * and runs the whole derive chain in one memo — the derive layer is pure functions
 * over arrays, so recomputing everything on any change is cheap at this scale and
 * removes any question of stale caches.
 *
 * The view lives here rather than in the shell because navigation is a thing any
 * view needs to do: a warning is only useful if the reader can get from it to the
 * field that clears it, and that field is usually on a different view. `navigate()`
 * is the one call that does it, from any depth, with no prop threading.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { Game } from '../model/game'
import { UNSPECIFIED_SPORT, type TimeModelId } from '../model/reference'
import { tripKey } from '../model/annotation'
import { db, seedReferenceData } from '../db/schema'
import { loadSnapshot, type AppSnapshot } from '../db/repo'
import { resolveGames, type ResolveContext, type ResolvedGame } from '../derive/resolve'
import { buildTrips, type Trip } from '../derive/trips'
import type { TimeContext } from '../derive/time'
import { totalMoney, computeRates, type MoneyTotals, type Rates } from '../derive/money'
import { totalTime, type TimeTotals } from '../derive/time'
import type { BreakdownContext } from '../derive/metrics'
import type { FixTarget } from './flags'

export type ViewId =
  | 'overview'
  | 'venues'
  | 'partners'
  | 'leagues'
  | 'trips'
  | 'cancellations'
  | 'tax'
  | 'import'
  | 'reference'
  | 'quality'

/**
 * A navigation request: where to go, plus optionally which row to land on.
 *
 * `focus` is deliberately an opaque string rather than a typed union — it is a
 * park id on Reference → Parks, an age-group key on → Game durations, a trip key
 * on Trips. The destination view is the only thing that knows how to read it, and
 * it clears the value once consumed so a later render does not re-scroll.
 */
export type NavTarget = FixTarget & { focus?: string }

export type Filter = {
  /**
   * null = all dates. Either bound may be null on its own, meaning open-ended in
   * that direction — "everything since March" is a real thing to ask for, and it
   * should not require inventing a sentinel far-future date to express.
   */
  period: { start: string | null; end: string | null } | null
  sportCodes: string[]
  parkIds: string[]
  model: TimeModelId
}

export type DerivedState = {
  snapshot: AppSnapshot
  /** Every game, resolved. Filters are applied downstream of this. */
  allResolved: ResolvedGame[]
  /** Resolved games inside the current filter. */
  resolved: ResolvedGame[]
  trips: Trip[]
  unplaceable: ResolvedGame[]
  cancelled: ResolvedGame[]
  /**
   * Cancellations with no stage recorded, so whether a drive was made is still
   * unknown. Their mileage is uncounted until someone says.
   */
  uncountedDrives: ResolvedGame[]
  money: MoneyTotals
  time: TimeTotals
  rates: Rates
  timeCtx: TimeContext
  breakdownCtx: BreakdownContext
}

type Store = {
  loading: boolean
  error: string | null
  filter: Filter
  setFilter: (next: Partial<Filter>) => void
  view: ViewId
  setView: (v: ViewId) => void
  /** Switches view and hands the destination a row to land on. */
  navigate: (target: NavTarget) => void
  /**
   * The row the destination view should scroll to and highlight, with the tab it
   * lives on where the view has tabs. Consumed and cleared by that view.
   */
  pendingFocus: PendingFocus | null
  clearPendingFocus: () => void
  derived: DerivedState | null
  reload: () => Promise<void>
  theme: 'system' | 'light' | 'dark'
  setTheme: (t: 'system' | 'light' | 'dark') => void
}

export type PendingFocus = {
  view: ViewId
  /** Only set for a Reference target. */
  tab?: 'parks' | 'durations' | 'identity'
  /** Park id, age-group key or trip key, per the destination. */
  focus?: string
}

const StoreContext = createContext<Store | null>(null)

const DEFAULT_FILTER: Filter = {
  period: null,
  sportCodes: [],
  parkIds: [],
  model: 'game-drive',
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilterState] = useState<Filter>(DEFAULT_FILTER)
  const [view, setView] = useState<ViewId>('overview')
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null)
  const [theme, setThemeState] = useState<'system' | 'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'system' | 'light' | 'dark') ?? 'system',
  )

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await db.open()
      await seedReferenceData(db)
      const next = await loadSnapshot(db)
      setSnapshot(next)
      // Adopt the stored preferred model on first load.
      setFilterState((f) => (f === DEFAULT_FILTER ? { ...f, model: next.settings.preferredTimeModel } : f))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const setFilter = useCallback((next: Partial<Filter>) => {
    setFilterState((f) => ({ ...f, ...next }))
  }, [])

  const navigate = useCallback((target: NavTarget) => {
    setView(target.view)
    // Set even with no focus: the destination still needs the tab, and a stale
    // focus from a previous navigation must not survive this one.
    setPendingFocus({
      view: target.view,
      ...(target.view === 'reference' ? { tab: target.tab } : {}),
      ...(target.focus ? { focus: target.focus } : {}),
    })
  }, [])

  const clearPendingFocus = useCallback(() => setPendingFocus(null), [])

  const derived = useMemo<DerivedState | null>(() => {
    if (!snapshot) return null
    return derive(snapshot, filter)
  }, [snapshot, filter])

  const value = useMemo<Store>(
    () => ({
      loading,
      error,
      filter,
      setFilter,
      view,
      setView,
      navigate,
      pendingFocus,
      clearPendingFocus,
      derived,
      reload,
      theme,
      setTheme: setThemeState,
    }),
    [
      loading,
      error,
      filter,
      setFilter,
      view,
      navigate,
      pendingFocus,
      clearPendingFocus,
      derived,
      reload,
      theme,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}

/** Convenience for views that only run once data exists. */
export function useDerived(): DerivedState | null {
  return useStore().derived
}

// ---------------------------------------------------------------------------
// The derive chain
// ---------------------------------------------------------------------------

export function derive(snapshot: AppSnapshot, filter: Filter): DerivedState {
  const resolveCtx: ResolveContext = {
    parks: snapshot.parks,
    durations: new Map(snapshot.durations.map((d) => [d.key, d])),
    sports: new Map(snapshot.sports.map((s) => [s.code, s])),
    annotations: new Map(snapshot.gameAnnotations.map((a) => [a.dedupeKey, a])),
  }

  const allResolved = resolveGames(snapshot.games, resolveCtx)
  const resolved = allResolved.filter((r) => matches(r, filter))

  const tripAnnotations = new Map(snapshot.tripAnnotations.map((a) => [a.key, a]))

  const { trips, unplaceable, cancelled, uncountedDrives } = buildTrips(resolved, {
    parks: new Map(snapshot.parks.map((p) => [p.id, p])),
    tripAnnotations,
    settings: snapshot.settings,
  })

  const timeCtx: TimeContext = {
    sports: new Map(snapshot.sports.map((s) => [s.code, s])),
    gearLevels: new Map(snapshot.gearLevels.map((g) => [g.id, g])),
    gearModifiers: new Map(snapshot.gearModifiers.map((g) => [g.id, g])),
    settings: snapshot.settings,
    prepOverrides: new Map(
      snapshot.tripAnnotations
        .filter((a) => a.prepMinutesOverride != null || a.wrapMinutesOverride != null)
        .map((a) => [
          a.key,
          {
            ...(a.prepMinutesOverride != null ? { prepMinutes: a.prepMinutesOverride } : {}),
            ...(a.wrapMinutesOverride != null ? { wrapMinutes: a.wrapMinutesOverride } : {}),
          },
        ]),
    ),
  }

  const money = totalMoney(resolved, trips, tripAnnotations, snapshot.settings)
  const time = totalTime(trips, timeCtx)
  const rates = computeRates(money, trips, timeCtx)

  return {
    snapshot,
    allResolved,
    resolved,
    trips,
    unplaceable,
    cancelled,
    uncountedDrives,
    money,
    time,
    rates,
    timeCtx,
    breakdownCtx: { trips, timeCtx, model: filter.model, tripAnnotations },
  }
}

/**
 * Whether a date is inside the filter's range, with either bound open.
 *
 * Exported so the range behaviour can be tested directly: a null bound means
 * open-ended in that direction, and the alternative — comparing against a
 * fabricated `1900-01-01` or `2999-12-31` — is the bug this replaced.
 */
export function dateInFilterPeriod(date: string, period: Filter['period']): boolean {
  if (!period) return true
  if (period.start != null && date < period.start) return false
  if (period.end != null && date > period.end) return false
  return true
}

function matches(r: ResolvedGame, filter: Filter): boolean {
  const { game } = r
  if (!dateInFilterPeriod(game.date, filter.period)) return false
  // The resolved code, so filtering follows a manual sport tag.
  if (
    filter.sportCodes.length &&
    !filter.sportCodes.includes(r.sportCode ?? UNSPECIFIED_SPORT)
  ) {
    return false
  }
  if (filter.parkIds.length && !(r.parkId && filter.parkIds.includes(r.parkId))) return false
  return true
}

/** Trip key for a game, for looking up its trip annotation. */
export function gameTripKey(r: ResolvedGame): string | null {
  return r.parkId ? tripKey(r.game.date, r.parkId) : null
}

export function gameLabel(game: Game): string {
  return `${game.date} ${game.startTime} · ${game.ageGroupRaw || game.venueRaw}`
}
