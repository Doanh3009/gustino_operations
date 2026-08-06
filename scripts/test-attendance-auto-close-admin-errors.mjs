import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [attendancePage, attendanceLib, adminPage, autoCloseApi, lanServer] = await Promise.all([
  readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../api/auto-close-day.ts', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/lan-server.mjs', import.meta.url), 'utf8'),
])

// Nhân viên không còn được mời tự khai/chấm bù giờ ra.
assert.doesNotMatch(attendancePage, /Check-out bù/)
assert.doesNotMatch(attendancePage, /lateCheckOut\(/)
assert.doesNotMatch(attendancePage, /<option value="missing_checkout">/)
assert.match(attendancePage, /Hệ thống sẽ tự đóng ca này khi sang ngày mới/)

// Cloud cron phải nhận diện bằng marker máy đọc được và phân trang hết tập mở;
// 200 nhân viên đầu không được làm các nhân viên sau bị treo sang hôm sau.
assert.match(autoCloseApi, /ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX/)
assert.match(autoCloseApi, /offset=\$\{offset\}/)
assert.match(autoCloseApi, /check_out_time=is\.null/)
assert.match(autoCloseApi, /inBatches\(eligible, 12/)
assert.match(autoCloseApi, /failed \+= 1/)

// LAN phải tự đóng tương đương trước khi trả danh sách hoặc xét check-in mới.
assert.match(lanServer, /autoCloseStaleAttendanceRecords/)
assert.match(lanServer, /ATTENDANCE_AUTO_CLOSE_ADDRESS_PREFIX/)
assert.doesNotMatch(lanServer, /Hãy check-out \(hoặc "Check-out bù"\)/)

// Admin có danh sách riêng, nhận diện từ chính bản ghi chấm công đã tự đóng.
assert.match(attendanceLib, /isAttendanceAutoClosedError/)
assert.match(adminPage, /attendanceAutoCloseErrors/)
assert.match(adminPage, /LỖI CHẤM CÔNG TỰ ĐÓNG/)
assert.match(adminPage, /Chỉnh công ngay/)

// Kiểm chứng runtime cloud: page thứ hai vẫn được đọc và cả hai ca cũ đều đóng
// đúng giờ tan ca, không dùng giờ cron chạy.
const previousEnv = {
  CRON_SECRET: process.env.CRON_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}
const previousFetch = globalThis.fetch

try {
  process.env.CRON_SECRET = 'attendance-auto-close-test'
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
  const { default: handler } = await import(`../api/auto-close-day.ts?attendance-errors=${Date.now()}`)
  const today = vietnamDateKey(new Date())
  const staleDate = addDays(today, -2)
  const patchBodies = []
  const attendanceQueries = []
  let patchInFlight = 0
  let maxPatchInFlight = 0

  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url))
    const path = parsed.pathname + parsed.search
    if (path.startsWith('/rest/v1/operation_days?')) return jsonResponse([])
    if (path.startsWith('/rest/v1/attendance_records?') && (init.method || 'GET') === 'GET') {
      attendanceQueries.push(path)
      const offset = Number(parsed.searchParams.get('offset') || 0)
      if (offset === 0) {
        return jsonResponse([
          staleOpenRow('stale-1', staleDate, '08:00:00', '16:00:00'),
          ...Array.from({ length: 12 }, (_, index) => staleOpenRow(`stale-batch-${index}`, staleDate, '08:00:00', '16:00:00')),
          ...Array.from({ length: 187 }, (_, index) => staleOpenRow(`today-${index}`, today, '08:00:00', '16:00:00')),
        ])
      }
      if (offset === 200) {
        return jsonResponse([
          staleOpenRow('stale-2', staleDate, '14:00:00', '22:00:00'),
          // BUG-130: check-in SAU giờ tan ca (18:19 cho ca 10:00–18:00) trước đây bị
          // skip vĩnh viễn → phiên treo khóa Check-in mọi ngày sau.
          staleOpenRow('stale-late', staleDate, '10:00:00', '18:00:00', `${staleDate}T18:19:00+07:00`),
          // BUG-130: ca mở dài bất thường (>18h) cũng bị skip vĩnh viễn.
          staleOpenRow('stale-long', staleDate, '08:00:00', '22:00:00', `${staleDate}T00:30:00+07:00`),
        ])
      }
      return jsonResponse([])
    }
    if (parsed.pathname === '/rest/v1/attendance_records' && init.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      patchBodies.push(body)
      const id = parsed.searchParams.get('id')?.replace('eq.', '') || ''
      patchInFlight += 1
      maxPatchInFlight = Math.max(maxPatchInFlight, patchInFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      patchInFlight -= 1
      if (id === 'stale-batch-6') return new Response('mock isolated row failure', { status: 500 })
      return jsonResponse([{ id }])
    }
    return new Response(null, { status: 204 })
  }

  const response = responseRecorder()
  await handler({ method: 'GET', headers: { authorization: 'Bearer attendance-auto-close-test' } }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.attendanceAutoClose.eligible, 16)
  assert.equal(response.body.attendanceAutoClose.closed, 15)
  assert.equal(response.body.attendanceAutoClose.failed, 1)
  assert.equal(attendanceQueries.length, 2)
  assert.ok(attendanceQueries[1].includes('offset=200'))
  assert.equal(patchBodies.length, 16)
  assert.ok(maxPatchInFlight > 1 && maxPatchInFlight <= 12)
  assert.ok(patchBodies.every((body) => String(body.check_out_address).startsWith('[CHỐT HÀNH CHÍNH] [LỖI QUÊN CHECK-OUT]')))
  assert.equal(patchBodies[0].check_out_time, new Date(`${staleDate}T16:00:00+07:00`).toISOString())
  // BUG-130: check-in muộn hơn giờ tan ca → đóng bằng ĐÚNG thời điểm check-in
  // (0 giờ công, không bịa giờ làm) kèm lý do máy đọc được cho Admin.
  const lateBody = patchBodies.find((body) => String(body.check_out_address).includes('sau giờ tan ca'))
  assert.ok(lateBody, 'thiếu bản vá đóng ca check-in sau giờ tan ca')
  assert.equal(lateBody.check_out_time, new Date(`${staleDate}T18:19:00+07:00`).toISOString())
  // BUG-130: ca mở >18h vẫn phải đóng theo giờ tan ca của lịch, không skip vĩnh viễn.
  const longBody = patchBodies.find((body) => String(body.check_out_address).includes('dài bất thường'))
  assert.ok(longBody, 'thiếu bản vá đóng ca mở dài bất thường')
  assert.equal(longBody.check_out_time, new Date(`${staleDate}T22:00:00+07:00`).toISOString())
  // Không còn bất kỳ nhánh skip nào để phiên ngày cũ treo vĩnh viễn.
  assert.doesNotMatch(autoCloseApi, /scheduledEnd\.getTime\(\) <= checkIn\.getTime\(\)[\s\S]{0,120}skipped \+= 1/)
  assert.match(lanServer, /sau giờ tan ca/)
  assert.match(lanServer, /dài bất thường/)
} finally {
  globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

console.log('ATTENDANCE_AUTO_CLOSE_ADMIN_ERRORS_OK')

function staleOpenRow(id, workDate, startTime, endTime, checkInIso) {
  return {
    id,
    user_id: `user-${id}`,
    check_in_time: new Date(checkInIso || `${workDate}T${startTime}+07:00`).toISOString(),
    shift_registrations: { work_date: workDate, start_time: startTime, end_time: endTime },
  }
}

function vietnamDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10)
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader(key, value) { this.headers[key] = value },
  }
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
