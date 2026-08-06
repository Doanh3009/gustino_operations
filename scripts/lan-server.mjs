import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

try {
  process.loadEnvFile?.('.env.local')
} catch {
  // Local secrets are optional. The Zalo route returns a clear setup error when absent.
}

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'dist')
const dataDir = process.env.GUSTINO_DATA_DIR ? resolve(root, process.env.GUSTINO_DATA_DIR) : join(root, 'data')
const dataFile = join(dataDir, 'lan-store.json')
const selfieDir = join(dataDir, 'attendance-selfies')
const shiftProofDir = join(dataDir, 'shift-proofs')
const port = Number(process.env.GUSTINO_API_PORT || 5177)
const scrypt = promisify(scryptCallback)
const N8N_WEBHOOK_TIMEOUT_MS = 20_000
const N8N_ERROR_DETAIL_MAX_CHARS = 240

async function n8nWebhookError(webhookResponse, webhookToken) {
  let detail = ''
  try {
    const responseText = (await webhookResponse.text()).slice(0, 8_192).trim()
    if (responseText.startsWith('{')) {
      const payload = JSON.parse(responseText)
      const candidate = payload?.message ?? payload?.error ?? payload?.description
      detail = typeof candidate === 'string'
        ? candidate
        : typeof candidate?.message === 'string' ? candidate.message : ''
    }
  } catch {
    detail = ''
  }
  if (detail && webhookToken) detail = detail.split(webhookToken).join('[đã ẩn]')
  detail = detail.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, N8N_ERROR_DETAIL_MAX_CHARS)

  if (webhookResponse.status === 403) {
    return 'Webhook n8n từ chối xác thực (HTTP 403). Đặt Header Auth Name là x-gustino-token, Value trùng N8N_REPORT_WEBHOOK_TOKEN; kiểm tra IP Whitelist rồi Publish workflow.'
  }
  const base = webhookResponse.status === 500
    ? 'Workflow n8n lỗi HTTP 500.'
    : `Webhook n8n trả lỗi HTTP ${webhookResponse.status}.`
  return detail
    ? `${base} Chi tiết n8n: ${detail} Mở n8n > Executions để xem node lỗi.`
    : `${base} Mở n8n > Executions để xem node lỗi.`
}

function n8nImmediateOnlyAck(responseText, payload) {
  const message = typeof payload?.message === 'string' ? payload.message : responseText
  return /workflow\s+(?:got|was|has been)\s+started/i.test(message)
}

async function n8nCompletedIngestion(webhookResponse, expectedJobKey) {
  const responseText = (await webhookResponse.text()).slice(0, 8_192).trim()
  if (!responseText) {
    return {
      ok: false,
      code: 'N8N_EMPTY_ACK',
      error: 'n8n trả HTTP 200 nhưng response rỗng, chưa xác nhận đã ghi Sheet. Đặt Respond = When Last Node Finishes và để node Sheet trả JSON có job_key, row_number.',
    }
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    return {
      ok: false,
      code: 'N8N_INVALID_ACK',
      error: 'n8n trả HTTP 200 nhưng response không phải JSON, chưa xác nhận đã ghi Sheet. Node cuối phải trả job_key và row_number.',
    }
  }

  if (n8nImmediateOnlyAck(responseText, payload)) {
    return {
      ok: false,
      code: 'N8N_EARLY_ACK',
      error: 'n8n mới chỉ xác nhận bắt đầu workflow, chưa xác nhận Drive/Sheet. Đặt Webhook Respond = When Last Node Finishes, lưu và Publish workflow rồi thử lại.',
    }
  }

  const entries = (Array.isArray(payload) ? payload : [payload])
    .flatMap((item) => [item, item?.json, item?.data])
    .filter(Boolean)
  const matchedRow = entries.find((item) => {
    const hasRowNumber = item?.row_number !== undefined
      && item?.row_number !== null
      && String(item.row_number).trim() !== ''
    const hasReadyStatus = String(item?.status || '').toUpperCase() === 'READY'
    return String(item?.job_key || '') === expectedJobKey && (hasRowNumber || hasReadyStatus)
  })

  return matchedRow
    ? { ok: true, rowNumber: matchedRow.row_number, status: matchedRow.status }
    : {
        ok: false,
        code: 'N8N_SHEET_NOT_CONFIRMED',
        error: 'n8n trả HTTP 200 nhưng chưa xác nhận đã ghi Sheet cho đúng job_key. Node Sheet phải trả đúng job_key cùng row_number hoặc status READY.',
      }
}

function currentVietnamTimestamp(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1_000).toISOString().replace('Z', '+07:00')
}

function currentVietnamDateKey(now = new Date()) {
  return currentVietnamTimestamp(now).slice(0, 10)
}

const ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX = '[CHỐT HÀNH CHÍNH] [LỖI QUÊN CHECK-OUT]'

/**
 * LAN không có Vercel cron, nên tự đối soát trước mỗi lượt đọc/check-in.
 * Chỉ ca thuộc ngày đã qua và đã hết giờ theo lịch mới được đóng; ca qua đêm
 * vẫn chờ tới đúng giờ tan ca. Toàn bộ thay đổi diễn ra đồng bộ trước persist,
 * vì vậy nhiều request cùng lúc đều nhìn thấy cùng một trạng thái đã đóng.
 * BUG-130: không có nhánh skip vĩnh viễn — phiên ngày cũ còn mở sẽ khóa
 * Check-in của nhân viên đó mãi (luật một-phiên-mở). Check-in sau giờ tan ca
 * đóng bằng đúng thời điểm check-in (0 giờ công); ca mở >18h đóng theo giờ
 * tan ca, cả hai mang lý do riêng để Admin rà soát.
 */
function autoCloseStaleAttendanceRecords(now = new Date()) {
  const today = currentVietnamDateKey(now)
  let closed = 0
  for (const record of store.attendanceRecords) {
    if (record.checkOutTime) continue
    const registration = store.shiftRegistrations.find((item) => item.id === record.shiftRegistrationId)
    if (!registration || registration.workDate >= today) continue
    const overnight = registration.endTime <= registration.startTime
    const endDate = overnight ? addVietnamDateKeyDays(registration.workDate, 1) : registration.workDate
    const scheduledEnd = new Date(`${endDate}T${normalizeAttendanceTime(registration.endTime)}+07:00`)
    const checkIn = new Date(record.checkInTime)
    if (Number.isNaN(scheduledEnd.getTime())
      || Number.isNaN(checkIn.getTime())
      || scheduledEnd > now) continue
    let closeAt = scheduledEnd
    let reasonText = 'Hệ thống tự đóng theo giờ tan ca của lịch đăng ký; Admin cần rà soát và chỉnh lại nếu giờ thực tế khác.'
    if (checkIn.getTime() >= scheduledEnd.getTime()) {
      closeAt = checkIn
      reasonText = 'Check-in sau giờ tan ca của lịch đăng ký nên hệ thống đóng ngay tại thời điểm check-in (0 giờ công); Admin cần rà soát và chỉnh lại nếu giờ thực tế khác.'
    } else if (scheduledEnd.getTime() - checkIn.getTime() > 18 * 60 * 60 * 1000) {
      reasonText = 'Ca mở dài bất thường (hơn 18 giờ) nên hệ thống đóng theo giờ tan ca của lịch đăng ký; Admin cần rà soát và chỉnh lại nếu giờ thực tế khác.'
    }
    record.checkOutTime = closeAt.toISOString()
    record.checkOutSelfieUrl = undefined
    record.checkOutLatitude = undefined
    record.checkOutLongitude = undefined
    record.checkOutAccuracy = undefined
    record.checkOutAddress = `${ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX} ${reasonText}`
    record.updatedAt = now.toISOString()
    closed += 1
  }
  return closed
}

function normalizeAttendanceTime(value) {
  const time = String(value || '').slice(0, 8)
  return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time
}

function addVietnamDateKeyDays(dateKey, amount) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

function validatedAttendanceReplayTime(value, { registration, checkInTime } = {}) {
  const replayedAt = new Date(value)
  if (Number.isNaN(replayedAt.getTime()) || replayedAt.getTime() > Date.now() + 60_000) return null

  if (checkInTime) {
    const checkedInAt = new Date(checkInTime)
    return !Number.isNaN(checkedInAt.getTime()) && replayedAt > checkedInAt
      ? replayedAt.toISOString()
      : null
  }

  if (!registration) return null
  return currentVietnamDateKey(replayedAt) === registration.workDate
    ? replayedAt.toISOString()
    : null
}

const emptyStore = {
  movements: [],
  operationDays: [],
  reportSnapshots: [],
  inventoryReports: [],
  reportDrafts: {},
  shifts: [],
  shiftRegistrations: [],
  attendanceRecords: [],
  bagShiftSessions: [],
  bagAllocations: [],
  salesReceipts: [],
  supplyRequests: [],
  profiles: [],
  commissionRules: [],
  employeeKpiTargets: [],
  branches: [],
}

async function loadStore() {
  try {
    return { ...emptyStore, ...JSON.parse(await readFile(dataFile, 'utf8')) }
  } catch {
    return structuredClone(emptyStore)
  }
}

