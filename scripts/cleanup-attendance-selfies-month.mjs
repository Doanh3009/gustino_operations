import { spawnSync } from 'node:child_process'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'smtaiourlpqwmiulxuri'
const BUCKET = 'attendance-selfies'
const TARGET_MONTH = process.argv.find((value) => /^\d{4}-\d{2}$/.test(value)) || ''
const EXECUTE = process.argv.includes('--execute')

if (!TARGET_MONTH) {
  throw new Error('Usage: node scripts/cleanup-attendance-selfies-month.mjs YYYY-MM [--execute]')
}

const [yearText, monthText] = TARGET_MONTH.split('-')
const year = Number(yearText)
const month = Number(monthText)
const startUtc = new Date(Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000)
const endUtc = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) - 7 * 60 * 60 * 1000)

function loadServiceRoleKey() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return null
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(command, [
    '--yes',
    'supabase@2.108.0',
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--output',
    'json',
  ], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' })
  if (result.status !== 0) return null
  const keys = JSON.parse(result.stdout)
  const serviceRole = keys.find((item) => item.name === 'service_role')
    || keys.find((item) => {
      try {
        const payload = JSON.parse(Buffer.from(item.api_key.split('.')[1], 'base64url').toString('utf8'))
        return payload.role === 'service_role'
      } catch {
        return false
      }
    })
  return serviceRole?.api_key || null
}

const serviceRoleKey = loadServiceRoleKey()
const baseUrl = `https://${PROJECT_REF}.supabase.co`
const publicCredentials = serviceRoleKey ? null : await loadPublicCredentials()
const accessToken = serviceRoleKey || await loginAdmin(publicCredentials)
const headers = {
  apikey: serviceRoleKey || publicCredentials.anonKey,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
}

async function loadPublicCredentials() {
  const indexResponse = await fetch('https://gustino-operations.vercel.app/')
  if (!indexResponse.ok) throw new Error(`Không đọc được live app: HTTP ${indexResponse.status}`)
  const index = await indexResponse.text()
  const scripts = [...index.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map((match) => match[1])
  for (const script of scripts) {
    const assetUrl = new URL(script, 'https://gustino-operations.vercel.app/').href
    const assetResponse = await fetch(assetUrl)
    if (!assetResponse.ok) continue
    const source = await assetResponse.text()
    const url = source.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
    const publishableKey = source.match(/sb_publishable_[a-zA-Z0-9_-]+/)?.[0]
    const jwtCandidates = source.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) || []
    const legacyAnonKey = jwtCandidates.find((value) => {
      try {
        const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'))
        return payload.role === 'anon' && payload.ref === PROJECT_REF
      } catch {
        return false
      }
    })
    const anonKey = publishableKey || legacyAnonKey
    if (url?.includes(PROJECT_REF) && anonKey) return { url, anonKey }
  }
  throw new Error('Không tìm thấy Supabase public config trong live bundle.')
}

async function loginAdmin(credentials) {
  const failures = []
  for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn', 'minhtien@accounts.gustino.vn', 'minhtien@gustino.vn']) {
    const response = await fetch(`${credentials.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: credentials.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: '123456' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) return (await response.json()).access_token
    const body = await response.text()
    failures.push({ account: email.split('@')[0], status: response.status, message: body.slice(0, 300) })
    if (/exceed_storage_size_quota|restricted/i.test(body)) {
      throw new Error(`Supabase Auth đang bị giới hạn dịch vụ: HTTP ${response.status} ${body}`)
    }
  }
  throw new Error(`Không đăng nhập được tài khoản production để kiểm kê: ${JSON.stringify(failures)}`)
}

async function checkedFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${options.method || 'GET'} ${new URL(url).pathname}: HTTP ${response.status} ${body}`)
  }
  return response
}

async function listAttendanceRecords() {
  const rows = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      select: 'id,check_in_time,selfie_url,check_out_selfie_url',
      order: 'check_in_time.asc',
    })
    const response = await checkedFetch(`${baseUrl}/rest/v1/attendance_records?${query}`, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` },
    })
    const page = await response.json()
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

async function listStorageFolder(prefix = '') {
  const entries = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const response = await checkedFetch(`${baseUrl}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    const page = await response.json()
    entries.push(...page)
    if (page.length < pageSize) return entries
  }
}

async function listAllStorageObjects(prefix = '') {
  const result = []
  const entries = await listStorageFolder(prefix)
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id) result.push({ ...entry, path })
    else result.push(...await listAllStorageObjects(path))
  }
  return result
}

