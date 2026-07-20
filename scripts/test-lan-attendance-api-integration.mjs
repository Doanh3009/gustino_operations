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

  const selfie = await jsonRequest('/api/attendance/selfies', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      registrationId,
      branchId: user.branchId,
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    }),
  })
  assert.match(selfie.url, /attendance-selfies/)

  const recordId = randomUUID()
  const checkedIn = await jsonRequest('/api/attendance/records', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: recordId,
      userId: user.id,
      userName: user.name,
      branchId: user.branchId,
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
  assert.notEqual(checkedIn.checkInTime, '2000-01-01T00:00:00.000Z', 'Server phải ghi thời gian check-in tin cậy.')

  const checkoutPayload = {
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
  assert.notEqual(checkedOut.checkOutTime, checkoutPayload.checkOutTime, 'Server phải ghi thời gian check-out tin cậy.')

  const repeatedCheckout = await jsonRequest(`/api/attendance/records/${recordId}`, {
    method: 'PATCH', headers, body: JSON.stringify(checkoutPayload),
  })
  assert.equal(repeatedCheckout.checkOutTime, checkedOut.checkOutTime, 'Retry checkout phải trả lại bản ghi đã lưu, không ghi đè thời gian.')

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