let store = await loadStore()
const sessions = new Map()
const defaultBranches = [
  { id: 'gold-coast', name: 'Gold Coast Nha Trang' },
  { id: 'lotte-2310', name: 'Lotte Mart 23/10' },
  { id: 'lotte-vt', name: 'Lotte Mart Vung Tau' },
]
store.branches = [
  ...defaultBranches.map((branch) => ({
    ...branch,
    ...(store.branches || []).find((item) => item.id === branch.id),
    active: (store.branches || []).find((item) => item.id === branch.id)?.active !== false,
  })),
  ...(store.branches || []).filter((branch) => !defaultBranches.some((item) => item.id === branch.id)),
]
store.shiftRegistrations = (store.shiftRegistrations || []).map((item) =>
  item.status === 'pending'
    ? { ...item, status: 'approved' }
    : item
)
if (!store.shifts.length) {
  const branches = ['gold-coast', 'lotte-2310', 'lotte-vt']
  const templates = [
    ['morning', 'Ca sáng', '08:00', '16:00'],
    ['afternoon', 'Ca chiều', '14:00', '22:00'],
    ['full', 'Ca cả ngày', '08:00', '22:00'],
  ]
  store.shifts = branches.flatMap((branchId) => templates.map(([suffix, name, startTime, endTime]) => ({
    id: `${branchId}-${suffix}`, branchId, name, startTime, endTime, graceMinutes: 5, active: true,
    recommendedStaff: suffix === 'full' ? 2 : 3,
  })))
}
const employmentShiftTemplates = [
  ['leader-morning', 'Ca sáng', '07:30', '15:30', ['leader']],
  ['leader-afternoon', 'Ca chiều', '14:00', '22:00', ['leader']],
  ['full-morning', 'Ca sáng', '07:30', '15:30', ['full_time']],
  ['full-middle', 'Ca giữa', '10:00', '18:00', ['full_time']],
  ['full-afternoon', 'Ca chiều', '14:00', '22:00', ['full_time']],
  ['part-early', 'Ca gãy sáng', '10:00', '15:00', ['part_time']],
  ['part-middle', 'Ca gãy', '13:00', '19:00', ['part_time']],
  ['part-evening', 'Ca gãy chiều tối', '15:00', '21:00', ['part_time']],
  ['part-late', 'Ca tối', '16:30', '21:30', ['part_time']],
]
function ensureDefaultShiftsForBranch(branchId) {
  for (const [suffix, name, startTime, endTime, employmentTypes] of employmentShiftTemplates) {
    const id = `${branchId}-${suffix}`
    if (!store.shifts.some((shift) => shift.id === id)) {
      store.shifts.push({
        id, branchId, name, startTime, endTime, graceMinutes: 5,
        recommendedStaff: 3, employmentTypes, active: true,
      })
    }
  }
}
for (const branch of store.branches) ensureDefaultShiftsForBranch(branch.id)
const defaultAccounts = [
  { id: 'demo-admin', name: 'Admin hệ thống', email: 'admin@gustino.vn', role: 'admin', branchId: 'gold-coast', branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'], employmentType: 'leader', positionTitle: 'Admin hệ thống' },
  { id: 'demo-manager', name: 'Quản lý Demo', email: 'quanly@gustino.vn', role: 'manager', branchId: 'gold-coast', branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'], employmentType: 'leader', positionTitle: 'Quản lý' },
  { id: 'demo-shift-leader', name: 'Ca trưởng Demo', email: 'catruong@gustino.vn', role: 'shift_leader', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'leader', positionTitle: 'Ca trưởng' },
  { id: 'demo-staff', name: 'Nhân viên Demo', email: 'nhanvien@gustino.vn', role: 'staff', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'part_time', positionTitle: 'Part-time' },
  { id: 'demo-kitchen', name: 'Bếp Demo', email: 'bep@gustino.vn', role: 'kitchen', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'part_time', positionTitle: 'Bếp' },
]
let seededDefaultAccounts = false
for (const account of defaultAccounts) {
  const existingIndex = (store.profiles || []).findIndex((profile) => profile.id === account.id)
  if (existingIndex < 0) {
    store.profiles.push({
      ...account,
      active: true,
      passwordHash: await hashPassword('123456'),
      passwordUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    seededDefaultAccounts = true
  } else {
    const existing = store.profiles[existingIndex]
    store.profiles[existingIndex] = {
      ...existing,
      ...account,
      active: existing.active !== false,
      passwordHash: existing.passwordHash || await hashPassword('123456'),
      passwordUpdatedAt: existing.passwordUpdatedAt || new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString(),
    }
    if (JSON.stringify(existing) !== JSON.stringify(store.profiles[existingIndex])) seededDefaultAccounts = true
  }
}
let writeQueue = Promise.resolve()
function persist() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dataDir, { recursive: true })
    await writeFile(dataFile, JSON.stringify(store, null, 2), 'utf8')
  })
  return writeQueue
}
if (seededDefaultAccounts) await persist()

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(JSON.stringify(body))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const result = await fetch(url, { ...init, signal: controller.signal })
    if (!result.ok) return null
    return await result.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function reverseGeocodeAddress(latitude, longitude) {
  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/reverse')
  nominatimUrl.searchParams.set('format', 'jsonv2')
  nominatimUrl.searchParams.set('lat', String(latitude))
  nominatimUrl.searchParams.set('lon', String(longitude))
  nominatimUrl.searchParams.set('zoom', '18')
  nominatimUrl.searchParams.set('addressdetails', '1')
  nominatimUrl.searchParams.set('accept-language', 'vi')
  const bigDataUrl = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  bigDataUrl.searchParams.set('latitude', String(latitude))
  bigDataUrl.searchParams.set('longitude', String(longitude))
  bigDataUrl.searchParams.set('localityLanguage', 'vi')
  const detailedAddress = concreteLanAddress(
      'nominatim',
      fetchJsonWithTimeout(nominatimUrl, {
        headers: { 'User-Agent': 'GUSTINO-Operations/1.0' },
      }).then((payload) => String(payload?.display_name || '').trim()),
    )
  const fallbackAddress = concreteLanAddress(
      'bigdatacloud',
      fetchJsonWithTimeout(bigDataUrl).then((payload) => {
        const parts = [payload?.locality, payload?.city, payload?.principalSubdivision, payload?.countryName]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
        return [...new Set(parts)].join(', ')
      }),
    )
  const result = await preferDetailedLanAddress(detailedAddress, fallbackAddress)
  return result?.address || ''
}

async function preferDetailedLanAddress(detailedAddress, fallbackAddress) {
  const first = await Promise.any([detailedAddress, fallbackAddress]).catch(() => null)
  if (!first || first.source === 'nominatim') return first
  const preferred = await Promise.race([
    detailedAddress.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 800)),
  ])
  return preferred || first
}

async function concreteLanAddress(source, request) {
  const address = await request
  if (!address || /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(address)) {
    throw new Error('Nhà cung cấp chưa trả địa chỉ cụ thể.')
  }
  return { address, source }
}

function draftKey(branchId, date) {
  return `${branchId}:${date}`
}

function actor(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const session = sessions.get(token)
  if (session) return { ...session, authenticated: true }
  return {
    id: String(request.headers['x-user-id'] || ''),
    role: String(request.headers['x-user-role'] || 'staff'),
    branchId: String(request.headers['x-user-branch'] || ''),
    branchIds: String(request.headers['x-user-branches'] || '').split(',').filter(Boolean),
    authenticated: false,
  }
}

async function authenticatedSupabaseReportOperator(request) {
  const accessToken = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!accessToken || !supabaseUrl || !anonKey) return null
  const authUser = await fetchJsonWithTimeout(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  }, 8000).catch(() => null)
  if (!authUser?.id) return null
  const profiles = await fetchJsonWithTimeout(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,active`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    8000,
  ).catch(() => null)
  const profile = profiles?.[0]
  if (!profile || profile.active === false) return null
  return {
    id: profile.id,
    role: profile.role,
    active: profile.active,
    authenticated: true,
    authSource: 'supabase',
    accessToken,
    supabaseUrl,
    anonKey,
  }
}

async function verifySupabaseReportShiftAndSnapshot(operator, input, shiftSequence) {
  if (!input.shiftId || !input.branchId || !input.businessDate) {
    return { ok: false, status: 400, error: 'Thiếu mã ca, chi nhánh hoặc ngày báo cáo.' }
  }
  const headers = { apikey: operator.anonKey, Authorization: `Bearer ${operator.accessToken}`, Accept: 'application/json' }
  const shiftParams = new URLSearchParams({
    id: `eq.${input.shiftId}`,
    branch_id: `eq.${input.branchId}`,
    business_date: `eq.${input.businessDate}`,
    sequence: `eq.${shiftSequence}`,
    leader_id: `eq.${operator.id}`,
    status: 'eq.closed',
    select: 'id',
  })
  const shifts = await fetchJsonWithTimeout(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${shiftParams}`, { headers }, 8000).catch(() => null)
  if (!Array.isArray(shifts)) return { ok: false, status: 502, error: 'Không kiểm tra được trạng thái ca trên Supabase.' }
  if (!shifts.length) return { ok: false, status: 409, error: 'Chỉ được xếp lịch sau khi chính ca trưởng đã đóng ca.' }

  if (shiftSequence === 2) {
    const openParams = new URLSearchParams({
      branch_id: `eq.${input.branchId}`,
      business_date: `eq.${input.businessDate}`,
      status: 'eq.open',
      select: 'id',
    })
    const openShifts = await fetchJsonWithTimeout(`${operator.supabaseUrl}/rest/v1/bag_shift_sessions?${openParams}`, { headers }, 8000).catch(() => null)
    if (!Array.isArray(openShifts)) return { ok: false, status: 502, error: 'Không kiểm tra được ca đang mở trên Supabase.' }
    if (openShifts.length) return { ok: false, status: 409, error: 'Ca 2 chỉ xếp lịch cùng Tổng ngày khi không còn ca nào đang mở.' }
  }

  const snapshotParams = new URLSearchParams({
    branch_id: `eq.${input.branchId}`,
    report_date: `eq.${input.businessDate}`,
    select: 'id,payload',
    limit: '1',
  })
  const snapshots = await fetchJsonWithTimeout(`${operator.supabaseUrl}/rest/v1/report_snapshots?${snapshotParams}`, { headers }, 8000).catch(() => null)
  if (!Array.isArray(snapshots)) return { ok: false, status: 502, error: 'Không kiểm tra được báo cáo đã chốt trên Supabase.' }
  const snapshot = snapshots[0]
  const shiftEntry = snapshot?.payload?.shiftReports?.[input.shiftId]
  if (!shiftEntry) return { ok: false, status: 409, error: 'Báo cáo ca chưa được lưu nên chưa thể xếp lịch.' }
  return { ok: true, snapshot, shiftEntry, previousDelivery: shiftEntry.n8nDelivery || {} }
}

