/**
 * The user's profile, opened from the header avatar: who the app thinks you are,
 * and what is yours rather than the games' — so far, your vehicles. It also points
 * to where the rest of a profile's contents live today; they will be gathered here.
 */

import { useStore } from '../store'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Controls'
import { Card } from '../components/Tiles'
import { VehiclesEditor } from './profile/Vehicles'

/** Where the things a profile will hold are edited today. */
const LINKS = [
  { tab: 'identity', label: 'Identity', hint: 'Your name, and how the app recognizes you in an export.' },
  { tab: 'sports', label: 'Sports & gear', hint: 'The sports you officiate.' },
  { tab: 'settings', label: 'Settings', hint: 'Currency, appearance and time model.' },
] as const

export function Profile() {
  const { derived, navigate } = useStore()
  if (!derived) return null
  const name = derived.snapshot.identity.displayName.trim()

  return (
    <div className="flex flex-col gap-4">
      <Card title="Your profile">
        <div className="flex items-center gap-4">
          <Avatar displayName={name} size={64} />
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {name || 'No name set yet'}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {name
                ? 'Your display name, from Reference data → Identity.'
                : 'Add a display name under Reference data → Identity and your initials appear on the avatar.'}
            </span>
          </div>
        </div>
      </Card>

      <VehiclesEditor />

      <Card
        title="Coming to this page"
        subtitle="Your profile will gather your own preferences in one place. Until then, they are edited here:"
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {LINKS.map((l) => (
            <li key={l.tab} className="flex flex-wrap items-center gap-3 text-xs">
              <Button onClick={() => navigate({ view: 'reference', tab: l.tab, label: `Reference data → ${l.label}` })}>
                {l.label}
              </Button>
              <span style={{ color: 'var(--text-secondary)' }}>{l.hint}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
