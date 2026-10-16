/**
 * App shell. Two rows of navigation, then one filter row above everything it
 * scopes.
 *
 * The first row is the three groups — Insights, Data, Reference — and the avatar;
 * the second is the pages of the selected group. Both read and write the store's
 * `view`, so `navigate()` from a flag dialog or a warning badge moves the
 * highlight along with the content. Reference is one view whose tabs fill the
 * second row.
 *
 * Views that show metrics sit under the filter bar; the rest do not, because a
 * date filter on an import screen would be misleading.
 *
 * The avatar at the end of the header opens the user's profile, a view that
 * belongs to no group.
 */

import { useCallback, useEffect, useState } from 'react'
import { StoreProvider, useStore, type ViewId } from './store'
import { FilterBar } from './components/Controls'
import { HiddenSportsNotice } from './components/HiddenSportsNotice'
import { Avatar } from './components/Avatar'
import { SubNav, type SubNavItem } from './components/SubNav'
import { Overview } from './views/Overview'
import { Venues, Partners, Leagues } from './views/Breakdowns'
import { Trips } from './views/Trips'
import { Cancellations } from './views/Cancellations'
import { Tax } from './views/Tax'
import { Gear } from './views/Gear'
import { ImportView } from './views/Import'
import { Reference, REFERENCE_TABS, type ReferenceTab } from './views/Reference'
import { BackupPanel } from './views/reference/Backup'
import { DataQuality } from './views/DataQuality'
import { Profile } from './views/Profile'

type GroupId = 'insights' | 'data' | 'reference'
type Page = SubNavItem<ViewId> & { filtered: boolean }

/**
 * Data is the largest group, so its row is divided: records, then reports, then
 * managing the data itself.
 */
const GROUPS: { id: GroupId; label: string; pages: Page[] }[] = [
  {
    id: 'insights',
    label: 'Insights',
    pages: [
      { id: 'overview', label: 'Overview', filtered: true },
      { id: 'venues', label: 'Venues', filtered: true },
      { id: 'partners', label: 'Partners', filtered: true },
      { id: 'leagues', label: 'Leagues', filtered: true },
      { id: 'cancellations', label: 'Cancellations', filtered: true },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    pages: [
      { id: 'trips', label: 'Trips', filtered: true },
      { id: 'gear', label: 'Gear', filtered: false },
      { id: 'tax', label: 'Tax', filtered: false, divider: true },
      { id: 'import', label: 'Import', filtered: false, divider: true },
      { id: 'quality', label: 'Data quality', filtered: false },
      { id: 'backup', label: 'Backup', filtered: false },
    ],
  },
  // One view; its tabs take the second row in place of pages.
  { id: 'reference', label: 'Reference', pages: [{ id: 'reference', label: 'Reference', filtered: false }] },
]

const PAGES = GROUPS.flatMap((g) => g.pages)

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
  // The profile is opened from the avatar and belongs to no group; like the
  // other non-metric views it sits outside the filter bar.
  const group = GROUPS.find((g) => g.pages.some((p) => p.id === view))
  const filtered = PAGES.find((p) => p.id === view)?.filtered ?? false
  const displayName = derived?.snapshot.identity.displayName.trim() ?? ''
  const drillFrom = drill ? PAGES.find((p) => p.id === drill.from)?.label : undefined

  // Held here rather than in Reference so the second row can draw the tabs, and
  // so the tab survives a visit elsewhere.
  const [referenceTab, setReferenceTab] = useState<ReferenceTab>('parks')
  const onReferenceTab = useCallback((tab: ReferenceTab) => setReferenceTab(tab), [])

  // Choosing a group returns to the page last open in it, not always its first.
  const [lastPage, setLastPage] = useState<Partial<Record<GroupId, ViewId>>>({})
  const groupId = group?.id
  useEffect(() => {
    if (groupId) setLastPage((l) => (l[groupId] === view ? l : { ...l, [groupId]: view }))
  }, [groupId, view])

  return (
    <div className="flex min-h-full flex-col">
      <header
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface-1)' }}
      >
        {/* On a phone the title gives its width to the groups and the avatar, so the
            header stays one line. */}
        <h1 className="m-0 hidden text-sm font-semibold sm:block" style={{ color: 'var(--text-primary)' }}>
          Officiating data
        </h1>
        <nav aria-label="Sections" className="flex gap-1">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              // The group holding the current page; the page itself is marked in
              // the row below.
              aria-current={group?.id === g.id ? 'true' : undefined}
              onClick={() => setView(lastPage[g.id] ?? g.pages[0]!.id)}
              className="rounded-md px-3 py-1 text-sm"
              style={{
                background: group?.id === g.id ? 'var(--gridline)' : 'transparent',
                color: group?.id === g.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: group?.id === g.id ? 600 : 400,
              }}
            >
              {g.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-xs sm:inline" style={{ color: 'var(--text-muted)' }}>
            {derived ? `${derived.snapshot.games.length} games on this device` : ''}
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
        </div>
      </header>

      {group?.id === 'reference' ? (
        <SubNav label="Reference" items={REFERENCE_TABS} current={referenceTab} onSelect={setReferenceTab} />
      ) : group ? (
        <SubNav label={group.label} items={group.pages} current={view} onSelect={setView} />
      ) : null}

      {filtered ? <FilterBar /> : null}
      {filtered ? <HiddenSportsNotice /> : null}

      {/* A chart click narrows the filter and changes view in one step, so the
          reader needs telling what they are looking at and a way straight back. */}
      {drill && filtered ? (
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
            {view === 'reference' ? <Reference tab={referenceTab} onTab={onReferenceTab} /> : null}
            {view === 'quality' ? <DataQuality /> : null}
            {view === 'backup' ? <BackupPanel /> : null}
            {view === 'profile' ? <Profile /> : null}
          </div>
        )}
      </main>
    </div>
  )
}
