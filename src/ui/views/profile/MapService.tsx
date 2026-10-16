/**
 * The map service: which one lookups go to, and the optional Google key. Lookups
 * are the only thing the app sends off this machine, so the card says exactly
 * what is sent, where, and when.
 */

import { useState } from 'react'
import { Button, selectStyle } from '../../components/Controls'
import { Card, StatusChip } from '../../components/Tiles'
import { getMapsKey, setMapsKey } from '../../../maps/maps'

export function MapServiceCard() {
  const [saved, setSaved] = useState(getMapsKey)
  const [draft, setDraft] = useState('')

  function save(next: string) {
    setMapsKey(next)
    setSaved(getMapsKey())
    setDraft('')
  }

  return (
    <Card
      title="Map service"
      subtitle="Finds a park's address from its name, and the driving distance between two addresses. Works without any setup, using OpenStreetMap."
      action={<StatusChip role="good" label={saved ? 'using Google Maps' : 'using OpenStreetMap'} />}
    >
      <p className="m-0 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        This is the only part of the app that sends anything off this machine. It happens only when you press a lookup
        button, and sends only that lookup: a park's name and city, or the two addresses of a route. With no key, that
        goes to OpenStreetMap's free public servers (Nominatim and OSRM), which are shared and occasionally slow or
        busy.
      </p>
      <p className="m-0 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        Optional: Google is better at finding a park by its name. Add a Google Maps Platform key, with the Places API
        (New) and the Routes API enabled, and lookups go to Google instead. The key is stored in this browser and is
        not included in backups.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {saved ? 'Replace the Google key' : 'Google Maps API key (optional)'}
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Map service API key"
            autoComplete="off"
            className="w-64 max-w-full rounded-md px-2 py-1 text-xs"
            style={selectStyle}
          />
        </label>
        <Button onClick={() => save(draft)} disabled={!draft.trim()}>
          Save key
        </Button>
        {saved ? (
          <Button variant="danger" onClick={() => save('')}>
            Remove key
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
