import { describe, expect, it } from 'vitest'
import { MapServiceError, findPlaces, mapsProviderName, routeBetween } from './maps'

type Call = { url: string; headers: Record<string, string>; body: unknown }

/** A stand-in for `fetch` that records each request and answers from `answer`. */
function fake(answer: (url: string) => unknown, status = 200) {
  const calls: Call[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })
    return new Response(JSON.stringify(answer(url)), { status })
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

/** Records the waits asked for instead of sleeping. */
function clock() {
  const waits: number[] = []
  return { waits, wait: async (ms: number) => void waits.push(ms) }
}

describe('with no key: OpenStreetMap', () => {
  it('searches Nominatim and returns a street address with the place’s position', async () => {
    const { calls, fetcher } = fake(() => [
      {
        name: 'Riverbend Community Park',
        display_name: 'Riverbend Community Park, 7001, Example Parkway, Springfield, Example County, Texas, 75070, United States',
        lat: '1',
        lon: '2',
        address: {
          house_number: '7001',
          road: 'Example Parkway',
          city: 'Springfield',
          county: 'Example County',
          state: 'Texas',
          postcode: '75070',
          country: 'United States',
        },
      },
    ])
    const found = await findPlaces('Riverbend Community Park, Springfield', '', fetcher, 3, clock().wait)
    expect(found).toEqual([
      {
        name: 'Riverbend Community Park',
        address: '7001 Example Parkway, Springfield, Texas 75070',
        area: 'Springfield, Texas',
        location: { lat: 1, lon: 2 },
      },
    ])
    expect(calls[0]!.url).toContain('nominatim.openstreetmap.org/search')
    expect(new URL(calls[0]!.url).searchParams.get('q')).toBe('Riverbend Community Park, Springfield')
    expect(calls[0]!.headers).toEqual({})
  })

  it('offers no address, only the position, when the place has no street on record', async () => {
    // "363, Springfield, Texas 75019" is not an address anyone could use.
    const { fetcher } = fake(() => [
      {
        name: 'Hilltop Fields',
        display_name: 'Hilltop Fields, 363, Springfield, Example County, Texas, 75019, United States',
        lat: '3',
        lon: '4',
        address: { house_number: '363', town: 'Springfield', county: 'Example County', state: 'Texas', postcode: '75019' },
      },
    ])
    expect(await findPlaces('x', '', fetcher, 3, clock().wait)).toEqual([
      { name: 'Hilltop Fields', address: '', area: 'Springfield, Texas', location: { lat: 3, lon: 4 } },
    ])
  })

  it('geocodes both ends, then routes with OSRM, longitude first', async () => {
    const { calls, fetcher } = fake((url) => {
      if (url.includes('router.project-osrm.org')) return { code: 'Ok', routes: [{ distance: 19956, duration: 1089 }] }
      return new URL(url).searchParams.get('q') === '12 Example St'
        ? [{ display_name: 'home', lat: '40.1', lon: '-88.2' }]
        : [{ display_name: 'park', lat: '40.3', lon: '-88.4' }]
    })
    const route = await routeBetween('12 Example St', '900 Field Rd', '', fetcher, clock().wait)
    expect(route).toEqual({ miles: 12.4, minutes: 18 })
    expect(calls).toHaveLength(3)
    expect(calls[2]!.url).toContain('/driving/-88.2,40.1;-88.4,40.3?overview=false')
  })

  it('routes from saved coordinates without searching for that end again', async () => {
    // A place's descriptive address often cannot be found a second time.
    const { calls, fetcher } = fake((url) => {
      if (url.includes('osrm')) return { code: 'Ok', routes: [{ distance: 19956, duration: 1089 }] }
      return new URL(url).searchParams.get('q') === '12 Example St' ? [{ display_name: 'home', lat: '40.1', lon: '-88.2' }] : []
    })
    const park = { address: 'Riverbend Park West, 363, Springfield, Example County', location: { lat: 40.3, lon: -88.4 } }
    expect(await routeBetween('12 Example St', park, '', fetcher, clock().wait)).toEqual({ miles: 12.4, minutes: 18 })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toContain('/driving/-88.2,40.1;-88.4,40.3')
  })

  it('spaces Nominatim calls at least a second apart', async () => {
    const { fetcher } = fake(() => [{ display_name: 'x', lat: '1', lon: '2' }])
    const { waits, wait } = clock()
    await findPlaces('a', '', fetcher, 1, wait)
    await findPlaces('b', '', fetcher, 1, wait)
    expect(waits.at(-1)).toBeGreaterThan(900)
  })

  it('names the address it could not find', async () => {
    const { fetcher } = fake(() => [])
    await expect(routeBetween('nowhere at all', 'b', '', fetcher, clock().wait)).rejects.toThrow(
      /could not find "nowhere at all"/,
    )
  })

  it('says so when OSRM has no route', async () => {
    const { fetcher } = fake((url) =>
      url.includes('osrm') ? { code: 'NoRoute', routes: [] } : [{ display_name: 'x', lat: '1', lon: '2' }],
    )
    await expect(routeBetween('a', 'b', '', fetcher, clock().wait)).rejects.toThrow(/No driving route/)
  })
})