function storagePath(value) {
  if (!value) return null
  const raw = String(value)
  if (!raw.includes('://')) return raw.replace(/^attendance-selfies\//, '').replace(/^\/+/, '')
  const decoded = decodeURIComponent(new URL(raw).pathname)
  const markers = [
    `/storage/v1/object/public/${BUCKET}/`,
    `/storage/v1/object/sign/${BUCKET}/`,
    `/storage/v1/object/${BUCKET}/`,
  ]
  for (const marker of markers) {
    const index = decoded.indexOf(marker)
    if (index >= 0) return decoded.slice(index + marker.length)
  }
  return null
}

function inTargetMonth(timestamp) {
  const value = new Date(timestamp)
  return value >= startUtc && value < endUtc
}

function byteSize(object) {
  return Number(object.metadata?.size || 0)
}

function summarizeBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

const records = await listAttendanceRecords()
const objectsBefore = await listAllStorageObjects()
const objectPathsBefore = new Set(objectsBefore.map((object) => object.path))
const allReferencedPaths = new Set()
const targetReferencedPaths = new Set()
const protectedReferencedPaths = new Set()

for (const row of records) {
  const target = inTargetMonth(row.check_in_time)
  for (const value of [row.selfie_url, row.check_out_selfie_url]) {
    const path = storagePath(value)
    if (!path) continue
    allReferencedPaths.add(path)
    ;(target ? targetReferencedPaths : protectedReferencedPaths).add(path)
  }
}

const orphanTargetMonthPaths = new Set(objectsBefore
  .filter((object) => inTargetMonth(object.created_at) && !allReferencedPaths.has(object.path))
  .map((object) => object.path))
const candidates = new Set([...targetReferencedPaths, ...orphanTargetMonthPaths])
for (const protectedPath of protectedReferencedPaths) candidates.delete(protectedPath)

const existingCandidates = [...candidates].filter((path) => objectPathsBefore.has(path)).sort()
const protectedExistingBefore = new Set([...protectedReferencedPaths].filter((path) => objectPathsBefore.has(path)))
const candidateBytes = objectsBefore
  .filter((object) => candidates.has(object.path))
  .reduce((sum, object) => sum + byteSize(object), 0)
const totalBytesBefore = objectsBefore.reduce((sum, object) => sum + byteSize(object), 0)

console.log(JSON.stringify({
  mode: EXECUTE ? 'execute' : 'dry-run',
  projectRef: PROJECT_REF,
  bucket: BUCKET,
  targetMonth: TARGET_MONTH,
  vietnamRange: `[${startUtc.toISOString()}, ${endUtc.toISOString()})`,
  attendanceRecordsTotal: records.length,
  targetAttendanceRecords: records.filter((row) => inTargetMonth(row.check_in_time)).length,
  storageObjectsBefore: objectsBefore.length,
  storageSizeBefore: summarizeBytes(totalBytesBefore),
  referencedTargetPaths: targetReferencedPaths.size,
  orphanCreatedInTargetMonth: orphanTargetMonthPaths.size,
  protectedNonTargetPaths: protectedReferencedPaths.size,
  existingDeleteCandidates: existingCandidates.length,
  estimatedFreed: summarizeBytes(candidateBytes),
}, null, 2))

if (!EXECUTE) process.exit(0)
if (!serviceRoleKey) throw new Error('Chế độ xóa cần Supabase access token/service_role; kiểm kê Admin chỉ được phép đọc.')

for (let index = 0; index < existingCandidates.length; index += 100) {
  const prefixes = existingCandidates.slice(index, index + 100)
  await checkedFetch(`${baseUrl}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes }),
  })
}

const objectsAfter = await listAllStorageObjects()
const objectPathsAfter = new Set(objectsAfter.map((object) => object.path))
const survivors = existingCandidates.filter((path) => objectPathsAfter.has(path))
const protectedRemoved = [...protectedExistingBefore].filter((path) => !objectPathsAfter.has(path))
if (survivors.length || protectedRemoved.length) {
  throw new Error(`Xác minh thất bại: ${survivors.length} ảnh mục tiêu còn lại; ${protectedRemoved.length} ảnh ngoài tháng mục tiêu bị mất.`)
}

const totalBytesAfter = objectsAfter.reduce((sum, object) => sum + byteSize(object), 0)
const health = await fetch(`${baseUrl}/auth/v1/health`, { headers: { apikey: serviceRoleKey } })
console.log(JSON.stringify({
  verification: 'passed',
  deletedObjects: existingCandidates.length,
  storageObjectsAfter: objectsAfter.length,
  storageSizeAfter: summarizeBytes(totalBytesAfter),
  freed: summarizeBytes(totalBytesBefore - totalBytesAfter),
  protectedExistingBefore: protectedExistingBefore.size,
  protectedRemoved: protectedRemoved.length,
  authHealthStatus: health.status,
}, null, 2))
