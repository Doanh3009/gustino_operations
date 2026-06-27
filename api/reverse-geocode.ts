export default async function handler(request: any, response: any) {
  const latitude = Number(request.query?.lat)
  const longitude = Number(request.query?.lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return response.status(400).json({ error: 'Tọa độ không hợp lệ.' })
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('accept-language', 'vi')
    const result = await fetch(url, {
      headers: { 'User-Agent': 'GUSTINO-Operations/1.0' },
      signal: controller.signal,
    })
    if (!result.ok) throw new Error('Reverse geocoding failed')
    const payload = await result.json()
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    return response.status(200).json({
      address: payload.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    })
  } catch {
    return response.status(200).json({ address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` })
  } finally {
    clearTimeout(timeout)
  }
}
