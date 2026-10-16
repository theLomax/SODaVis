/**
 * The map service: the one place the app talks to the outside world.
 *
 * Everything else here runs in the browser and sends nothing anywhere. These two
 * calls are the exception, and only ever happen on a button press: finding a
 * place's address from its name, and the driving distance between two addresses.
 * Each sends the text it is given — a park's name, a home address.
 *
 * With no key they go to OpenStreetMap's public servers: Nominatim for search,
 * and OSRM for the route, which needs coordinates and so geocodes both ends
 * first. Those servers are free and shared, so Nominatim calls are spaced at
 * least a second apart, as its usage policy asks. With a Google Maps Platform
 * key set, both calls go to Google instead, which is better at finding a park by
 * name.
 *
 * The key is kept in `localStorage`, not IndexedDB, so it is never written into a
 * backup file. `fetch` and the wait are parameters so the calls can be tested
 * without a network or a clock.
 */

export type Coordinates = { lat: number; lon: number }

export type PlaceMatch = {
  name: string
  /** A street address, or '' when the service has the place but no street for it. */
  address: string
  /** Town and region, to tell two places of the same name apart when there is no address. */
  area?: string
  /** Where the place is, to keep with the address so a route need not search for it again. */
  location?: Coordinates
}

/** One end of a route: an address, with its coordinates when they are already known. */
export type RouteEnd = string | { address: string; location?: Coordinates | undefined }

function addressOf(end: RouteEnd): string {
  return typeof end === 'string' ? end : end.address
}

function locationOf(end: RouteEnd): Coordinates | undefined {
  return typeof end === 'string' ? undefined : end.location
}

function toCoordinates(lat: unknown, lon: unknown): Coordinates | undefined {
  const point = { lat: Number(lat), lon: Number(lon) }
  return lat != null && lon != null && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? point : undefined
}

export type RouteResult = {
  /** One-way driving distance. */
  miles: number
  /** One-way drive in free-flowing traffic: the app's "ideal" figure. */
  minutes: number
}

/** A failure worth showing as it is: a refused key, nothing found, no connection. */
export class MapServiceError extends Error {}

type Fetch = typeof fetch
type Wait = (ms: number) => Promise<void>

const KEY_STORAGE = 'mapsApiKey'
const GOOGLE_PLACES = 'https://places.googleapis.com/v1/places:searchText'
const GOOGLE_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const NOMINATIM_SPACING_MS = 1100
const METERS_PER_MILE = 1609.344

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function getMapsKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? ''
}

export function setMapsKey(key: string): void {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim())
  else localStorage.removeItem(KEY_STORAGE)
}

/** Which service a lookup will go to, for telling the user before they press. */
export function mapsProviderName(key: string = getMapsKey()): string {
  return key.trim() ? 'Google Maps' : 'OpenStreetMap'
}

function toResult(meters: number, seconds: number): RouteResult {
  return { miles: Math.round((meters / METERS_PER_MILE) * 10) / 10, minutes: Math.round(seconds / 60) }
}

function noRoute(origin: string, destination: string): MapServiceError {
  return new MapServiceError(`No driving route found from "${origin}" to "${destination}". Check both addresses.`)
}

async function request(url: string, init: RequestInit | undefined, fetcher: Fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, init)
  } catch {
    throw new MapServiceError('Could not reach the map service. Check the connection and try again.')
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const body = data as { error?: { message?: string } | string; message?: string } | null
    const detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message)
    throw new MapServiceError(
      response.status === 429
        ? 'The map service is busy and asked to slow down. Wait a minute and try again.'
        : `The map service refused the request (${response.status})${detail ? `: ${detail}` : '.'}`,
    )
  }
  return data
}

// ---------------------------------------------------------------------------
// OpenStreetMap: Nominatim and OSRM, no key
// ---------------------------------------------------------------------------

type NominatimPlace = {
  name?: string
  display_name?: string
  lat?: string
  lon?: string
  address?: Record<string, string | undefined>
}

/**
 * A street address from a Nominatim result: "7001 Example Rd, Springfield, Texas
 * 75070". Empty when the result has no street, as most parks on OpenStreetMap do:
 * a number and a town without a street is not an address, and offering it as one
 * would be wrong. The place's position is still exact.
 */
function nominatimAddress(place: NominatimPlace): string {
  const a = place.address ?? {}
  if (!a.road) return ''
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality
  const region = [a.state, a.postcode].filter(Boolean).join(' ')
  return [[a.house_number, a.road].filter(Boolean).join(' '), town, region].filter(Boolean).join(', ')
}

function nominatimArea(place: NominatimPlace): string {
  const a = place.address ?? {}
  return [a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality, a.state].filter(Boolean).join(', ')
}

let lastNominatimCall = 0

async function nominatim(query: string, limit: number, fetcher: Fetch, wait: Wait): Promise<NominatimPlace[]> {
  const due = lastNominatimCall + NOMINATIM_SPACING_MS - Date.now()
  if (due > 0) await wait(due)
  lastNominatimCall = Date.now()
  const url = `${NOMINATIM}?${new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: String(limit) })}`
  const data = await request(url, undefined, fetcher)
  return Array.isArray(data) ? (data as NominatimPlace[]) : []
}

