/**
 * The two map-service lookups for a park, shown while its card is unlocked: find
 * its address from its name, and get the drive from home.
 *
 * Nothing is sent until a button is pressed, and nothing is saved until the
 * result is accepted — a place search can match the wrong park.
 */

import { useState } from 'react'
import { Button } from '../../components/Controls'
import { findPlaces, getMapsKey, routeBetween, type PlaceMatch, type RouteResult } from '../../../maps/maps'
import type { Park } from '../../../model/reference'

export function ParkMapTools({
  park,
  homeLabel,
  homeAddress,
  onPatch,
}: {
  park: Park
  homeLabel: string
  homeAddress: string | undefined
  onPatch: (patch: Partial<Omit<Park, 'id'>>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<PlaceMatch[] | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const query = [park.name, park.city].filter(Boolean).join(', ')

  const lookUp = () =>
    run(async () => {
      setMatches(await findPlaces(query, getMapsKey()))
    })

  const measure = () =>
    run(async () => {
      const key = getMapsKey()
      let location = park.location
      // An address picked before positions were kept has none. Find the place
      // again by name, and if it is the same one, keep its position this time.
      if (!location && park.address) {
        const stored = park.address
        location = (await findPlaces(query, key).catch(() => [])).find(
          (m) => (m.address !== '' && m.address === stored) || (m.name !== '' && stored.startsWith(`${m.name}, `)),
        )?.location
        if (location) onPatch({ location })
      }
      setRoute(await routeBetween(homeAddress!, { address: park.address ?? park.name, location }, key))
    })

  const missing = !homeAddress
    ? `Add ${homeLabel}'s address on your profile to get the distance.`
    : !park.address && !park.location
      ? 'Look up or type an address to get the distance.'
      : null

  return (
    <div className="flex flex-col gap-2 rounded-md p-2" style={{ border: '1px dashed var(--border-hairline)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void lookUp()} disabled={busy}>
          Look up address
        </Button>
        <Button onClick={() => void measure()} disabled={busy || missing !== null}>
          Get distance from {homeLabel}
        </Button>
      </div>
      {missing ? <span style={{ color: 'var(--text-muted)' }}>{missing}</span> : null}
      {error ? (
        <span role="alert" style={{ color: 'var(--status-critical)' }}>
          {error}
        </span>
      ) : null}

      {matches ? (
        matches.length === 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>
            Nothing found for “{park.name}”. Try adding the city first, or type the address in.
          </span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {matches.map((m) => (
              <li key={`${m.name}|${m.address}|${m.area ?? ''}`} className="flex flex-col items-center justify-between gap-2">
                <span className="min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>
                  {m.name ? <strong>{m.name}: </strong> : null}
                  {m.address || m.area}
                  {m.address ? null : (
                    <span className="block" style={{ color: 'var(--text-muted)' }}>
                      Found on the map, with no street address on record. Its position is enough for distances; type
                      the address in if you want it shown.
                    </span>
                  )}
                </span>
                <span className="shrink-0">
                  <Button
                    onClick={() => {
                      // No address offered means none is written; one already typed stays.
                      onPatch(m.address ? { address: m.address, location: m.location } : { location: m.location })
                      setMatches(null)
                    }}
                  >
                    {m.address ? 'Use' : 'Use position'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {route ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="num-tabular" style={{ color: 'var(--text-primary)' }}>
            {route.miles} mi, {route.minutes} min one way, without traffic
          </span>
          <span className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                onPatch({ oneWayMiles: route.miles, oneWayDriveMinutes: route.minutes })
                setRoute(null)
              }}
            >
              Use these
            </Button>
            <Button onClick={() => setRoute(null)}>Dismiss</Button>
          </span>
        </div>
      ) : null}
    </div>
  )
}
