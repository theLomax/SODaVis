/**
 * Reference data editors. This is the user's own knowledge, and it is the part
 * the spreadsheet could never keep straight — mileage and tolls that disagreed
 * between sheets, durations buried in formula chains.
 *
 * Nothing here is ever written by an import. Each tab lives in its own file
 * under `./reference/` so later work on one editor does not load the others.
 *
 * The tabs are the Reference group's row of the app navigation, so the shell
 * draws them and owns which is showing; this view only renders it.
 */

import { useEffect } from 'react'
import { useStore } from '../store'
import { ParksEditor } from './reference/Parks'
import { DurationsEditor } from './reference/Durations'
import { SportsEditor } from './reference/Sports'
import { IdentityEditor } from './reference/Identity'
import { SettingsEditor } from './reference/Settings'
import { CallsEditor } from './reference/Calls'
import { OrganizationsEditor } from './reference/Organizations'

export type ReferenceTab = 'parks' | 'durations' | 'sports' | 'calls' | 'organizations' | 'identity' | 'settings'

export const REFERENCE_TABS: { id: ReferenceTab; label: string }[] = [
  { id: 'parks', label: 'Parks & mileage' },
  { id: 'durations', label: 'Game durations' },
  { id: 'sports', label: 'Sports & gear' },
  { id: 'calls', label: 'Call types' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'identity', label: 'Identity' },
  { id: 'settings', label: 'Settings' },
]

export function Reference({ tab, onTab }: { tab: ReferenceTab; onTab: (tab: ReferenceTab) => void }) {
  const { pendingFocus, clearPendingFocus } = useStore()

  /**
   * A navigation into this view names the tab the field lives on. Adopting it in
   * an effect means arriving here a second time, from a different warning, still
   * switches tabs.
   *
   * The focus itself is left in the store for the editor below to consume — it is
   * the only thing that knows how to find its own row. Only Parks and Durations do
   * that; for any other tab the request is spent once the tab is showing, and is
   * cleared here so it cannot pull a later visit back to that tab.
   */
  const wantedTab = pendingFocus?.view === 'reference' ? pendingFocus.tab : undefined
  useEffect(() => {
    if (!wantedTab) return
    onTab(wantedTab)
    if (wantedTab !== 'parks' && wantedTab !== 'durations') clearPendingFocus()
  }, [wantedTab, onTab, clearPendingFocus])

  return (
    <>
      {tab === 'parks' ? <ParksEditor /> : null}
      {tab === 'durations' ? <DurationsEditor /> : null}
      {tab === 'sports' ? <SportsEditor /> : null}
      {tab === 'calls' ? <CallsEditor /> : null}
      {tab === 'organizations' ? <OrganizationsEditor /> : null}
      {tab === 'identity' ? <IdentityEditor /> : null}
      {tab === 'settings' ? <SettingsEditor /> : null}
    </>
  )
}