/** "lon,lat", as OSRM wants it: from the saved position, or else by searching the address. */
async function coordinatesOf(end: RouteEnd, fetcher: Fetch, wait: Wait): Promise<string> {
  const known = locationOf(end)
  if (known) return `${known.lon},${known.lat}`
  const [place] = await nominatim(addressOf(end), 1, fetcher, wait)
  const found = toCoordinates(place?.lat, place?.lon)
  if (!found) {
    throw new MapServiceError(
      `OpenStreetMap could not find "${addressOf(end)}". Use a plain street address (number, street, city, state), or pick the place from Look up address.`,
    )
  }
  return `${found.lon},${found.lat}`
}

async function osmRoute(originEnd: RouteEnd, destinationEnd: RouteEnd, fetcher: Fetch, wait: Wait): Promise<RouteResult> {
  const origin = addressOf(originEnd)
  const destination = addressOf(destinationEnd)
  const from = await coordinatesOf(originEnd, fetcher, wait)
  const to = await coordinatesOf(destinationEnd, fetcher, wait)
  const data = (await request(`${OSRM}/${from};${to}?overview=false`, undefined, fetcher)) as {
    code?: string
    routes?: { distance?: number; duration?: number }[]
  } | null
  const route = data?.routes?.[0]
  if (data?.code !== 'Ok' || route?.distance == null || route.duration == null) throw noRoute(origin, destination)
  return toResult(route.distance, route.duration)
}

// ---------------------------------------------------------------------------
// Google Maps Platform, with the user's key
// ---------------------------------------------------------------------------

function google(url: string, key: string, fieldMask: string, body: unknown, fetcher: Fetch): Promise<unknown> {
  return request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key.trim(), 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
    },
    fetcher,
  )
}

function googleWaypoint(end: RouteEnd): unknown {
  const known = locationOf(end)
  return known ? { location: { latLng: { latitude: known.lat, longitude: known.lon } } } : { address: addressOf(end) }
}

async function googleRoute(originEnd: RouteEnd, destinationEnd: RouteEnd, key: string, fetcher: Fetch): Promise<RouteResult> {
  const origin = addressOf(originEnd)
  const destination = addressOf(destinationEnd)
  const data = (await google(
    GOOGLE_ROUTES,
    key,
    'routes.distanceMeters,routes.duration',
    {
      origin: googleWaypoint(originEnd),
      destination: googleWaypoint(destinationEnd),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    },
    fetcher,
  )) as { routes?: { distanceMeters?: number; duration?: string }[] } | null
  const route = data?.routes?.[0]
  const seconds = Number.parseFloat(route?.duration ?? '')
  if (!route || route.distanceMeters == null || !Number.isFinite(seconds)) throw noRoute(origin, destination)
  return toResult(route.distanceMeters, seconds)
}

function withLocation(match: PlaceMatch, location: Coordinates | undefined): PlaceMatch {
  return location ? { ...match, location } : match
}

// ---------------------------------------------------------------------------
// The two lookups
// ---------------------------------------------------------------------------

/**
 * Places matching a free-text query, best first: "Cedar Ridge Softball Complex
 * Springfield". Returns at most `limit`; an empty list means nothing was found.
 * An empty `key` searches OpenStreetMap.
 */
export async function findPlaces(
  query: string,
  key: string,
  fetcher: Fetch = fetch,
  limit = 3,
  wait: Wait = sleep,
): Promise<PlaceMatch[]> {
  if (!key.trim()) {
    return (await nominatim(query, limit, fetcher, wait))
      .filter((p) => p.display_name && toCoordinates(p.lat, p.lon))
      .map((p) =>
        withLocation(
          { name: p.name ?? '', address: nominatimAddress(p), area: nominatimArea(p) },
          toCoordinates(p.lat, p.lon),
        ),
      )
  }
  const data = (await google(
    GOOGLE_PLACES,
    key,
    'places.displayName,places.formattedAddress,places.location',
    { textQuery: query, pageSize: limit },
    fetcher,
  )) as {
    places?: {
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude?: number; longitude?: number }
    }[]
  } | null
  return (data?.places ?? [])
    .filter((p) => p.formattedAddress)
    .slice(0, limit)
    .map((p) =>
      withLocation(
        { name: p.displayName?.text ?? '', address: p.formattedAddress! },
        toCoordinates(p.location?.latitude, p.location?.longitude),
      ),
    )
}

/**
 * The one-way drive from one place to another, ignoring traffic — the ideal
 * figure a park stores. An end with known coordinates is routed from those; one
 * with only an address is searched for first. Throws when an address cannot be
 * found or no route joins the two. An empty `key` routes with OpenStreetMap.
 */
export async function routeBetween(
  origin: RouteEnd,
  destination: RouteEnd,
  key: string,
  fetcher: Fetch = fetch,
  wait: Wait = sleep,
): Promise<RouteResult> {
  return key.trim() ? googleRoute(origin, destination, key, fetcher) : osmRoute(origin, destination, fetcher, wait)
}
