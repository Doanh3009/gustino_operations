import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const root = new URL('../', import.meta.url)
const temporaryData = await mkdtemp(join(tmpdir(), 'gustino-attendance-api-'))
const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['scripts/lan-server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    GUSTINO_API_PORT: String(port),
    GUSTINO_DATA_DIR: temporaryData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverErrors = ''
server.stderr.on('data', (chunk) => { serverErrors += String(chunk) })

try {
  await waitUntilReady()
  const user = await jsonRequest('/api/attendance/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'nhanvien', password: '123456' }),
  })
  assert.equal(user.role, 'staff')
  const headers = {
    Authorization: `Bearer ${user.authToken}`,
    'Content-Type': 'application/json',
  }
  const registrationId = randomUUID()
  const registration = await jsonRequest('/api/attendance/registrations', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: registrationId,
      userId: user.id,
      userName: user.name,
      branchId: user.branchId,
      workDate: '2099-12-29',
      startTime: '08:00',
      endTime: '16:00',
      status: 'approved',
      note: 'Kiểm thử cô lập',
      createdAt: new Date().toISOString(),
    }),
  })
  assert.equal(registration.status, 'approved')

  const stableSelfiePath = '../../victim/known-selfie.jpg'
  const selfiePayload = {
    registrationId,
    branchId: user.branchId,
    selfiePath: stableSelfiePath,
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  }
  const selfie = await jsonRequest('/api/attendance/selfies', {
    method: 'POST',
    headers,
    body: JSON.stringify(selfiePayload),
  })
  assert.match(selfie.url, /attendance-selfies/)
  assert.ok(selfie.url.includes(user.id.replace(/[^a-zA-Z0-9_-]/g, '_')), 'LAN phải namespace file ảnh theo user đã xác thực, không tin path client.')
  const retriedSelfie = await jsonRequest('/api/attendance/selfies', {
    method: 'POST', headers, body: JSON.stringify(selfiePayload),
  })
  assert.equal(retriedSelfie.url, selfie.url, 'Retry cùng outbox op phải ghi lại đúng một đường dẫn ảnh LAN, không tạo file Date.now mới.')

  const recordId = randomUUID()
  const checkedIn = await jsonRequest('/api/attendance/records', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: recordId,
      userId: 'forged-user',
      userName: 'Forged User',
      branchId: 'forged-branch',
      shiftRegistrationId: registrationId,
      checkInTime: '2000-01-01T00:00:00.000Z',
      selfieUrl: selfie.url,
      checkInLatitude: 10.346,
      checkInLongitude: 107.084,
      checkInAccuracy: 12,
      checkInAddress: 'Vũng Tàu',
    }),
  })
  assert.equal(checkedIn.id, recordId)
  assert.equal(checkedIn.userId, user.id, 'LAN phải lấy userId từ session, không tin payload.')
  assert.equal(checkedIn.branchId, user.branchId, 'LAN phải lấy branchId từ registration, không tin payload.')
  assert.notEqual(checkedIn.checkInTime, '2000-01-01T00:00:00.000Z', 'Server phải ghi thời gian check-in tin cậy.')

  const checkoutPayload = {
    userId: 'forged-user',
    branchId: 'forged-branch',
    checkInTime: '1999-01-01T00:00:00.000Z',
    checkOutTime: '2000-01-01T00:00:00.000Z',
    checkOutSelfieUrl: selfie.url,
    checkOutLatitude: 10.346,
    checkOutLongitude: 107.084,
    checkOutAccuracy: 12,
    checkOutAddress: 'Vũng Tàu',
  }
  const checkedOut = await jsonRequest(`/api/attendance/records/${recordId}`, {
    method: 'PATCH', headers, body: JSON.stringify(checkoutPayload),
  })
  assert.ok(checkedOut.checkOutTime)
  assert.equal(checkedOut.userId, user.id, 'PATCH không được đổi owner bản ghi.')
  assert.equal(checkedOut.branchId, user.branchId, 'PATCH không được đổi chi nhánh bản ghi.')
  assert.equal(checkedOut.checkInTime, checkedIn.checkInTime, 'PATCH không được sửa ngược giờ check-in.')
  assert.notEqual(checkedOut.checkOutTime, checkoutPayload.checkOutTime, 'Server phải ghi thời gian check-out tin cậy.')

  const repeatedCheckout = await jsonRequest(`/api/attendance/records/${recordId}`, {
    method: 'PATCH', headers, body: JSON.stringify(checkoutPayload),
  })
  assert.equal(repeatedCheckout.checkOutTime, checkedOut.checkOutTime, 'Retry checkout phải trả lại bản ghi đã lưu, không ghi đè thời gian.')

  const replayCapturedAt = new Date(Date.now() - 5 * 60_000)
  replayCapturedAt.setUTCSeconds(0, 0)
  const replayShiftStartMinutes = (vietnamMinuteOfDay(replayCapturedAt) + 12 * 60) % (24 * 60)
  const replayShiftEndMinutes = (replayShiftStartMinutes + 60) % (24 * 60)
  const replayRegistrationId = randomUUID()
  await jsonRequest('/api/attendance/registrations', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: replayRegistrationId,
      userId: user.id,
      userName: user.name,
      branchId: user.branchId,
      workDate: vietnamDateKey(replayCapturedAt),
      startTime: clockTime(replayShiftStartMinutes),
      endTime: clockTime(replayShiftEndMinutes),
      status: 'approved',
      note: 'Kiểm thử replay mất mạng',
      createdAt: new Date().toISOString(),
    }),
  })
  const replayRecordId = randomUUID()
  const replayedCheckIn = await jsonRequest('/api/attendance/records', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: replayRecordId,
      userId: user.id,
      userName: user.name,
      branchId: user.branchId,
      shiftRegistrationId: replayRegistrationId,
      replayedFromOutbox: true,
      checkInTime: replayCapturedAt.toISOString(),
      selfieUrl: selfie.url,
    }),
  })
  assert.equal(replayedCheckIn.checkInTime, replayCapturedAt.toISOString(), 'Replay phải giữ đúng giờ bấm check-in lúc mất mạng, kể cả ngoài giờ ca nhưng vẫn đúng ngày như UI hiện tại cho phép.')
  assert.equal(replayedCheckIn.replayedFromOutbox, undefined, 'Cờ vận chuyển outbox không được lưu vào bản ghi chấm công.')
  assert.notEqual(replayedCheckIn.createdAt, replayCapturedAt.toISOString(), 'createdAt phải phản ánh lúc LAN commit, không giả thành lúc người dùng bấm.')

  await assert.rejects(
    jsonRequest(`/api/attendance/records/${replayRecordId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        replayedFromOutbox: true,
        checkOutTime: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
    }),
    /400 Giờ check-out lưu lúc mất mạng không hợp lệ/,
    'LAN phải từ chối timestamp replay ở tương lai.',
  )
  const replayCheckoutAt = new Date(Date.now() - 60_000).toISOString()
  const replayedCheckOut = await jsonRequest(`/api/attendance/records/${replayRecordId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      replayedFromOutbox: true,
      checkOutTime: replayCheckoutAt,
      checkOutSelfieUrl: selfie.url,
    }),
  })
  assert.equal(replayedCheckOut.checkOutTime, replayCheckoutAt, 'Replay phải giữ đúng giờ nhân viên bấm check-out lúc mất mạng.')
  assert.equal(replayedCheckOut.replayedFromOutbox, undefined, 'Cờ replay checkout không được lưu vào bản ghi.')
  assert.notEqual(replayedCheckOut.updatedAt, replayCheckoutAt, 'updatedAt phải phản ánh lúc LAN commit, không giả thành giờ chấm gốc.')

  const records = await jsonRequest(`/api/attendance/records?userId=${encodeURIComponent(user.id)}`, { headers })
  assert.equal(records.filter((record) => record.id === recordId).length, 1)
  assert.equal(records.find((record) => record.id === recordId)?.checkOutTime, checkedOut.checkOutTime)
  console.log('LAN_ATTENDANCE_API_INTEGRATION_OK')
} finally {
  if (server.exitCode === null) {
    server.kill()
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ])
  }
  await rm(temporaryData, { recursive: true, force: true })
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${response.status} ${payload?.error || JSON.stringify(payload)}`)
  return payload
}

async function waitUntilReady() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`LAN server dừng sớm: ${serverErrors}`)
    try {
      const response = await fetch(`${baseUrl}/api/server-time`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`LAN server không khởi động kịp: ${serverErrors}`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function vietnamDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function vietnamMinuteOfDay(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0)
  return get('hour') * 60 + get('minute')
}

function clockTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}
