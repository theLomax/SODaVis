/**
 * App shell. One filter row above everything it scopes, and a view switcher.
 *
 * The switcher reads and writes the store's `view`, so `navigate()` from a flag
 * dialog or a warning badge moves the nav highlight along with the content.
 *
 * Views that show metrics sit under the filter bar; Import, Reference and Data
 * quality do not, because a date filter on an import screen would be misleading.
 */

import { StoreProvider, useStore, type ViewId } from './store'
import { FilterBar } from './components/Controls'
import { Overview } from './views/Overview'
import { Venues, Partners, Leagues } from './views/Breakdowns'
import { Trips } from './views/Trips'
import { Cancellations } from './views/Cancellations'
import { Tax } from './views/Tax'
import { ImportView } from './views/Import'
import { Reference } from './views/Reference'
import { DataQuality } from './views/DataQuality'

const VIEWS: { id: ViewId; label: string; filtered: boolean }[] = [
  { id: 'overview', label: 'Overview', filtered: true },
  { id: 'venues', label: 'Venues', filtered: true },
  { id: 'partners', label: 'Partners', filtered: true },
  { id: 'leagues', label: 'Leagues', filtered: true },
  { id: 'trips', label: 'Trips', filtered: true },
  { id: 'cancellations', label: 'Cancellations', filtered: true },
  { id: 'tax', label: 'Tax', filtered: false },
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
  const current = VIEWS.find((v) => v.id === view)!
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
      </header>

      {current.filtered ? <FilterBar /> : null}

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
            {view === 'import' ? <ImportView /> : null}
            {view === 'reference' ? <Reference /> : null}
            {view === 'quality' ? <DataQuality /> : null}
          </div>
        )}
      </main>
    </div>
  )
}
