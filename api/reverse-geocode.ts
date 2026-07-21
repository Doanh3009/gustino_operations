export default async function handler(request: any, response: any) {
  const latitude = Number(request.query?.lat)
  const longitude = Number(request.query?.lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return response.status(400).json({ error: 'Tọa độ không hợp lệ.' })
  }
  // Start both approved providers together. Prefer the street-level source
  // for a short grace period, then use the faster administrative fallback so
  // attendance never returns to the old sequential 10-second wait.
  const detailedAddress = concreteProviderResult('nominatim', reverseWithNominatim(latitude, longitude))
  const fallbackAddress = concreteProviderResult('bigdatacloud', reverseWithBigDataCloud(latitude, longitude))
  const result = await preferDetailedProviderResult(detailedAddress, fallbackAddress)
  if (result) {
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    return response.status(200).json(result)
  }
  return response.status(502).json({ error: 'Chưa lấy được địa chỉ cụ thể từ vị trí này.' })
}

async function preferDetailedProviderResult(
  detailedAddress: Promise<{ address: string; source: 'nominatim' | 'bigdatacloud' }>,
  fallbackAddress: Promise<{ address: string; source: 'nominatim' | 'bigdatacloud' }>,
) {
  const first = await Promise.any([detailedAddress, fallbackAddress]).catch(() => null)
  if (!first || first.source === 'nominatim') return first
  const preferred = await Promise.race([
    detailedAddress.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
  ])
  return preferred || first
}

async function concreteProviderResult(source: 'nominatim' | 'bigdatacloud', request: Promise<string>) {
  const address = await request
  if (!address || isCoordinateOnly(address)) throw new Error('Provider did not return a concrete address')
  return { address, source }
}

async function reverseWithNominatim(latitude: number, longitude: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('zoom', '18')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'vi')
    const result = await fetch(url, {
      headers: { 'User-Agent': 'GUSTINO-Operations/1.0' },
      signal: controller.signal,
    })
    if (!result.ok) throw new Error('Reverse geocoding failed')
    const payload = await result.json()
    return formatAdministrativeAddress(payload?.address, payload?.display_name)
  } finally {
    clearTimeout(timeout)
  }
}

async function reverseWithBigDataCloud(latitude: number, longitude: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
    url.searchParams.set('latitude', String(latitude))
    url.searchParams.set('longitude', String(longitude))
    url.searchParams.set('localityLanguage', 'vi')
    const result = await fetch(url, { signal: controller.signal })
    if (!result.ok) throw new Error('BigDataCloud reverse geocoding failed')
    const payload = await result.json()
    const parts = [
      payload.locality,
      payload.city,
      payload.principalSubdivision,
      payload.countryName,
    ].filter(Boolean)
    const uniqueParts = parts.filter((value, index) => parts.indexOf(value) === index)
    return uniqueParts.join(', ')
  } finally {
    clearTimeout(timeout)
  }
}

function formatAdministrativeAddress(address: Record<string, string> | undefined, displayName: string | undefined) {
  if (!address) return displayName || ''
  const displayParts = (displayName || '').split(',').map((part) => part.trim()).filter(Boolean)
  const street = [address.house_number, address.road || address.pedestrian || address.footway || address.path].filter(Boolean).join(' ')
  const ward = pickVietnamAdminPart(displayParts, /^(Phường|Xã|Thị trấn)\s/i)
    || address.suburb
    || address.quarter
    || address.neighbourhood
    || address.hamlet
    || address.village
    || address.subdistrict
  const district = address.city_district
    || address.district
    || pickVietnamAdminPart(displayParts, /^(Quận|Huyện|Thị xã)\s/i)
    || address.municipality
  const city = address.city
    || address.province
    || address.state
    || pickVietnamAdminPart(displayParts, /^(Thành phố|Tỉnh)\s/i)
    || address.region
  const parts = [street, ward, district, city].filter((value, index, items) =>
    value && items.indexOf(value) === index,
  )
  return parts.length ? parts.join(', ') : displayName || ''
}

function pickVietnamAdminPart(parts: string[], pattern: RegExp) {
  return parts.find((part) => pattern.test(part))
}

function isCoordinateOnly(value: string) {
  return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value.trim())
}