async function persistSupabaseN8nDelivery(operator, snapshot, shiftId, delivery) {
  const payload = {
    ...snapshot.payload,
    shiftReports: {
      ...snapshot.payload.shiftReports,
      [shiftId]: { ...snapshot.payload.shiftReports[shiftId], n8nDelivery: delivery },
    },
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${operator.supabaseUrl}/rest/v1/report_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, {
      method: 'PATCH',
      headers: {
        apikey: operator.anonKey,
        Authorization: `Bearer ${operator.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Supabase trả HTTP ${response.status}`)
  } finally {
    clearTimeout(timeout)
  }
}

function canAccessBranch(user, branchId) {
  if (['admin', 'manager', 'kitchen'].includes(user.role)) return true
  return user.branchId === branchId || user.branchIds.includes(branchId)
}

function closeOutstandingBagSession(session, userId, note = 'Auto closed.') {
  const endedAt = new Date().toISOString()
  session.status = 'closed'
  session.discrepancyNote = session.discrepancyNote || note
  session.endedAt = session.endedAt || endedAt
  store.bagAllocations = (store.bagAllocations || []).map((allocation) => {
    if (allocation.shiftId !== session.id || allocation.settledAt) return allocation
    const issued = Number(allocation.issuedQuantity || 0)
    const sold = Number(allocation.soldQuantity || 0)
    const damaged = Number(allocation.damagedQuantity || 0)
    return {
      ...allocation,
      returnedQuantity: Math.max(0, issued - sold - damaged),
      settledBy: userId,
      settlementShiftId: session.id,
      settledAt: endedAt,
    }
  })
}

function attendanceRowsAllowed(user, rows, ownerField = 'userId') {
  if (['admin', 'manager', 'shift_leader'].includes(user.role)) return rows.filter((item) => canAccessBranch(user, item.branchId))
  return rows.filter((item) => item[ownerField] === user.id)
}

function attendanceFilters(rows, url) {
  const branchId = url.searchParams.get('branchId')
  const userId = url.searchParams.get('userId')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  return rows.filter((item) =>
    (!branchId || item.branchId === branchId)
    && (!userId || item.userId === userId)
    && (!from || attendanceRowDateKey(item) >= from)
    && (!to || attendanceRowDateKey(item) <= to)
  )
}

function attendanceRowDateKey(item) {
  if (item.workDate) return item.workDate
  const date = new Date(item.checkInTime)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${Buffer.from(derived).toString('hex')}`
}

async function passwordMatches(password, stored) {
  if (!stored?.includes(':')) return false
  const [salt, expectedHex] = stored.split(':')
  const derived = Buffer.from(await scrypt(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    branchId: profile.branchId,
    active: profile.active !== false,
    hasLoginAccount: Boolean(profile.email && profile.passwordHash && profile.active !== false),
    employmentType: profile.employmentType,
    positionTitle: profile.positionTitle,
    avatarUrl: profile.avatarUrl,
  }
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') return json(response, 200, {})
  const branchId = url.searchParams.get('branchId') || ''
  const date = url.searchParams.get('date') || ''
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''

  if (url.pathname === '/api/health') return json(response, 200, { ok: true, updatedAt: new Date().toISOString() })
  if (url.pathname === '/api/server-time' && request.method === 'GET') return json(response, 200, { now: new Date().toISOString() })
  if (url.pathname === '/api/branches' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const includeInactive = url.searchParams.get('includeInactive') === '1'
    return json(response, 200, (store.branches || []).filter((branch) => includeInactive || branch.active !== false))
  }
  if (url.pathname === '/api/branches' && request.method === 'PUT') {
    const user = actor(request)
    if (user.role !== 'admin') return json(response, 403, { error: 'Chỉ Admin hệ thống được cập nhật chi nhánh.' })
    const rows = await body(request)
    if (!Array.isArray(rows)) return json(response, 400, { error: 'Danh sách chi nhánh không hợp lệ.' })
    const next = rows
      .filter((branch) => branch && branch.id && branch.name)
      .map((branch) => ({
        ...branch,
        id: String(branch.id).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: String(branch.name).trim(),
        active: branch.active !== false,
      }))
    store.branches = next
    for (const branch of store.branches) ensureDefaultShiftsForBranch(branch.id)
    await persist()
    return json(response, 200, store.branches)
  }
  if (url.pathname === '/api/commission-rules' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const branchIds = ['admin', 'manager'].includes(user.role)
      ? (store.branches || []).map((branch) => branch.id)
      : Array.from(new Set([user.branchId, ...(user.branchIds || [])]))
    return json(response, 200, (store.commissionRules || []).filter((rule) => branchIds.includes(rule.branchId)))
  }
  if (url.pathname === '/api/commission-rules' && request.method === 'PUT') {
    const user = actor(request)
    if (!['admin', 'manager'].includes(user.role)) return json(response, 403, { error: 'Chỉ Quản lý được đổi chính sách hoa hồng.' })
    const input = await body(request)
    if (!canAccessBranch(user, input.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    const rule = {
      id: (store.commissionRules || []).find((item) => item.branchId === input.branchId)?.id || randomUUID(),
      branchId: input.branchId,
      targetQuantity: Math.max(1, Number(input.targetQuantity) || 1),
      commissionPerUnit: Math.max(0, Number(input.commissionPerUnit) || 0),
      updatedAt: new Date().toISOString(),
    }
    store.commissionRules = [...(store.commissionRules || []).filter((item) => item.branchId !== rule.branchId), rule]
    await persist()
    return json(response, 200, rule)
  }
  if (url.pathname === '/api/employee-kpi-targets' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const requestedBranchIds = (url.searchParams.get('branchIds') || user.branchId).split(',').filter(Boolean)
    const allowedBranchIds = requestedBranchIds.filter((id) => canAccessBranch(user, id))
    return json(response, 200, (store.employeeKpiTargets || []).filter((target) => allowedBranchIds.includes(target.branchId)))
  }
  if (url.pathname === '/api/employee-kpi-targets' && request.method === 'PUT') {
    const user = actor(request)
    if (!['admin', 'manager'].includes(user.role)) return json(response, 403, { error: 'Chỉ Quản lý được đổi KPI nhân viên.' })
    const input = await body(request)
    if (!canAccessBranch(user, input.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    const key = `${input.branchId}|${input.employeeKey}`
    if (!(Number(input.targetRevenue) > 0)) {
      store.employeeKpiTargets = (store.employeeKpiTargets || []).filter((item) => `${item.branchId}|${item.employeeKey}` !== key)
      await persist()
      return json(response, 200, {
        branchId: input.branchId,
        employeeKey: input.employeeKey,
        employeeId: input.employeeId,
        employeeName: input.employeeName || '',
        targetRevenue: 0,
        updatedAt: new Date().toISOString(),
      })
    }
    const target = {
      id: (store.employeeKpiTargets || []).find((item) => `${item.branchId}|${item.employeeKey}` === key)?.id || randomUUID(),
      branchId: input.branchId,
      employeeKey: input.employeeKey,
      employeeId: input.employeeId || '',
      employeeName: input.employeeName || '',
      targetRevenue: Math.round(Number(input.targetRevenue)),
      updatedAt: new Date().toISOString(),
    }
    store.employeeKpiTargets = [...(store.employeeKpiTargets || []).filter((item) => `${item.branchId}|${item.employeeKey}` !== key), target]
    await persist()
    return json(response, 200, target)
  }
  if (url.pathname === '/api/reverse-geocode' && request.method === 'GET') {
    const latitude = Number(url.searchParams.get('lat'))
    const longitude = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json(response, 400, { error: 'Tọa độ không hợp lệ.' })
    const address = await reverseGeocodeAddress(latitude, longitude)
    if (!address) return json(response, 502, { error: 'Chưa lấy được địa chỉ cụ thể từ vị trí này.' })
    return json(response, 200, { address })
  }

  if (url.pathname === '/api/supply-requests' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const requestedBranchIds = (url.searchParams.get('branchIds') || user.branchId).split(',').filter(Boolean)
    const allowedBranchIds = ['admin', 'manager'].includes(user.role)
      ? requestedBranchIds.filter((id) => canAccessBranch(user, id))
      : [user.branchId]
    const rows = (store.supplyRequests || [])
      .filter((item) => allowedBranchIds.includes(item.branchId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return json(response, 200, rows)
  }

  if (url.pathname === '/api/supply-requests' && request.method === 'POST') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    if (!['shift_leader', 'manager', 'admin'].includes(user.role)) return json(response, 403, { error: 'Chỉ ca trưởng hoặc quản lý được gửi đơn đặt bếp.' })
    const input = await body(request)
    const branchId = String(input.branchId || user.branchId)
    if (!canAccessBranch(user, branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    const requestedDeliveryDate = String(input.requestedDeliveryDate || '').trim()
    const requestedDeliveryPeriod = String(input.requestedDeliveryPeriod || '').trim()
    if (requestedDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDeliveryDate)) {
      return json(response, 400, { error: 'Ngày nhận mong muốn không hợp lệ.' })
    }
    if (requestedDeliveryPeriod && !['morning', 'noon', 'afternoon'].includes(requestedDeliveryPeriod)) {
      return json(response, 400, { error: 'Buổi nhận mong muốn không hợp lệ.' })
    }
    const inputItems = Array.isArray(input.items) ? input.items : [input]
    const rows = inputItems.map((item) => ({
      productName: String(item.productName || '').trim(),
      quantity: Number(item.quantity),
      unit: String(item.unit || '').trim() || 'kg',
      note: String(item.note || '').trim(),
    })).filter((item) => item.productName && Number.isFinite(item.quantity) && item.quantity > 0)
    if (!rows.length) {
      return json(response, 400, { error: 'Tên hàng và số lượng không hợp lệ.' })
    }
    const now = new Date().toISOString()
    const requestRows = rows.map((item) => ({
      id: randomUUID(),
      branchId,
      ...item,
      requestedBy: user.id,
      requestedByName: String(input.requestedByName || user.id),
      requestedDeliveryDate,
      requestedDeliveryPeriod,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }))
    store.supplyRequests.unshift(...requestRows)
    await persist()
    return json(response, 200, Array.isArray(input.items) ? requestRows : requestRows[0])
  }

  const supplyRequestMatch = url.pathname.match(/^\/api\/supply-requests\/([^/]+)$/)
  if (supplyRequestMatch && request.method === 'PATCH') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    if (!['shift_leader', 'kitchen', 'manager', 'admin'].includes(user.role)) return json(response, 403, { error: 'Chỉ bếp, ca trưởng hoặc quản lý được cập nhật đơn.' })
    const index = (store.supplyRequests || []).findIndex((item) => item.id === supplyRequestMatch[1])
    if (index < 0) return json(response, 404, { error: 'Không tìm thấy đơn đặt bếp.' })
    if (!canAccessBranch(user, store.supplyRequests[index].branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    const patch = await body(request)
    if (patch.status && !['pending', 'acknowledged', 'fulfilled', 'cancelled'].includes(patch.status)) return json(response, 400, { error: 'Trạng thái không hợp lệ.' })
    if (patch.requestedDeliveryDate !== undefined && patch.requestedDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.requestedDeliveryDate))) {
      return json(response, 400, { error: 'Ngày nhận mong muốn không hợp lệ.' })
    }
    if (patch.requestedDeliveryPeriod !== undefined && patch.requestedDeliveryPeriod && !['morning', 'noon', 'afternoon'].includes(patch.requestedDeliveryPeriod)) {
      return json(response, 400, { error: 'Buổi nhận mong muốn không hợp lệ.' })
    }
    store.supplyRequests[index] = {
      ...store.supplyRequests[index],
      ...(patch.productName !== undefined ? { productName: String(patch.productName).trim() } : {}),
      ...(patch.quantity !== undefined ? { quantity: Number(patch.quantity) } : {}),
      ...(patch.unit !== undefined ? { unit: String(patch.unit).trim() || 'kg' } : {}),
      ...(patch.note !== undefined ? { note: String(patch.note).trim() } : {}),
      ...(patch.requestedDeliveryDate !== undefined ? { requestedDeliveryDate: String(patch.requestedDeliveryDate || '') } : {}),
      ...(patch.requestedDeliveryPeriod !== undefined ? { requestedDeliveryPeriod: String(patch.requestedDeliveryPeriod || '') } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      updatedAt: new Date().toISOString(),
    }
    await persist()
    return json(response, 200, store.supplyRequests[index])
  }

  if (supplyRequestMatch && request.method === 'DELETE') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const index = (store.supplyRequests || []).findIndex((item) => item.id === supplyRequestMatch[1])
    if (index < 0) return json(response, 404, { error: 'Không tìm thấy đơn đặt bếp.' })
    if (!canAccessBranch(user, store.supplyRequests[index].branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    if (!['shift_leader', 'manager', 'admin'].includes(user.role) && store.supplyRequests[index].requestedBy !== user.id) {
      return json(response, 403, { error: 'Không có quyền xóa đơn.' })
    }
    store.supplyRequests.splice(index, 1)
    await persist()
    return json(response, 200, { ok: true })
  }

  if (url.pathname === '/api/sales-receipts' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chua dang nhap.' })
    const rows = (store.salesReceipts || [])
      .filter((item) => canAccessBranch(user, item.branchId))
      .filter((item) => !branchId || item.branchId === branchId)
      .filter((item) => !date || item.businessDate === date)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return json(response, 200, rows)
  }

  if (url.pathname === '/api/sales-receipts/range' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chua dang nhap.' })
    const from = url.searchParams.get('from') || ''
    const to = url.searchParams.get('to') || ''
    const requestedBranchIds = (url.searchParams.get('branchIds') || user.branchId).split(',').filter(Boolean)
    const allowedBranchIds = requestedBranchIds.filter((id) => canAccessBranch(user, id))
    const rows = (store.salesReceipts || [])
      .filter((item) => allowedBranchIds.includes(item.branchId))
      .filter((item) => (!from || item.businessDate >= from) && (!to || item.businessDate <= to))
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt))
    return json(response, 200, rows)
  }

  if (url.pathname === '/api/sales-receipts' && request.method === 'POST') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chua dang nhap.' })
    if (!['staff', 'shift_leader', 'manager', 'admin'].includes(user.role)) {
      return json(response, 403, { error: 'Khong co quyen tao hoa don.' })
    }
    const receipt = await body(request)
    if (!receipt?.id || !receipt.branchId || !receipt.businessDate || !Array.isArray(receipt.lines)) {
      return json(response, 400, { error: 'Hoa don khong hop le.' })
    }
    if (!canAccessBranch(user, receipt.branchId)) return json(response, 403, { error: 'Khong co quyen tai chi nhanh nay.' })
    // Idempotent theo id: client retry cung id thi tra lai hoa don cu (khong tao
    // don trung, khong tru kho lan hai) — khop hanh vi RPC Supabase.
    const existingById = (store.salesReceipts || []).find((item) => item.id === receipt.id)
    if (existingById) return json(response, 200, existingById)
    if ((store.salesReceipts || []).some((item) => item.code === receipt.code)) {
      return json(response, 409, { error: 'Hoa don da ton tai.' })
    }
    const totalQuantity = Number(receipt.totalQuantity || receipt.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0))
    const totalAmount = Number(receipt.totalAmount || receipt.lines.reduce((sum, line) => sum + Number(line.total || 0), 0))
    const row = {
      ...receipt,
      sellerKey: receipt.sellerKey || receipt.sellerId || String(receipt.sellerName || '').trim().toLowerCase(),
      sellerName: String(receipt.sellerName || user.id),
      totalQuantity,
      totalAmount,
      createdBy: receipt.createdBy || user.id,
      createdByName: receipt.createdByName || user.id,
      createdAt: receipt.createdAt || new Date().toISOString(),
      lines: receipt.lines.map((line) => ({
        allocationId: line.allocationId || undefined,
        productId: String(line.productId || ''),
        productName: String(line.productName || line.productId || ''),
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
        total: Number(line.total || 0),
      })).filter((line) => line.productId && line.quantity > 0),
    }
    if (!row.lines.length) return json(response, 400, { error: 'Hoa don chua co mon.' })
    delete row.stockMovements
    store.salesReceipts.unshift(row)
    // Ban hang phai tru kho theo cong thuc mon (BUG-115). May chu LAN khong co danh
    // muc san pham nen client gui san cac dong phieu xuat da quy doi tu recipe.
    // documentId = id hoa don de xoa hoa don la go dung nhom phieu nay.
    const stockMovements = Array.isArray(receipt.stockMovements) ? receipt.stockMovements : []
    const knownMovementIds = new Set((store.movements || []).map((item) => item.id))
    const posMovements = stockMovements
      .filter((item) => item && item.productId && Number(item.quantity) > 0 && !knownMovementIds.has(item.id))
      .map((item) => ({
        ...item,
        id: item.id || `${row.id}-${item.productId}`,
        documentId: row.id,
        branchId: row.branchId,
        type: 'sale_out',
        quantity: Number(item.quantity),
        shiftDate: item.shiftDate || row.businessDate,
        createdBy: item.createdBy || row.createdBy,
        createdAt: item.createdAt || row.createdAt,
      }))
    if (posMovements.length) store.movements = [...posMovements, ...(store.movements || [])]
    await persist()
    return json(response, 200, row)
  }

  if (url.pathname.startsWith('/api/sales-receipts/') && request.method === 'DELETE') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chua dang nhap.' })
    const receiptId = decodeURIComponent(url.pathname.slice('/api/sales-receipts/'.length))
    const receipt = (store.salesReceipts || []).find((item) => item.id === receiptId)
    if (!receipt) return json(response, 404, { error: 'Khong tim thay hoa don.' })
    const todayKey = currentVietnamDateKey()
    const canManage = ['shift_leader', 'manager', 'admin'].includes(user.role) && canAccessBranch(user, receipt.branchId)
    const ownsToday = (receipt.createdBy === user.id || receipt.sellerId === user.id) && receipt.businessDate === todayKey
    if (!canManage && !ownsToday) return json(response, 403, { error: 'Khong co quyen xoa hoa don nay.' })
    store.salesReceipts = (store.salesReceipts || []).filter((item) => item.id !== receiptId)
    // Tra lai kho phan da tru khi ban, neu khong moi lan bam nham roi xoa la kho mat hang.
    store.movements = (store.movements || []).filter((item) =>
      !(item.documentId === receiptId && item.type === 'sale_out'))
    await persist()
    return json(response, 200, { ok: true })
  }

  if (url.pathname.startsWith('/api/shift-ledger/')) {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const canWrite = user.role === 'shift_leader'

    if (url.pathname === '/api/shift-ledger/sessions' && request.method === 'GET') {
      const rows = store.bagShiftSessions
        .filter((item) => canAccessBranch(user, item.branchId))
        .filter((item) => !branchId || item.branchId === branchId)
        .filter((item) => !date || item.businessDate === date)
        .filter((item) => !from || item.businessDate >= from)
        .filter((item) => !to || item.businessDate <= to)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      return json(response, 200, rows)
    }
    if (url.pathname === '/api/shift-ledger/sessions' && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Chỉ ca trưởng được nhận ca.' })
      const session = await body(request)
      if (!canAccessBranch(user, session.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      const staleOpenSessions = store.bagShiftSessions.filter((item) =>
        item.branchId === session.branchId && item.status === 'open' && item.businessDate !== session.businessDate
      )
      staleOpenSessions.forEach((item) => closeOutstandingBagSession(item, user.id, 'Auto closed when opening a new business day.'))
      if (store.bagShiftSessions.some((item) => item.branchId === session.branchId && item.status === 'open')) {
        return json(response, 409, { error: 'Chi nhánh đang có một ca chưa bàn giao.' })
      }
      session.sequence = store.bagShiftSessions.filter((item) =>
        item.branchId === session.branchId && item.businessDate === session.businessDate,
      ).length + 1
      store.bagShiftSessions.unshift(session)
      await persist()
      return json(response, 200, session)
    }
    const closeSessionMatch = url.pathname.match(/^\/api\/shift-ledger\/sessions\/([^/]+)\/close$/)
    if (closeSessionMatch && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Bạn không có quyền bàn giao ca.' })
      const index = store.bagShiftSessions.findIndex((item) => item.id === closeSessionMatch[1])
      if (index < 0) return json(response, 404, { error: 'Không tìm thấy ca.' })
      if (!canAccessBranch(user, store.bagShiftSessions[index].branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      if (store.bagShiftSessions[index].status !== 'open') return json(response, 409, { error: 'Ca này đã được bàn giao.' })
      const payload = await body(request)
      store.bagShiftSessions[index] = {
        ...store.bagShiftSessions[index],
        status: 'closed',
        closingBalances: payload.closingBalances || {},
        discrepancyNote: payload.discrepancyNote || '',
        endedAt: payload.endedAt || new Date().toISOString(),
      }
      const postedIds = new Set(payload.postedAllocationIds || [])
      store.bagAllocations = store.bagAllocations.map((item) =>
        postedIds.has(item.id) && !item.postedAt
          ? { ...item, postedAt: store.bagShiftSessions[index].endedAt }
          : item,
      )
      const movementRows = Array.isArray(payload.movements) ? payload.movements : []
      if (movementRows.length) {
        const known = new Set(store.movements.map((item) => item.id))
        const mappedMovements = movementRows
          .filter((item) => item?.id && !known.has(item.id))
          .map((item) => ({
            id: item.id,
            documentId: item.document_id || store.bagShiftSessions[index].id,
            branchId: store.bagShiftSessions[index].branchId,
            productId: item.product_id,
            type: item.movement_type,
            quantity: Number(item.quantity || 0),
            shiftDate: item.shift_date,
            note: item.note || '',
            createdBy: user.id,
            createdAt: item.created_at || store.bagShiftSessions[index].endedAt,
            sourceProductId: item.source_product_id || undefined,
            sourceQuantity: item.source_quantity == null ? undefined : Number(item.source_quantity),
            measuredWeightKg: item.measured_weight_kg == null ? undefined : Number(item.measured_weight_kg),
          }))
        store.movements = [...mappedMovements, ...store.movements]
      }
      await persist()
      return json(response, 200, store.bagShiftSessions[index])
    }
    // Chủ ca phải là ca trưởng: ca phó lỡ mở ca trước thì ca trưởng nhận lại quyền.
    const leaderSessionMatch = url.pathname.match(/^\/api\/shift-ledger\/sessions\/([^/]+)\/leader$/)
    if (leaderSessionMatch && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Bạn không có quyền đổi chủ ca.' })
      const index = store.bagShiftSessions.findIndex((item) => item.id === leaderSessionMatch[1])
      if (index < 0) return json(response, 404, { error: 'Không tìm thấy ca.' })
      const session = store.bagShiftSessions[index]
      if (!canAccessBranch(user, session.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      if (session.status !== 'open') return json(response, 409, { error: 'Ca này đã bàn giao nên không đổi được chủ ca.' })
      const payload = await body(request)
      store.bagShiftSessions[index] = {
        ...session,
        leaderId: payload.leaderId || user.id,
        leaderName: payload.leaderName || session.leaderName,
        discrepancyNote: payload.discrepancyNote || session.discrepancyNote || '',
      }
      await persist()
      return json(response, 200, store.bagShiftSessions[index])
    }
    const photoSessionMatch = url.pathname.match(/^\/api\/shift-ledger\/sessions\/([^/]+)\/photo$/)
    if (photoSessionMatch && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Bạn không có quyền lưu ảnh bàn giao.' })
      const index = store.bagShiftSessions.findIndex((item) => item.id === photoSessionMatch[1])
      if (index < 0) return json(response, 404, { error: 'Không tìm thấy ca.' })
      const session = store.bagShiftSessions[index]
      if (!canAccessBranch(user, session.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      const payload = await body(request)
      const kind = payload.kind === 'closing' ? 'closing' : 'opening'
      const match = String(payload.dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/)
      if (!match) return json(response, 400, { error: 'Ảnh bàn giao không hợp lệ.' })
      await mkdir(shiftProofDir, { recursive: true })
      const extension = match[1] === 'png' ? 'png' : 'jpg'
      const fileName = `${session.branchId}-${session.businessDate}-${session.id}-${kind}-${Date.now()}.${extension}`.replace(/[^a-zA-Z0-9._-]/g, '_')
      await writeFile(join(shiftProofDir, fileName), Buffer.from(match[2], 'base64'))
      const photoUrl = `/uploads/shift-proofs/${fileName}`
      store.bagShiftSessions[index] = {
        ...session,
        [kind === 'opening' ? 'openingPhotoUrl' : 'closingPhotoUrl']: photoUrl,
      }
      await persist()
      return json(response, 200, store.bagShiftSessions[index])
    }
    if (url.pathname === '/api/shift-ledger/allocations' && request.method === 'GET') {
      const rows = store.bagAllocations
        .filter((item) => canAccessBranch(user, item.branchId))
        .filter((item) => !branchId || item.branchId === branchId)
        .filter((item) => {
          if (!date) return true
          const session = store.bagShiftSessions.find((candidate) => candidate.id === item.shiftId)
          return session?.businessDate === date
        })
        .map((item) => ({
          ...item,
          businessDate: store.bagShiftSessions.find((candidate) => candidate.id === item.shiftId)?.businessDate,
        }))
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      return json(response, 200, rows)
    }
    if (url.pathname === '/api/shift-ledger/allocations' && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Chỉ ca trưởng được phát túi.' })
      const allocation = await body(request)
      const session = store.bagShiftSessions.find((item) => item.id === allocation.shiftId)
      if (!session || session.status !== 'open') return json(response, 409, { error: 'Hãy nhận ca trước khi phát túi.' })
      if (!canAccessBranch(user, allocation.branchId) || session.branchId !== allocation.branchId) {
        return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      }
      if (!allocation.employeeName?.trim() || Number(allocation.issuedQuantity) <= 0) {
        return json(response, 400, { error: 'Tên nhân viên và số túi không hợp lệ.' })
      }
      store.bagAllocations.unshift(allocation)
      await persist()
      return json(response, 200, allocation)
    }
    const allocationMatch = url.pathname.match(/^\/api\/shift-ledger\/allocations\/([^/]+)$/)
    if (allocationMatch && request.method === 'PATCH') {
      if (!canWrite) return json(response, 403, { error: 'Bạn không có quyền đối soát túi.' })
      const index = store.bagAllocations.findIndex((item) => item.id === allocationMatch[1])
      if (index < 0) return json(response, 404, { error: 'Không tìm thấy lượt phát túi.' })
      if (!canAccessBranch(user, store.bagAllocations[index].branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      if (store.bagAllocations[index].settledAt) return json(response, 409, { error: 'Lượt túi này đã được đối soát.' })
      const patch = await body(request)
      if (Number(patch.returnedQuantity || 0) + Number(patch.damagedQuantity || 0) > store.bagAllocations[index].issuedQuantity) {
        return json(response, 400, { error: 'Số trả và số hỏng vượt quá số đã phát.' })
      }
      store.bagAllocations[index] = { ...store.bagAllocations[index], ...patch }
      await persist()
      return json(response, 200, store.bagAllocations[index])
    }
  }

  if (url.pathname.startsWith('/api/attendance/')) {
    if (url.pathname === '/api/attendance/login' && request.method === 'POST') {
      const credentials = await body(request)
      const rawLogin = String(credentials.username || credentials.email || '').trim().toLowerCase()
      const username = normalizeUsername(rawLogin.includes('@') ? rawLogin.split('@')[0] : rawLogin)
      const emailCandidates = new Set([
        rawLogin.includes('@') ? rawLogin : `${username}@accounts.gustino.vn`,
        `${username}@accounts.gustino.vn`,
        `${username}@gustino.vn`,
      ])
      const profile = (store.profiles || []).find((item) =>
        emailCandidates.has(String(item.email || '').toLowerCase())
        || normalizeUsername(String(item.email || '').split('@')[0]) === username,
      )
      if (!profile || profile.active === false || !(await passwordMatches(String(credentials.password || ''), profile.passwordHash))) {
        return json(response, 401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
      }
      const authToken = randomBytes(32).toString('hex')
      const branchIds = ['admin', 'manager', 'kitchen'].includes(profile.role)
        ? Array.from(new Set([profile.branchId, ...(profile.branchIds || [])]))
        : [profile.branchId]
      sessions.set(authToken, {
        id: profile.id,
        role: profile.role,
        branchId: profile.branchId,
        branchIds,
      })
      return json(response, 200, {
        ...publicProfile(profile),
        branchIds,
        authToken,
      })
    }
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })

    if (url.pathname === '/api/attendance/shifts' && request.method === 'GET') {
      return json(response, 200, store.shifts.filter((item) => item.active && canAccessBranch(user, item.branchId)))
    }
    if (url.pathname === '/api/attendance/shifts' && request.method === 'POST') {
      const input = await body(request)
      const branchId = String(input.branchId || user.branchId)
      const startTime = String(input.startTime || '').slice(0, 5)
      const endTime = String(input.endTime || '').slice(0, 5)
      if (!['admin', 'manager', 'shift_leader'].includes(user.role)) return json(response, 403, { error: 'Không có quyền tạo khung ca.' })
      if (!canAccessBranch(user, branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return json(response, 400, { error: 'Khung giờ không hợp lệ.' })
      }
      if (!store.branches.some((branch) => branch.id === branchId)) {
        store.branches.push({ id: branchId, name: String(input.branchName || branchId), active: true, createdAt: new Date().toISOString() })
      }
      const duplicate = store.shifts.find((item) =>
        item.active && item.branchId === branchId && item.startTime === startTime && item.endTime === endTime,
      )
      if (duplicate) return json(response, 200, duplicate)
      const shift = {
        id: randomUUID(),
        branchId,
        name: String(input.name || `${startTime}-${endTime}`).trim(),
        startTime,
        endTime,
        graceMinutes: 5,
        recommendedStaff: Number(input.recommendedStaff || 3),
        employmentTypes: Array.isArray(input.employmentTypes) ? input.employmentTypes.filter((item) => ['leader', 'full_time', 'part_time'].includes(item)) : [],
        active: true,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      }
      store.shifts.push(shift)
      await persist()
      return json(response, 200, shift)
    }
    const shiftMatch = url.pathname.match(/^\/api\/attendance\/shifts\/([^/]+)$/)
    if (shiftMatch && request.method === 'DELETE') {
      if (!['admin', 'manager', 'shift_leader'].includes(user.role)) return json(response, 403, { error: 'Không có quyền xóa khung ca.' })
      const shift = store.shifts.find((item) => item.id === shiftMatch[1])
      if (!shift) return json(response, 404, { error: 'Không tìm thấy khung ca.' })
      if (!canAccessBranch(user, shift.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      shift.active = false
      await persist()
      return json(response, 200, { ok: true })
    }
    if (url.pathname === '/api/attendance/employees' && request.method === 'GET') {
      const profiles = new Map()
      for (const item of store.profiles || []) {
        if (item.id && canAccessBranch(user, item.branchId)) profiles.set(item.id, item)
      }
      for (const item of [...store.shiftRegistrations, ...store.attendanceRecords]) {
        if (item.userId && item.userName && canAccessBranch(user, item.branchId)) {
          const existing = profiles.get(item.userId)
          if (!existing) {
            profiles.set(item.userId, { id: item.userId, name: item.userName, role: 'staff', branchId: item.branchId })
          }
        }
      }
      if (!profiles.has(user.id)) {
        profiles.set(user.id, { id: user.id, name: user.id === 'demo-shift-leader' ? 'Ca trưởng Demo' : user.id, role: user.role, branchId: user.branchId })
      }
      return json(response, 200, Array.from(profiles.values()).map(publicProfile))
    }
    if (url.pathname === '/api/attendance/employees' && request.method === 'POST') {
      if (!user.authenticated || user.role !== 'admin') return json(response, 403, { error: 'Chỉ Admin hệ thống được tạo nhân sự.' })
      const input = await body(request)
      const username = normalizeUsername(String(input.username || ''))
      const email = String(input.email || `${username}@accounts.gustino.vn`).trim().toLowerCase()
      const password = String(input.temporaryPassword || '')
      const name = String(input.name || '').trim()
      if (!name || username.length < 3 || !email.includes('@')) return json(response, 400, { error: 'Tên và tên đăng nhập không hợp lệ.' })
      if (password.length < 6) return json(response, 400, { error: 'Mật khẩu tạm cần ít nhất 6 ký tự.' })
      if (!['manager', 'shift_leader', 'staff', 'cashier', 'kitchen'].includes(input.role)) return json(response, 400, { error: 'Vai trò không hợp lệ.' })
      const branchlessRole = ['manager', 'kitchen'].includes(input.role)
      const accountBranchId = branchlessRole ? '' : input.branchId
      if (!branchlessRole && !canAccessBranch(user, accountBranchId)) return json(response, 403, { error: 'Không có quyền tạo tài khoản tại chi nhánh này.' })
      if ((store.profiles || []).some((item) => String(item.email || '').toLowerCase() === email && item.active !== false)) {
        return json(response, 409, { error: 'Tên đăng nhập này đã có tài khoản.' })
      }
      const profile = {
        id: randomUUID(),
        name,
        email,
        role: input.role,
        employmentType: input.employmentType,
        positionTitle: input.positionTitle,
        avatarUrl: input.avatarUrl,
        branchId: accountBranchId,
        branchIds: branchlessRole ? (store.branches || []).map((branch) => branch.id) : [accountBranchId],
        active: true,
        passwordHash: await hashPassword(password),
        passwordUpdatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }
      store.profiles.unshift(profile)
      await persist()
      return json(response, 200, publicProfile(profile))
    }
    const employeeMatch = url.pathname.match(/^\/api\/attendance\/employees\/([^/]+)$/)
    if (employeeMatch && request.method === 'PATCH') {
      if (!user.authenticated || user.role !== 'admin') return json(response, 403, { error: 'Chỉ Admin hệ thống được cập nhật nhân sự.' })
      const patch = await body(request)
      if (patch.role && !['manager', 'shift_leader', 'staff', 'cashier', 'kitchen'].includes(patch.role)) {
        return json(response, 400, { error: 'Vai trò không hợp lệ.' })
      }
      if (patch.employmentType && !['leader', 'full_time', 'part_time'].includes(patch.employmentType)) {
        return json(response, 400, { error: 'Nhóm ca không hợp lệ.' })
      }
      if (patch.employmentStatus && !['probation', 'working', 'ended'].includes(patch.employmentStatus)) {
        return json(response, 400, { error: 'Trạng thái việc làm không hợp lệ.' })
      }
      if (patch.employmentStatus === 'ended' && !patch.employmentEndDate) {
        return json(response, 400, { error: 'Cần nhập ngày nghỉ việc.' })
      }
      if (employeeMatch[1] === user.id && patch.role && patch.role !== 'admin') {
        return json(response, 409, { error: 'Bạn không thể tự hạ quyền Quản lý của chính mình.' })
      }
      let profile = (store.profiles || []).find((item) => item.id === employeeMatch[1])
      if (!profile) {
        const source = [...store.shiftRegistrations, ...store.attendanceRecords].find((item) => item.userId === employeeMatch[1])
        if (!source) return json(response, 404, { error: 'Không tìm thấy nhân viên.' })
        profile = { id: source.userId, name: source.userName, branchId: source.branchId, role: patch.role || 'staff' }
        store.profiles.unshift(profile)
      }
      if (patch.name !== undefined) profile.name = String(patch.name || '').trim() || profile.name
      if (patch.branchId !== undefined) {
        if (!canAccessBranch(user, patch.branchId)) return json(response, 403, { error: 'Không có quyền chuyển nhân viên sang chi nhánh này.' })
        profile.branchId = patch.branchId
      }
      if (patch.role !== undefined) profile.role = patch.role
      if (patch.employmentType !== undefined) profile.employmentType = patch.employmentType
      if (patch.positionTitle !== undefined) profile.positionTitle = String(patch.positionTitle || '').trim()
      if (patch.avatarUrl !== undefined) profile.avatarUrl = String(patch.avatarUrl || '').trim() || undefined
      if (patch.employmentStatus !== undefined) profile.employmentStatus = patch.employmentStatus
      if (patch.employmentStartDate !== undefined) profile.employmentStartDate = patch.employmentStartDate || undefined
      if (patch.probationEndDate !== undefined) profile.probationEndDate = patch.probationEndDate || undefined
      if (patch.employmentEndDate !== undefined) profile.employmentEndDate = patch.employmentStatus === 'ended' ? patch.employmentEndDate : undefined
      if (patch.employmentNote !== undefined) profile.employmentNote = String(patch.employmentNote || '').slice(0, 2000)
      await persist()
      return json(response, 200, publicProfile(profile))
    }
    const employeePasswordMatch = url.pathname.match(/^\/api\/attendance\/employees\/([^/]+)\/password$/)
    if (employeePasswordMatch && request.method === 'PATCH') {
      if (!user.authenticated || user.role !== 'admin') return json(response, 403, { error: 'Chỉ Admin hệ thống được đặt lại mật khẩu.' })
      const profile = (store.profiles || []).find((item) => item.id === employeePasswordMatch[1])
      if (!profile || profile.active === false) return json(response, 404, { error: 'Không tìm thấy tài khoản.' })
      if (!canAccessBranch(user, profile.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      const { temporaryPassword } = await body(request)
      if (String(temporaryPassword || '').length < 6) return json(response, 400, { error: 'Mật khẩu tạm cần ít nhất 6 ký tự.' })
      profile.passwordHash = await hashPassword(String(temporaryPassword))
      profile.passwordUpdatedAt = new Date().toISOString()
      await persist()
      return json(response, 200, { ok: true })
    }
    if (employeeMatch && request.method === 'DELETE') {
      if (!user.authenticated || user.role !== 'admin') return json(response, 403, { error: 'Chỉ Admin hệ thống được xóa tài khoản.' })
      if (employeeMatch[1] === user.id) return json(response, 409, { error: 'Không thể xóa tài khoản đang đăng nhập.' })
      const profile = (store.profiles || []).find((item) => item.id === employeeMatch[1])
      if (!profile) return json(response, 404, { error: 'Không tìm thấy tài khoản.' })
      if (!canAccessBranch(user, profile.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      profile.active = false
      profile.passwordHash = ''
      profile.deletedAt = new Date().toISOString()
      await persist()
      return json(response, 200, { ok: true })
    }
    if (url.pathname === '/api/attendance/registrations' && request.method === 'GET') {
      const visible = user.role === 'staff'
        ? store.shiftRegistrations.filter((item) => item.branchId === user.branchId)
        : attendanceRowsAllowed(user, store.shiftRegistrations)
      return json(response, 200, attendanceFilters(visible, url))
    }
    if (url.pathname === '/api/attendance/registrations' && request.method === 'POST') {
      const payload = await body(request)
      if (payload.userId !== user.id) return json(response, 403, { error: 'Không được thêm ca cho người khác.' })
      const registration = { ...payload, status: 'approved', reviewedBy: undefined, reviewedAt: undefined, rejectionReason: undefined }
      if (!canAccessBranch(user, registration.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      const duplicate = store.shiftRegistrations.some((item) =>
        item.userId === user.id && item.workDate === registration.workDate
        && item.startTime === registration.startTime && item.endTime === registration.endTime,
      )
      if (duplicate) return json(response, 409, { error: 'Ca làm này đã được đăng ký.' })
      store.shiftRegistrations.unshift(registration)
      await persist()
      return json(response, 200, registration)
    }
    if (url.pathname === '/api/attendance/registrations/cell' && request.method === 'PUT') {
      const payload = await body(request)
      const canEdit = payload.userId === user.id || ['admin', 'manager'].includes(user.role)
      if (!canEdit) return json(response, 403, { error: 'Bạn chỉ được chỉnh lịch của chính mình.' })
      if (!['admin', 'manager'].includes(user.role) && payload.workDate < currentVietnamDateKey()) {
        return json(response, 409, { error: 'Nhân viên không thể sửa lịch của ngày đã qua.' })
      }
      if (!canAccessBranch(user, payload.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      store.shiftRegistrations = store.shiftRegistrations.filter((item) =>
        !isReplaceableScheduleRegistration(item, payload),
      )
      if (!payload.shiftId && (!payload.startTime || !payload.endTime)) {
        await persist()
        return json(response, 200, null)
      }
      const registration = {
        id: randomUUID(),
        userId: payload.userId,
        userName: payload.userName,
        branchId: payload.branchId,
        workDate: payload.workDate,
        shiftId: payload.shiftId || undefined,
        startTime: payload.startTime,
        endTime: payload.endTime,
        employmentType: payload.employmentType,
        positionTitle: payload.positionTitle,
        status: 'approved',
        note: String(payload.note || (payload.shiftId ? '' : 'Ca tuy chinh')),
        createdAt: new Date().toISOString(),
      }
      store.shiftRegistrations.unshift(registration)
      await persist()
      return json(response, 200, registration)
    }
    if (url.pathname === '/api/attendance/records' && request.method === 'GET') {
      if (autoCloseStaleAttendanceRecords() > 0) await persist()
      return json(response, 200, attendanceFilters(attendanceRowsAllowed(user, store.attendanceRecords), url))
    }
    if (url.pathname === '/api/attendance/records' && request.method === 'POST') {
      if (autoCloseStaleAttendanceRecords() > 0) await persist()
      const payload = await body(request)
      const registration = store.shiftRegistrations.find((item) => item.id === payload.shiftRegistrationId)
      if (!registration || registration.userId !== user.id || registration.status === 'rejected') {
        return json(response, 403, { error: 'Ca làm không hợp lệ hoặc không thuộc tài khoản này.' })
      }
      if (store.attendanceRecords.some((item) => item.shiftRegistrationId === registration.id)) {
        return json(response, 409, { error: 'Ca này đã check-in.' })
      }
      // Khớp ràng buộc DB thật (index attendance_records_one_open_per_user):
      // một người chỉ được một phiên chấm công đang mở.
      if (store.attendanceRecords.some((item) => item.userId === user.id && !item.checkOutTime)) {
        return json(response, 409, { error: 'Bạn đang còn một ca trong ngày chưa check-out nên chưa thể check-in ca mới. Hãy hoàn tất check-out ca đang làm.' })
      }
      const serverNow = new Date().toISOString()
      let checkInTime = serverNow
      if (payload.replayedFromOutbox === true) {
        const replayedAt = validatedAttendanceReplayTime(payload.checkInTime, { registration })
        if (!replayedAt) return json(response, 400, { error: 'Giờ check-in lưu lúc mất mạng không hợp lệ hoặc không thuộc ngày đăng ký.' })
        checkInTime = replayedAt
      }
      const profile = (store.profiles || []).find((item) => item.id === user.id)
      const record = {
        id: String(payload.id || randomUUID()),
        userId: user.id,
        userName: profile?.name || user.id,
        branchId: registration.branchId,
        shiftRegistrationId: registration.id,
        checkInTime,
        selfieUrl: payload.selfieUrl,
        checkInLatitude: payload.checkInLatitude,
        checkInLongitude: payload.checkInLongitude,
        checkInAccuracy: payload.checkInAccuracy,
        checkInAddress: payload.checkInAddress,
        createdAt: serverNow,
        updatedAt: serverNow,
      }
      store.attendanceRecords.unshift(record)
      await persist()
      return json(response, 200, record)
    }
    const recordMatch = url.pathname.match(/^\/api\/attendance\/records\/([^/]+)$/)
    if (recordMatch && request.method === 'PATCH') {
      const index = store.attendanceRecords.findIndex((item) => item.id === recordMatch[1])
      if (index < 0) return json(response, 404, { error: 'Không tìm thấy bản ghi chấm công.' })
      if (store.attendanceRecords[index].userId !== user.id) return json(response, 403, { error: 'Không thể check-out thay người khác.' })
      if (store.attendanceRecords[index].checkOutTime) return json(response, 200, store.attendanceRecords[index])
      const payload = await body(request)
      if (payload.lateCheckOutTime) {
        return json(response, 409, { error: 'Tính năng tự khai bù giờ ra đã ngừng. Ca qua ngày sẽ được hệ thống tự đóng và đưa vào danh sách lỗi cho Admin.' })
      }
      // Chỉ cho phép field bằng chứng check-out. Owner, branch, registration,
      // check-in và metadata commit luôn giữ từ bản ghi/server hiện có.
      const patch = {
        checkOutTime: payload.checkOutTime,
        replayedFromOutbox: payload.replayedFromOutbox,
        checkOutSelfieUrl: payload.checkOutSelfieUrl,
        checkOutLatitude: payload.checkOutLatitude,
        checkOutLongitude: payload.checkOutLongitude,
        checkOutAccuracy: payload.checkOutAccuracy,
        checkOutAddress: payload.checkOutAddress,
      }
      const serverNow = new Date().toISOString()
      if (patch.replayedFromOutbox === true) {
        const replayedAt = validatedAttendanceReplayTime(patch.checkOutTime, {
          checkInTime: store.attendanceRecords[index].checkInTime,
        })
        if (!replayedAt) return json(response, 400, { error: 'Giờ check-out lưu lúc mất mạng không hợp lệ.' })
        patch.checkOutTime = replayedAt
      } else {
        patch.checkOutTime = serverNow
      }
      delete patch.replayedFromOutbox
      patch.updatedAt = serverNow
      store.attendanceRecords[index] = { ...store.attendanceRecords[index], ...patch }
      await persist()
      return json(response, 200, store.attendanceRecords[index])
    }
    if (url.pathname === '/api/attendance/selfies' && request.method === 'POST') {
      const payload = await body(request)
      const registration = store.shiftRegistrations.find((item) => item.id === payload.registrationId)
      if (!registration || registration.userId !== user.id || !canAccessBranch(user, registration.branchId)) {
        return json(response, 403, { error: 'Ca làm không hợp lệ hoặc không thuộc tài khoản này.' })
      }
      const match = String(payload.dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/)
      if (!match) return json(response, 400, { error: 'Ảnh selfie không hợp lệ.' })
      await mkdir(selfieDir, { recursive: true })
      const extension = match[1] === 'png' ? 'png' : 'jpg'
      // Retry của cùng một outbox op phải ghi đè đúng file cũ; Date.now() ở đây
      // từng tạo thêm ảnh mồ côi mỗi nhịp mạng lỗi. Tên do client gửi chỉ là key,
      // luôn được làm phẳng/lọc ký tự và giới hạn độ dài trước khi chạm filesystem.
      const stableKey = String(payload.selfiePath || '')
        .replace(/\.(?:jpe?g|png)$/i, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(-80)
      const safeUserId = user.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      const safeRegistrationId = registration.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      const stableStem = `${safeUserId}-${safeRegistrationId}-${stableKey || Date.now()}`
      const fileName = `${stableStem}.${extension}`
      await writeFile(join(selfieDir, fileName), Buffer.from(match[2], 'base64'))
      return json(response, 200, { url: `/uploads/attendance-selfies/${fileName}` })
    }
  }

  if (url.pathname === '/api/movements' && request.method === 'GET') {
    return json(response, 200, store.movements.filter((item) => item.branchId === branchId))
  }
  if (url.pathname === '/api/movements' && request.method === 'POST') {
    const payload = await body(request)
    const items = Array.isArray(payload) ? payload : [payload]
    // Khớp hành vi cloud: DB thật có CHECK (quantity >= 0). LAN mà nhận số âm/NaN
    // thì dữ liệu local sẽ vỡ khi đối chiếu với Supabase.
    const invalid = items.find((item) => !item || !item.productId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0)
    if (invalid) return json(response, 400, { error: 'So luong phieu khong hop le (phai la so >= 0).' })
    const known = new Set(store.movements.map((item) => item.id))
    store.movements = [...items.filter((item) => !known.has(item.id)), ...store.movements]
    await persist()
    return json(response, 200, { ok: true })
  }
  if (url.pathname === '/api/movements' && request.method === 'DELETE') {
    const payload = await body(request)
    const ids = new Set(payload.ids || [])
    store.movements = store.movements.filter((item) => item.branchId !== branchId || !ids.has(item.id))
    await persist()
    return json(response, 200, { ok: true })
  }

  if (url.pathname === '/api/operation-day' && request.method === 'GET') {
    return json(response, 200, store.operationDays.find((item) => item.branchId === branchId && item.businessDate === date) || null)
  }
  if (url.pathname === '/api/operation-day' && request.method === 'PUT') {
    const day = await body(request)
    if (day.status === 'closed') {
      store.bagShiftSessions
        .filter((session) => session.branchId === day.branchId && session.businessDate === day.businessDate && session.status === 'open')
        .forEach((session) => closeOutstandingBagSession(session, day.closedBy || day.openedBy || '', 'Auto closed by daily report.'))
    }
    const index = store.operationDays.findIndex((item) => item.branchId === day.branchId && item.businessDate === day.businessDate)
    if (index >= 0) store.operationDays[index] = day
    else store.operationDays.unshift(day)
    await persist()
    return json(response, 200, day)
  }

  if (url.pathname === '/api/report-draft' && request.method === 'GET') {
    return json(response, 200, store.reportDrafts[draftKey(branchId, date)] || null)
  }
  if (url.pathname === '/api/report-draft' && request.method === 'PUT') {
    const draft = await body(request)
    store.reportDrafts[draftKey(branchId, date)] = { ...draft, updatedAt: new Date().toISOString() }
    await persist()
    return json(response, 200, { ok: true })
  }

  if (url.pathname === '/api/report-snapshots' && request.method === 'GET') {
    if (url.searchParams.get('latest') === '1') {
      const item = store.reportSnapshots.find((entry) => entry.branch_id === branchId)
      return json(response, 200, item?.payload || null)
    }
    return json(response, 200, store.reportSnapshots
      .filter((entry) => entry.branch_id === branchId)
      .filter((entry) => !from || entry.report_date >= from)
      .filter((entry) => !to || entry.report_date <= to)
      .map((entry) => ({
        id: entry.id,
        branchId: entry.branch_id,
        reportDate: entry.report_date,
        payload: entry.payload,
        createdAt: entry.created_at || entry.report_date,
      })))
  }
  if (url.pathname === '/api/report-snapshots' && request.method === 'POST') {
    const snapshot = await body(request)
    const index = store.reportSnapshots.findIndex((entry) =>
      entry.branch_id === snapshot.branch_id && entry.report_date === snapshot.report_date,
    )
    const merged = {
      ...snapshot,
      created_at: new Date().toISOString(),
    }
    if (index >= 0) store.reportSnapshots[index] = { ...store.reportSnapshots[index], ...merged }
    else store.reportSnapshots.unshift(merged)
    await persist()
    return json(response, 200, { ok: true })
  }

  if (url.pathname === '/api/n8n-report-image' && request.method === 'POST') {
    const lanUser = actor(request)
    const user = lanUser.authenticated
      ? { ...lanUser, authSource: 'lan' }
      : await authenticatedSupabaseReportOperator(request)
    if (!user?.authenticated) return json(response, 401, { error: 'Phiên đăng nhập không hợp lệ để xếp lịch báo cáo.' })
    if (!['shift_leader', 'admin'].includes(user.role)) {
      return json(response, 403, { error: 'Chỉ ca trưởng hoặc Admin được xếp lịch báo cáo.' })
    }
    const input = await body(request)
    if (!input || input.leaderId !== user.id || (user.authSource === 'lan' && !canAccessBranch(user, String(input.branchId || '')))) {
      return json(response, 403, { error: 'Người chốt hoặc chi nhánh báo cáo không khớp phiên đăng nhập.' })
    }
    const shiftSequence = Number(input.shiftSequence)
    const requiredKinds = shiftSequence === 1 ? ['shift-1'] : shiftSequence === 2 ? ['shift-2', 'day'] : []
    const report = input.report
    if (!requiredKinds.length || !report || !requiredKinds.includes(report.kind)) {
      return json(response, 400, { error: 'Loại báo cáo không đúng nghiệp vụ của ca.' })
    }
    if (typeof report.imageBase64 !== 'string' || !report.imageBase64.length || report.imageBase64.length > 3_200_000) {
      return json(response, 413, { error: 'Ảnh báo cáo rỗng hoặc quá lớn để đưa vào hàng đợi.' })
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(report.imageBase64)) {
      return json(response, 400, { error: 'Dữ liệu ảnh báo cáo không đúng định dạng base64.' })
    }
    let snapshot
    let shiftEntry
    let previousDelivery
    if (user.authSource === 'supabase') {
      const verified = await verifySupabaseReportShiftAndSnapshot(user, input, shiftSequence)
      if (!verified.ok) return json(response, verified.status, { error: verified.error })
      snapshot = verified.snapshot
      shiftEntry = verified.shiftEntry
      previousDelivery = verified.previousDelivery
    } else {
      const closedShift = (store.bagShiftSessions || []).find((item) =>
        item.id === input.shiftId
        && item.branchId === input.branchId
        && item.businessDate === input.businessDate
        && Number(item.sequence) === shiftSequence
        && item.leaderId === user.id
        && item.status === 'closed',
      )
      if (!closedShift) return json(response, 409, { error: 'Chỉ được xếp lịch sau khi chính ca trưởng đã đóng ca.' })
      if (shiftSequence === 2 && (store.bagShiftSessions || []).some((item) =>
        item.branchId === input.branchId && item.businessDate === input.businessDate && item.status === 'open')) {
        return json(response, 409, { error: 'Ca 2 chỉ xếp lịch cùng Tổng ngày khi không còn ca nào đang mở.' })
      }
      snapshot = (store.reportSnapshots || []).find((item) => item.branch_id === input.branchId && item.report_date === input.businessDate)
      shiftEntry = snapshot?.payload?.shiftReports?.[input.shiftId]
      if (!shiftEntry) return json(response, 409, { error: 'Báo cáo ca chưa được lưu nên chưa thể xếp lịch.' })
      previousDelivery = shiftEntry.n8nDelivery || {}
    }
    const previousJob = previousDelivery.jobs?.[report.kind]
    const sendNow = input.sendNow === true
    if (previousJob?.queued === true && !sendNow) return json(response, 200, { mode: 'n8n', idempotent: true, job: previousJob })

    if (String(process.env.N8N_REPORT_ENABLED || '').toLowerCase() !== 'true') {
      return json(response, 200, {
        mode: 'disabled',
        queued: false,
        message: 'n8n đang tắt bằng N8N_REPORT_ENABLED để kiểm thử an toàn.',
      })
    }
    const webhookUrl = process.env.N8N_REPORT_WEBHOOK_URL
    const webhookToken = process.env.N8N_REPORT_WEBHOOK_TOKEN
    if (!webhookUrl || !webhookToken) {
      return json(response, 503, { code: 'N8N_NOT_CONFIGURED', error: 'Chưa cấu hình webhook và token n8n trên server.' })
    }
    const sendTimes = { 'shift-1': '15:15', 'shift-2': '22:00', day: '22:15' }
    const jobKey = `${input.branchId}:${input.businessDate}:${report.kind}`
    const sendAt = sendNow ? currentVietnamTimestamp() : `${input.businessDate}T${sendTimes[report.kind]}:00+07:00`
    const fileName = `GUSTINO-bao-cao-${report.kind}-${input.businessDate}.jpg`
    let webhookResponse
    const webhookController = new AbortController()
    const webhookTimeout = setTimeout(() => webhookController.abort(), N8N_WEBHOOK_TIMEOUT_MS)
    try {
      webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gustino-token': webhookToken },
        signal: webhookController.signal,
        body: JSON.stringify({
          job_key: jobKey,
          branch_id: input.branchId,
          branch_name: input.branchName || input.branchId,
          business_date: input.businessDate,
          report_type: report.kind,
          report_label: report.label,
          send_at: sendAt,
          file_name: fileName,
          mime_type: 'image/jpeg',
          image_base64: report.imageBase64,
          send_now: sendNow,
          status: 'READY',
          attempts: 0,
        }),
      })
    } catch (error) {
      return json(response, 502, {
        code: 'N8N_WEBHOOK_FAILED',
        error: error instanceof Error && error.name === 'AbortError'
          ? 'Webhook n8n quá thời gian phản hồi. Kiểm tra workflow đang Active và Webhook Response Mode.'
          : 'Không kết nối được webhook n8n.',
      })
    } finally {
      clearTimeout(webhookTimeout)
    }
    if (!webhookResponse.ok) {
      const error = await n8nWebhookError(webhookResponse, webhookToken)
      return json(response, 502, { code: 'N8N_WEBHOOK_FAILED', error })
    }
    const completion = await n8nCompletedIngestion(webhookResponse, jobKey)
    if (!completion.ok) return json(response, 502, { code: completion.code, error: completion.error })
    const job = { queued: true, jobKey, sendAt, sendNow, rowNumber: completion.rowNumber, queuedAt: new Date().toISOString() }
    const delivery = {
      ...previousDelivery,
      queued: requiredKinds.every((kind) => kind === report.kind ? true : previousDelivery.jobs?.[kind]?.queued === true),
      mode: 'n8n',
      jobs: { ...(previousDelivery.jobs || {}), [report.kind]: job },
      updatedAt: new Date().toISOString(),
    }
    if (user.authSource === 'supabase') {
      await persistSupabaseN8nDelivery(user, snapshot, input.shiftId, delivery).catch(() => null)
    } else {
      shiftEntry.n8nDelivery = delivery
      await persist()
    }
    return json(response, 200, { mode: 'n8n', job })
  }

  if (url.pathname === '/api/zalo-shift-report' && request.method === 'POST') {
    const user = actor(request)
    if (!user.authenticated) return json(response, 401, { error: 'Phiên đăng nhập không hợp lệ để gửi Zalo.' })
    if (!['shift_leader', 'admin'].includes(user.role)) {
      return json(response, 403, { error: 'Chỉ ca trưởng hoặc Admin được gửi báo cáo Zalo.' })
    }
    const input = await body(request)
    if (!input || input.leaderId !== user.id || !canAccessBranch(user, String(input.branchId || ''))) {
      return json(response, 403, { error: 'Người chốt hoặc chi nhánh báo cáo không khớp phiên đăng nhập.' })
    }
    const shiftSequence = Number(input.shiftSequence)
    const requiredKinds = shiftSequence === 1 ? ['shift-1'] : shiftSequence === 2 ? ['shift-2', 'day'] : []
    const incomingKinds = Array.isArray(input.reportKinds) ? input.reportKinds : []
    const reports = Array.isArray(input.reports) ? input.reports : []
    if (!requiredKinds.length || JSON.stringify(incomingKinds) !== JSON.stringify(requiredKinds)) {
      return json(response, 400, { error: 'Gói báo cáo không đúng nghiệp vụ: Ca 1 gửi một báo cáo; Ca 2 gửi Ca 2 và Tổng ngày.' })
    }
    if (reports.length !== requiredKinds.length || reports.some((item, index) => item.kind !== requiredKinds[index])) {
      return json(response, 400, { error: 'Nội dung báo cáo không khớp thứ tự cần gửi.' })
    }
    const closedShift = (store.bagShiftSessions || []).find((item) =>
      item.id === input.shiftId
      && item.branchId === input.branchId
      && item.businessDate === input.businessDate
      && Number(item.sequence) === shiftSequence
      && item.leaderId === user.id
      && item.status === 'closed',
    )
    if (!closedShift) return json(response, 409, { error: 'Chỉ được gửi Zalo sau khi chính ca trưởng đã đóng ca.' })
    if (shiftSequence === 2 && (store.bagShiftSessions || []).some((item) =>
      item.branchId === input.branchId && item.businessDate === input.businessDate && item.status === 'open')) {
      return json(response, 409, { error: 'Ca 2 chỉ gửi cùng Tổng ngày khi không còn ca nào đang mở.' })
    }
    const snapshot = (store.reportSnapshots || []).find((item) => item.branch_id === input.branchId && item.report_date === input.businessDate)
    const shiftEntry = snapshot?.payload?.shiftReports?.[input.shiftId]
    if (!shiftEntry) return json(response, 409, { error: 'Báo cáo ca chưa được lưu nên chưa thể gửi Zalo.' })
    if (shiftEntry.zaloDelivery?.sent === true) {
      return json(response, 200, {
        sentCount: requiredKinds.length,
        messageIds: shiftEntry.zaloDelivery.messageIds || [],
        mode: shiftEntry.zaloDelivery.mode || 'text',
        idempotent: true,
        warning: 'Báo cáo này đã gửi Zalo thành công trước đó, hệ thống không gửi trùng.',
      })
    }
    const accessToken = process.env.ZALO_OA_ACCESS_TOKEN
    const groupId = process.env.ZALO_GMF_GROUP_ID
    if (!accessToken || !groupId) {
      return json(response, 503, { error: 'Chưa cấu hình ZALO_OA_ACCESS_TOKEN và ZALO_GMF_GROUP_ID trong .env.local.' })
    }
    const messageIds = []
    for (const report of reports) {
      const text = [
        `[GUSTINO] ${String(report.label || '').toLocaleUpperCase('vi')}`,
        `${input.branchName || input.branchId} · ${input.businessDate}`,
        `Ca trưởng: ${input.leaderName}`,
        `Doanh thu: ${Math.round(Number(report.revenue || 0)).toLocaleString('vi-VN')}đ`,
        `Đã bán: ${Number(report.sold || 0).toLocaleString('vi-VN')} sản phẩm`,
        `Nhân viên bán: ${Number(report.employeeCount || 0).toLocaleString('vi-VN')}`,
      ].join('\n')
      const zaloResponse = await fetch('https://openapi.zalo.me/v3.0/oa/group/message', {
        method: 'POST',
        headers: { access_token: accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { group_id: groupId }, message: { text } }),
      })
      const zaloPayload = await zaloResponse.json().catch(() => null)
      if (!zaloResponse.ok || Number(zaloPayload?.error || 0) !== 0) {
        return json(response, 502, { error: zaloPayload?.message || 'Zalo từ chối gửi báo cáo.', sentCount: messageIds.length, messageIds })
      }
      if (zaloPayload?.data?.message_id) messageIds.push(zaloPayload.data.message_id)
    }
    shiftEntry.zaloDelivery = { sent: true, messageIds, mode: 'text', sentAt: new Date().toISOString() }
    await persist()
    return json(response, 200, {
      sentCount: reports.length,
      messageIds,
      mode: 'text',
      warning: 'Đã gửi nội dung báo cáo. Ảnh infographic chờ Zalo cung cấp contract gửi ảnh GMF chính thức.',
    })
  }

  if (url.pathname === '/api/inventory-reports' && request.method === 'POST') {
    store.inventoryReports.unshift(await body(request))
    await persist()
    return json(response, 200, { ok: true })
  }
  if (url.pathname === '/api/inventory-reports' && request.method === 'GET') {
    return json(response, 200, store.inventoryReports.filter((item) => item.branchId === branchId))
  }
  return json(response, 404, { error: 'Not found' })
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

function isReplaceableScheduleRegistration(item, payload) {
  if (
    item.userId !== payload.userId
    || item.branchId !== payload.branchId
    || item.workDate !== payload.workDate
  ) return false
  if (store.attendanceRecords.some((record) => record.shiftRegistrationId === item.id)) return false
  const note = String(item.note || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const isSupplemental = ['tang ca', 'bo sung', 'phat sinh'].some((keyword) => note.includes(keyword))
  return Boolean(item.shiftId) || !isSupplemental
}

function normalizeUsername(value) {
  return value.trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '.').replace(/[^a-z0-9._@-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
}

async function serveStatic(response, pathname) {
  if (pathname.startsWith('/uploads/attendance-selfies/')) {
    const fileName = pathname.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '')
    const content = await readFile(join(selfieDir, fileName))
    response.writeHead(200, { 'Content-Type': extname(fileName) === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600' })
    response.end(content)
    return
  }
  if (pathname.startsWith('/uploads/shift-proofs/')) {
    const fileName = pathname.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '')
    const content = await readFile(join(shiftProofDir, fileName))
    response.writeHead(200, { 'Content-Type': extname(fileName) === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600' })
    response.end(content)
    return
  }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '')
  let file = join(dist, safePath)
  try {
    if (!(await stat(file)).isFile()) throw new Error()
  } catch {
    file = join(dist, 'index.html')
  }
  const content = await readFile(file)
  response.writeHead(200, {
    'Content-Type': mime[extname(file)] || 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') || file.endsWith('sw.js') ? 'no-store' : 'public, max-age=3600',
  })
  response.end(content)
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url)
    else await serveStatic(response, url.pathname)
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : 'Server error' })
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`GUSTINO LAN sync server: http://0.0.0.0:${port}`)
})