describe('with a key: Google Maps', () => {
  it('sends the query under the key and returns names with addresses', async () => {
    const { calls, fetcher } = fake(() => ({
      places: [
        { displayName: { text: 'Cedar Ridge Softball Complex' }, formattedAddress: '900 Field Rd, Springfield' },
        { displayName: { text: 'No address here' } },
      ],
    }))
    const found = await findPlaces('Cedar Ridge Softball Springfield', 'k-123', fetcher)
    expect(found).toEqual([{ name: 'Cedar Ridge Softball Complex', address: '900 Field Rd, Springfield' }])
    expect(calls[0]!.headers['X-Goog-FieldMask']).toContain('places.location')
    expect(calls[0]!.url).toContain('places:searchText')
    expect(calls[0]!.headers['X-Goog-Api-Key']).toBe('k-123')
    expect(calls[0]!.body).toMatchObject({ textQuery: 'Cedar Ridge Softball Springfield' })
  })

  it('asks for a traffic-unaware drive and converts to miles and minutes', async () => {
    const { calls, fetcher } = fake(() => ({ routes: [{ distanceMeters: 19956, duration: '1089s' }] }))
    const route = await routeBetween('12 Example St', '900 Field Rd', 'k', fetcher)
    expect(route).toEqual({ miles: 12.4, minutes: 18 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.body).toMatchObject({
      origin: { address: '12 Example St' },
      destination: { address: '900 Field Rd' },
      routingPreference: 'TRAFFIC_UNAWARE',
    })
    await routeBetween('12 Example St', { address: 'x', location: { lat: 40.3, lon: -88.4 } }, 'k', fetcher)
    expect(calls[1]!.body).toMatchObject({ destination: { location: { latLng: { latitude: 40.3, longitude: -88.4 } } } })
  })

  it('passes on the service’s own reason for a refusal', async () => {
    const { fetcher } = fake(() => ({ error: { message: 'API key not valid.' } }), 403)
    await expect(routeBetween('a', 'b', 'bad', fetcher)).rejects.toThrow(/403.*API key not valid/)
  })
})

describe('either way', () => {
  it('names the provider a lookup will use', () => {
    expect(mapsProviderName('')).toBe('OpenStreetMap')
    expect(mapsProviderName('k')).toBe('Google Maps')
  })

  it('reports a network failure plainly', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(findPlaces('x', '', down, 3, clock().wait)).rejects.toBeInstanceOf(MapServiceError)
    await expect(findPlaces('x', 'k', down)).rejects.toThrow(/Could not reach/)
  })

  it('asks for patience when told to slow down', async () => {
    const { fetcher } = fake(() => ({}), 429)
    await expect(findPlaces('x', '', fetcher, 3, clock().wait)).rejects.toThrow(/slow down/)
  })
})
