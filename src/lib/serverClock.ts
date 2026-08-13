/**
 * Đồng hồ TIN CẬY cho các mốc giờ vận hành (tự chốt Ca 1 lúc 15:15, Ca 2 lúc 22:15).
 *
 * Không được dùng thẳng `Date.now()` của thiết bị: điện thoại ngoài quầy hay bị
 * lệch giờ/lệch múi giờ (máy Android cũ, máy vừa hết pin, máy đặt tay múi giờ).
 * Lệch 20 phút là ca đóng sớm/đóng muộn 20 phút — sai luôn cả ranh giới doanh
 * thu giữa hai ca. `/api/server-time` trả giờ máy chủ; ở đây chỉ lưu ĐỘ LỆCH rồi
 * cộng vào đồng hồ máy, nên không phải gọi mạng mỗi lần xem giờ.
 *
 * Mất mạng thì quay về đồng hồ thiết bị: thà chốt lệch vài phút còn hơn không
 * bao giờ chốt.
 */
const SYNC_TTL_MS = 10 * 60_000
const SYNC_TIMEOUT_MS = 3_500
/** Lệch dưới ngưỡng này coi như đồng hồ máy đúng — tránh nhiễu do độ trễ mạng. */
const IGNORE_OFFSET_MS = 1_500

let offsetMs = 0
let lastSyncAt = 0
let inflight: Promise<number> | null = null

/** Giờ hiện tại theo máy chủ (đồng hồ máy + độ lệch đã đo được). */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs)
}

/** Độ lệch đang áp dụng, tính bằng mili giây (dương = máy chậm hơn máy chủ). */
export function serverClockOffsetMs() {
  return offsetMs
}

/** Đã đo được độ lệch trong TTL gần đây hay chưa. */
export function serverClockFresh(now = Date.now()) {
  return lastSyncAt > 0 && now - lastSyncAt < SYNC_TTL_MS
}

/**
 * Đo lại độ lệch giờ. Gọi lặp lại thoải mái: trong TTL thì trả luôn giá trị cũ,
 * và hai lời gọi song song dùng chung một request.
 */
export async function syncServerClock(options: { force?: boolean } = {}): Promise<number> {
  if (!options.force && serverClockFresh()) return offsetMs
  if (inflight) return inflight
  inflight = measureOffset().finally(() => { inflight = null })
  return inflight
}

async function measureOffset(): Promise<number> {
  const controller = new AbortController()
  const timer = typeof window === 'undefined'
    ? setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)
    : window.setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const response = await fetch('/api/server-time', { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return offsetMs
    const payload = await response.json()
    const serverTime = new Date(payload?.now).getTime()
    if (!Number.isFinite(serverTime)) return offsetMs
    // Bù một nửa thời gian đi-về: giờ máy chủ được đọc ở giữa quãng request.
    const roundTrip = Date.now() - startedAt
    const measured = serverTime + roundTrip / 2 - Date.now()
    offsetMs = Math.abs(measured) < IGNORE_OFFSET_MS ? 0 : measured
    lastSyncAt = Date.now()
    return offsetMs
  } catch {
    // Offline/LAN: giữ độ lệch cũ (hoặc 0) và dùng đồng hồ thiết bị.
    return offsetMs
  } finally {
    if (typeof window === 'undefined') clearTimeout(timer as ReturnType<typeof setTimeout>)
    else window.clearTimeout(timer as number)
  }
}

/** Chỉ dùng cho kiểm thử: đặt lại trạng thái đồng hồ. */
export function resetServerClockForTest() {
  offsetMs = 0
  lastSyncAt = 0
  inflight = null
}
