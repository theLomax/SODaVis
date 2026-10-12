/**
 * App shell. One filter row above everything it scopes, and a view switcher.
 *
 * The switcher reads and writes the store's `view`, so `navigate()` from a flag
 * dialog or a warning badge moves the nav highlight along with the content.
 *
 * Views that show metrics sit under the filter bar; Gear, Import, Reference and
 * Data quality do not, because a date filter on an import screen would be
 * misleading.
 *
 * The avatar at the end of the header opens the user's profile, a view with no
 * entry in the switcher.
 */

import { StoreProvider, useStore, type ViewId } from './store'
import { FilterBar } from './components/Controls'
import { HiddenSportsNotice } from './components/HiddenSportsNotice'
import { Avatar } from './components/Avatar'
import { Overview } from './views/Overview'
import { Venues, Partners, Leagues } from './views/Breakdowns'
import { Trips } from './views/Trips'
import { Cancellations } from './views/Cancellations'
import { Tax } from './views/Tax'
import { Gear } from './views/Gear'
import { ImportView } from './views/Import'
import { Reference } from './views/Reference'
import { DataQuality } from './views/DataQuality'
import { Profile } from './views/Profile'

const VIEWS: { id: ViewId; label: string; filtered: boolean }[] = [
  { id: 'overview', label: 'Overview', filtered: true },
  { id: 'venues', label: 'Venues', filtered: true },
  { id: 'partners', label: 'Partners', filtered: true },
  { id: 'leagues', label: 'Leagues', filtered: true },
  { id: 'trips', label: 'Trips', filtered: true },
  { id: 'cancellations', label: 'Cancellations', filtered: true },
  { id: 'tax', label: 'Tax', filtered: false },
  { id: 'gear', label: 'Gear', filtered: false },
  { id: 'import', label: 'Import', filtered: false },
  { id: 'reference', label: 'Reference data', filtered: false },
  { id: 'quality', label: 'Data quality', filtered: false },
]

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  // The view is store state, not local state: a warning on one view has to be
  // able to send the reader to the field on another that clears it.
  const { loading, error, derived, view, setView, drill, endDrill } = useStore()
  // The profile is opened from the avatar, not the switcher, so it has no entry
  // in VIEWS; like the other non-metric views it sits outside the filter bar.
  const current = VIEWS.find((v) => v.id === view) ?? { id: view, label: 'Profile', filtered: false }
  const displayName = derived?.snapshot.identity.displayName.trim() ?? ''
  const drillFrom = drill ? VIEWS.find((v) => v.id === drill.from)?.label : undefined

  return (
    <div className="flex min-h-full flex-col">
      <header
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-1)' }}
      >
        <h1 className="m-0 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Officiating data
        </h1>
        <nav className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => setView(v.id)}
              className="rounded-md px-2.5 py-1 text-xs"
              style={{
                background: view === v.id ? 'var(--gridline)' : 'transparent',
                color: view === v.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
          {derived ? `${derived.snapshot.games.length} games on this machine` : ''}
        </span>
        <button
          type="button"
          onClick={() => setView('profile')}
          aria-current={view === 'profile' ? 'page' : undefined}
          aria-label={displayName ? `Your profile: ${displayName}` : 'Your profile'}
          title={displayName ? `Your profile: ${displayName}` : 'Your profile'}
          className="rounded-full"
          style={{
            // A ring while the profile is open, as the switcher highlights its view.
            outline: view === 'profile' ? '2px solid var(--series-1)' : 'none',
            outlineOffset: 2,
          }}
        >
          <Avatar displayName={displayName} />
        </button>
      </header>

      {current.filtered ? <FilterBar /> : null}
      {current.filtered ? <HiddenSportsNotice /> : null}

      {/* A chart click narrows the filter and changes view in one step, so the
          reader needs telling what they are looking at and a way straight back. */}
      {drill && current.filtered ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 px-6 py-2 text-xs"
          style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--gridline)' }}
        >
          <span style={{ color: 'var(--text-primary)' }}>
            Filtered to <strong>{drill.label}</strong>
          </span>
          <button
            type="button"
            onClick={endDrill}
            className="rounded-md px-2 py-0.5"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}
          >
            ← Back to {drillFrom}
          </button>
        </div>
      ) : null}

      <main className="flex-1 p-6">
        {error ? (
          <div className="card p-4">
            <p className="m-0 text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          </div>
        ) : loading && !derived ? (
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </p>
        ) : (
          // Hold the previous render at reduced opacity on refetch: no skeleton
          // flash, no layout jump.
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 120ms' }}>
            {view === 'overview' ? <Overview /> : null}
            {view === 'venues' ? <Venues /> : null}
            {view === 'partners' ? <Partners /> : null}
            {view === 'leagues' ? <Leagues /> : null}
            {view === 'trips' ? <Trips /> : null}
            {view === 'cancellations' ? <Cancellations /> : null}
            {view === 'tax' ? <Tax /> : null}
            {view === 'gear' ? <Gear /> : null}
            {view === 'import' ? <ImportView /> : null}
            {view === 'reference' ? <Reference /> : null}
            {view === 'quality' ? <DataQuality /> : null}
            {view === 'profile' ? <Profile /> : null}
          </div>
        )}
      </main>
    </div>
  )
}
