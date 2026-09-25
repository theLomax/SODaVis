/**
 * Reference data editors. This is the user's own knowledge, and it is the part
 * the spreadsheet could never keep straight — mileage and tolls that disagreed
 * between sheets, durations buried in formula chains.
 *
 * Nothing here is ever written by an import. Each tab lives in its own file
 * under `./reference/` so later work on one editor does not load the others.
 */

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { ParksEditor } from './reference/Parks'
import { DurationsEditor } from './reference/Durations'
import { SportsEditor } from './reference/Sports'
import { IdentityEditor } from './reference/Identity'
import { SettingsEditor } from './reference/Settings'
import { BackupPanel } from './reference/Backup'
import { CallsEditor } from './reference/Calls'

type Tab = 'parks' | 'durations' | 'sports' | 'calls' | 'identity' | 'settings' | 'backup'

const TABS: { id: Tab; label: string }[] = [
  { id: 'parks', label: 'Parks & mileage' },
  { id: 'durations', label: 'Game durations' },
  { id: 'sports', label: 'Sports & gear' },
  { id: 'calls', label: 'Call types' },
  { id: 'identity', label: 'Identity' },
  { id: 'settings', label: 'Settings' },
  { id: 'backup', label: 'Backup' },
]

export function Reference() {
  const { pendingFocus } = useStore()
  const [tab, setTab] = useState<Tab>('parks')

  /**
   * A navigation into this view names the tab the field lives on. Adopting it in
   * an effect rather than as initial state means arriving here a second time, from
   * a different warning, still switches tabs.
   *
   * The focus itself is left in the store for the editor below to consume — it is
   * the only thing that knows how to find its own row.
   */
  const wantedTab = pendingFocus?.view === 'reference' ? pendingFocus.tab : undefined
  useEffect(() => {
    if (wantedTab) setTab(wantedTab)
  }, [wantedTab])

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-md px-3 py-1.5 text-xs"
            style={{
              background: tab === t.id ? 'var(--gridline)' : 'transparent',
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'parks' ? <ParksEditor /> : null}
      {tab === 'durations' ? <DurationsEditor /> : null}
      {tab === 'sports' ? <SportsEditor /> : null}
      {tab === 'calls' ? <CallsEditor /> : null}
      {tab === 'identity' ? <IdentityEditor /> : null}
      {tab === 'settings' ? <SettingsEditor /> : null}
      {tab === 'backup' ? <BackupPanel /> : null}
    </div>
  )
}
