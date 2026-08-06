type ProviderSource = 'nominatim' | 'bigdatacloud'
/** `street` = có số nhà/tên đường; `area` = chỉ tới phường/quận/thành phố. */
type AddressPrecision = 'street' | 'area'
interface ProviderResult {
  address: string
  source: ProviderSource
  precision: AddressPrecision
}

// Nominatim là nguồn DUY NHẤT trả được số nhà + tên đường; BigDataCloud chỉ có
// phường/thành phố. Trước đây hai nguồn chạy đua và bản thô thường thắng, nên bản
// ghi chấm công hay chỉ ghi "Nha Trang, Khánh Hòa" — không đủ để biết nhân viên
// đứng ở quầy nào. Nay nguồn chi tiết được ưu tiên trong một khoảng chờ có giới hạn,
// bản thô chỉ dùng khi nguồn chi tiết hỏng/quá hạn.
const DETAILED_PROVIDER_TIMEOUT_MS = 4000
const DETAILED_PROVIDER_GRACE_MS = 3000
const FALLBACK_PROVIDER_TIMEOUT_MS = 4000

export default async function handler(request: any, response: any) {
  const latitude = Number(request.query?.lat)
  const longitude = Number(request.query?.lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return response.status(400).json({ error: 'Tọa độ không hợp lệ.' })
  }
  const detailedAddress = concreteProviderResult('nominatim', reverseWithNominatim(latitude, longitude))
  const fallbackAddress = concreteProviderResult('bigdatacloud', reverseWithBigDataCloud(latitude, longitude))
  // Không để promise nào unhandled khi nhánh kia thắng.
  detailedAddress.catch(() => null)
  fallbackAddress.catch(() => null)
  const result = await preferDetailedProviderResult(detailedAddress, fallbackAddress)
  if (result) {
    // Chỉ cache lâu bản đã tới số nhà. Cache một ngày cho bản thô nghĩa là mọi lần
    // chấm công sau tại đúng toạ độ đó cũng chỉ còn địa chỉ thô.
    response.setHeader(
      'Cache-Control',
      result.precision === 'street'
        ? 's-maxage=86400, stale-while-revalidate=604800'
        : 's-maxage=60',
    )
    return response.status(200).json(result)
  }
  return response.status(502).json({ error: 'Chưa lấy được địa chỉ cụ thể từ vị trí này.' })
}

async function preferDetailedProviderResult(
  detailedAddress: Promise<ProviderResult>,
  fallbackAddress: Promise<ProviderResult>,
): Promise<ProviderResult | null> {
  // Chờ nguồn chi tiết trước, có hạn. Nguồn thô đã chạy song song nên phần chờ này
  // không cộng thêm thời gian khi nguồn chi tiết hỏng ngay.
  const detailed = await Promise.race([
    detailedAddress.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DETAILED_PROVIDER_GRACE_MS)),
  ])
  if (detailed && detailed.precision === 'street') return detailed
  const fallback = await fallbackAddress.catch(() => null)
  // Nguồn chi tiết dù chỉ tới phường vẫn cụ thể hơn nguồn thô (thường chỉ có thành phố).
  return detailed || fallback
}

async function concreteProviderResult(source: ProviderSource, request: Promise<ProviderResult>) {
  const result = await request
  if (!result.address || isCoordinateOnly(result.address)) {
    throw new Error('Provider did not return a concrete address')
  }
  return { ...result, source }
}

async function reverseWithNominatim(latitude: number, longitude: number): Promise<ProviderResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DETAILED_PROVIDER_TIMEOUT_MS)
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    // zoom 18 = mức toà nhà/số nhà, mức chi tiết nhất Nominatim trả về.
    url.searchParams.set('zoom', '18')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'vi')
    const result = await fetch(url, {
      headers: { 'User-Agent': 'GUSTINO-Operations/1.0' },
      signal: controller.signal,
    })
    if (!result.ok) throw new Error('Reverse geocoding failed')
    const payload = await result.json()
    const address = formatAdministrativeAddress(payload?.address, payload?.display_name)
    return {
      address,
      source: 'nominatim',
      precision: hasStreetDetail(payload?.address, payload?.name) ? 'street' : 'area',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function reverseWithBigDataCloud(latitude: number, longitude: number): Promise<ProviderResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FALLBACK_PROVIDER_TIMEOUT_MS)
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
    const uniqueParts = parts.filter((value: string, index: number) => parts.indexOf(value) === index)
    return { address: uniqueParts.join(', '), source: 'bigdatacloud', precision: 'area' }
  } finally {
    clearTimeout(timeout)
  }
}

/** Có số nhà hoặc tên đường/toà nhà cụ thể thì mới coi là "tới số nhà". */
function hasStreetDetail(address: Record<string, string> | undefined, name: string | undefined) {
  if (!address) return false
  return Boolean(
    address.house_number
    || address.road
    || address.pedestrian
    || address.footway
    || address.path
    || address.building
    || address.shop
    || address.amenity
    || (name && name.trim()),
  )
}

/**
 * Sáp nhập hành chính 2025 xoá tên thành phố cũ khỏi dữ liệu bản đồ: điểm tại
 * Vũng Tàu giờ chỉ còn "Phường Tam Thắng, Thành phố Hồ Chí Minh" — đúng đơn vị
 * mới nhưng người đối chiếu chấm công đọc thành "lệch thành phố". Khôi phục địa
 * danh quen thuộc từ tên phường mới (danh sách phường chính thức sau sáp nhập
 * của hai đô thị nơi có chi nhánh).
 */
const WARD_LOCALITY: Record<string, string> = {
  'Phường Vũng Tàu': 'Vũng Tàu',
  'Phường Tam Thắng': 'Vũng Tàu',
  'Phường Rạch Dừa': 'Vũng Tàu',
  'Phường Phước Thắng': 'Vũng Tàu',
  'Xã Long Sơn': 'Vũng Tàu',
  'Phường Nha Trang': 'Nha Trang',
  'Phường Bắc Nha Trang': 'Nha Trang',
  'Phường Tây Nha Trang': 'Nha Trang',
  'Phường Nam Nha Trang': 'Nha Trang',
}

function formatAdministrativeAddress(address: Record<string, string> | undefined, displayName: string | undefined) {
  if (!address) return displayName || ''
  const displayParts = (displayName || '').split(',').map((part) => part.trim()).filter(Boolean)
  const street = [address.house_number, address.road || address.pedestrian || address.footway || address.path].filter(Boolean).join(' ')
  // Toà nhà/cửa hàng (Lotte Mart, Gold Coast…) là mốc dễ đối chiếu nhất với quầy
  // thực tế, nên đứng trước số nhà nếu OSM có ghi.
  const place = address.building || address.shop || address.mall || address.amenity || ''
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
  const locality = WARD_LOCALITY[(ward || '').trim()]
    || WARD_LOCALITY[(district || '').trim()]
    || ''
  // Khi đã có địa danh quen thuộc (Vũng Tàu) thì bỏ "Thành phố Hồ Chí Minh" của
  // đơn vị sáp nhập — giữ lại chỉ gây đọc nhầm là chấm công ở TP.HCM. Địa chỉ
  // tại TP.HCM thật (không có locality nào khớp) vẫn giữ nguyên tên thành phố.
  const cityDisplay = locality && city === 'Thành phố Hồ Chí Minh' ? '' : city
  const parts = [place, street, ward, locality, district, cityDisplay].filter((value, index, items) =>
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
