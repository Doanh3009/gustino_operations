import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'dist')
const dataDir = process.env.GUSTINO_DATA_DIR ? resolve(root, process.env.GUSTINO_DATA_DIR) : join(root, 'data')
const dataFile = join(dataDir, 'lan-store.json')
const selfieDir = join(dataDir, 'attendance-selfies')
const shiftProofDir = join(dataDir, 'shift-proofs')
const port = Number(process.env.GUSTINO_API_PORT || 5177)
const scrypt = promisify(scryptCallback)

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
  supplyRequests: [],
  profiles: [],
  commissionRules: [],
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
for (const branchId of ['gold-coast', 'lotte-2310', 'lotte-vt']) {
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
const defaultAccounts = [
  { id: 'demo-manager', name: 'Quản lý Demo', email: 'quanly@gustino.vn', role: 'manager', branchId: 'gold-coast', branchIds: ['gold-coast', 'lotte-2310', 'lotte-vt'], employmentType: 'leader', positionTitle: 'Quản lý' },
  { id: 'demo-shift-leader', name: 'Ca trưởng Demo', email: 'catruong@gustino.vn', role: 'shift_leader', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'leader', positionTitle: 'Ca trưởng' },
  { id: 'demo-staff', name: 'Nhân viên Demo', email: 'nhanvien@gustino.vn', role: 'staff', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'part_time', positionTitle: 'Part-time' },
  { id: 'demo-kitchen', name: 'Bếp Demo', email: 'bep@gustino.vn', role: 'kitchen', branchId: 'gold-coast', branchIds: ['gold-coast'], employmentType: 'part_time', positionTitle: 'Bếp' },
]
let seededDefaultAccounts = false
for (const account of defaultAccounts) {
  if (!(store.profiles || []).some((profile) => profile.id === account.id)) {
    store.profiles.push({
      ...account,
      active: true,
      passwordHash: await hashPassword('123456'),
      passwordUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })
    seededDefaultAccounts = true
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

function canAccessBranch(user, branchId) {
  return user.branchId === branchId || (user.role === 'manager' && user.branchIds.includes(branchId))
}

function attendanceRowsAllowed(user, rows, ownerField = 'userId') {
  if (user.role === 'manager' || user.role === 'shift_leader') return rows.filter((item) => canAccessBranch(user, item.branchId))
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
    && (!from || (item.workDate || item.checkInTime.slice(0, 10)) >= from)
    && (!to || (item.workDate || item.checkInTime.slice(0, 10)) <= to)
  )
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
    employmentType: profile.employmentType,
    positionTitle: profile.positionTitle,
  }
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') return json(response, 200, {})
  const branchId = url.searchParams.get('branchId') || ''
  const date = url.searchParams.get('date') || ''

  if (url.pathname === '/api/health') return json(response, 200, { ok: true, updatedAt: new Date().toISOString() })
  if (url.pathname === '/api/commission-rules' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const branchIds = Array.from(new Set([user.branchId, ...(user.branchIds || [])]))
    return json(response, 200, (store.commissionRules || []).filter((rule) => branchIds.includes(rule.branchId)))
  }
  if (url.pathname === '/api/commission-rules' && request.method === 'PUT') {
    const user = actor(request)
    if (user.role !== 'manager') return json(response, 403, { error: 'Chỉ Quản lý được đổi chính sách hoa hồng.' })
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
  if (url.pathname === '/api/reverse-geocode' && request.method === 'GET') {
    const latitude = Number(url.searchParams.get('lat'))
    const longitude = Number(url.searchParams.get('lng'))
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json(response, 400, { error: 'Tọa độ không hợp lệ.' })
    return json(response, 200, { address: `Vị trí GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)}` })
  }

  if (url.pathname === '/api/supply-requests' && request.method === 'GET') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    const requestedBranchIds = (url.searchParams.get('branchIds') || user.branchId).split(',').filter(Boolean)
    const allowedBranchIds = user.role === 'manager'
      ? requestedBranchIds.filter((id) => canAccessBranch(user, id))
      : [user.branchId]
    const rows = (store.supplyRequests || [])
      .filter((item) => allowedBranchIds.includes(item.branchId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 80)
    return json(response, 200, rows)
  }

  if (url.pathname === '/api/supply-requests' && request.method === 'POST') {
    const user = actor(request)
    if (!user.id) return json(response, 401, { error: 'Chưa đăng nhập.' })
    if (!['shift_leader', 'manager'].includes(user.role)) return json(response, 403, { error: 'Chỉ ca trưởng hoặc quản lý được gửi đơn đặt bếp.' })
    const input = await body(request)
    const branchId = String(input.branchId || user.branchId)
    if (!canAccessBranch(user, branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
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
    if (!['kitchen', 'manager'].includes(user.role)) return json(response, 403, { error: 'Chỉ bếp hoặc quản lý được cập nhật đơn.' })
    const index = (store.supplyRequests || []).findIndex((item) => item.id === supplyRequestMatch[1])
    if (index < 0) return json(response, 404, { error: 'Không tìm thấy đơn đặt bếp.' })
    if (!canAccessBranch(user, store.supplyRequests[index].branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
    const patch = await body(request)
    if (!['pending', 'acknowledged', 'fulfilled', 'cancelled'].includes(patch.status)) return json(response, 400, { error: 'Trạng thái không hợp lệ.' })
    store.supplyRequests[index] = {
      ...store.supplyRequests[index],
      status: patch.status,
      updatedAt: new Date().toISOString(),
    }
    await persist()
    return json(response, 200, store.supplyRequests[index])
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
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      return json(response, 200, rows)
    }
    if (url.pathname === '/api/shift-ledger/sessions' && request.method === 'POST') {
      if (!canWrite) return json(response, 403, { error: 'Chỉ ca trưởng được nhận ca.' })
      const session = await body(request)
      if (!canAccessBranch(user, session.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
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
      const username = normalizeUsername(String(credentials.username || credentials.email || ''))
      const email = username.includes('@') ? username : `${username}@accounts.gustino.vn`
      const profile = (store.profiles || []).find((item) =>
        String(item.email || '').toLowerCase() === email
        || normalizeUsername(String(item.email || '').split('@')[0]) === username,
      )
      if (!profile || profile.active === false || !(await passwordMatches(String(credentials.password || ''), profile.passwordHash))) {
        return json(response, 401, { error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
      }
      const authToken = randomBytes(32).toString('hex')
      const branchIds = profile.role === 'manager'
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
    if (url.pathname === '/api/attendance/employees' && request.method === 'GET') {
      const profiles = new Map()
      for (const item of store.profiles || []) {
        if (item.id && canAccessBranch(user, item.branchId)) profiles.set(item.id, item)
      }
      for (const item of [...store.shiftRegistrations, ...store.attendanceRecords]) {
        if (item.userId && item.userName && canAccessBranch(user, item.branchId)) {
          const existing = profiles.get(item.userId)
          profiles.set(item.userId, { id: item.userId, name: item.userName, role: existing?.role || 'staff', branchId: item.branchId })
        }
      }
      profiles.set(user.id, { id: user.id, name: user.id === 'demo-shift-leader' ? 'Ca trưởng Demo' : user.id, role: user.role, branchId: user.branchId })
      return json(response, 200, Array.from(profiles.values()).map(publicProfile))
    }
    if (url.pathname === '/api/attendance/employees' && request.method === 'POST') {
      if (!user.authenticated || user.role !== 'manager') return json(response, 403, { error: 'Vui lòng đăng nhập lại bằng tài khoản Quản lý.' })
      const input = await body(request)
      const username = normalizeUsername(String(input.username || ''))
      const email = String(input.email || `${username}@accounts.gustino.vn`).trim().toLowerCase()
      const password = String(input.temporaryPassword || '')
      const name = String(input.name || '').trim()
      if (!name || username.length < 3 || !email.includes('@')) return json(response, 400, { error: 'Tên và tên đăng nhập không hợp lệ.' })
      if (password.length < 6) return json(response, 400, { error: 'Mật khẩu tạm cần ít nhất 6 ký tự.' })
      if (!canAccessBranch(user, input.branchId)) return json(response, 403, { error: 'Không có quyền tạo tài khoản tại chi nhánh này.' })
      if (!['manager', 'shift_leader', 'staff', 'kitchen'].includes(input.role)) return json(response, 400, { error: 'Vai trò không hợp lệ.' })
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
        branchId: input.branchId,
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
      if (!user.authenticated || user.role !== 'manager') return json(response, 403, { error: 'Vui lòng đăng nhập lại bằng tài khoản Quản lý.' })
      const patch = await body(request)
      if (patch.role && !['manager', 'shift_leader', 'staff', 'kitchen'].includes(patch.role)) {
        return json(response, 400, { error: 'Vai trò không hợp lệ.' })
      }
      if (patch.employmentType && !['leader', 'full_time', 'part_time'].includes(patch.employmentType)) {
        return json(response, 400, { error: 'Nhóm ca không hợp lệ.' })
      }
      if (employeeMatch[1] === user.id && patch.role && patch.role !== 'manager') {
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
      await persist()
      return json(response, 200, publicProfile(profile))
    }
    const employeePasswordMatch = url.pathname.match(/^\/api\/attendance\/employees\/([^/]+)\/password$/)
    if (employeePasswordMatch && request.method === 'PATCH') {
      if (!user.authenticated || user.role !== 'manager') return json(response, 403, { error: 'Vui lòng đăng nhập lại bằng tài khoản Quản lý.' })
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
      if (!user.authenticated || user.role !== 'manager') return json(response, 403, { error: 'Vui lòng đăng nhập lại bằng tài khoản Quản lý.' })
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
      const canEdit = payload.userId === user.id || user.role === 'manager'
      if (!canEdit) return json(response, 403, { error: 'Bạn chỉ được chỉnh lịch của chính mình.' })
      if (user.role !== 'manager' && payload.workDate < new Date().toISOString().slice(0, 10)) {
        return json(response, 409, { error: 'Nhân viên không thể sửa lịch của ngày đã qua.' })
      }
      if (!canAccessBranch(user, payload.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      store.shiftRegistrations = store.shiftRegistrations.filter((item) =>
        !(item.userId === payload.userId && item.branchId === payload.branchId && item.workDate === payload.workDate),
      )
      if (!payload.shiftId) {
        await persist()
        return json(response, 200, null)
      }
      const registration = {
        id: randomUUID(),
        userId: payload.userId,
        userName: payload.userName,
        branchId: payload.branchId,
        workDate: payload.workDate,
        shiftId: payload.shiftId,
        startTime: payload.startTime,
        endTime: payload.endTime,
        employmentType: payload.employmentType,
        positionTitle: payload.positionTitle,
        status: 'approved',
        note: '',
        createdAt: new Date().toISOString(),
      }
      store.shiftRegistrations.unshift(registration)
      await persist()
      return json(response, 200, registration)
    }
    if (url.pathname === '/api/attendance/records' && request.method === 'GET') {
      return json(response, 200, attendanceFilters(attendanceRowsAllowed(user, store.attendanceRecords), url))
    }
    if (url.pathname === '/api/attendance/records' && request.method === 'POST') {
      const record = await body(request)
      const registration = store.shiftRegistrations.find((item) => item.id === record.shiftRegistrationId)
      if (!registration || registration.userId !== user.id || registration.status === 'rejected') {
        return json(response, 403, { error: 'Ca làm không hợp lệ hoặc không thuộc tài khoản này.' })
      }
      if (store.attendanceRecords.some((item) => item.shiftRegistrationId === registration.id)) {
        return json(response, 409, { error: 'Ca này đã check-in.' })
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
      if (store.attendanceRecords[index].checkOutTime) return json(response, 409, { error: 'Ca này đã check-out.' })
      store.attendanceRecords[index] = { ...store.attendanceRecords[index], ...await body(request) }
      await persist()
      return json(response, 200, store.attendanceRecords[index])
    }
    if (url.pathname === '/api/attendance/selfies' && request.method === 'POST') {
      const payload = await body(request)
      if (!canAccessBranch(user, payload.branchId)) return json(response, 403, { error: 'Không có quyền tại chi nhánh này.' })
      const match = String(payload.dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/)
      if (!match) return json(response, 400, { error: 'Ảnh selfie không hợp lệ.' })
      await mkdir(selfieDir, { recursive: true })
      const extension = match[1] === 'png' ? 'png' : 'jpg'
      const fileName = `${user.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${payload.registrationId}-${Date.now()}.${extension}`
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
