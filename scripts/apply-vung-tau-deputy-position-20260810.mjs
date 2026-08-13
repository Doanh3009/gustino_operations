import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const apply = process.argv.includes('--apply')
const env = readEnv('.env.local')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let authError
for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
  const { error } = await client.auth.signInWithPassword({ email, password: '123456' })
  authError = error
  if (!error) break
}
if (authError) throw authError

const expectedNames = ['Đặng Thị Khánh Linh', 'Mã Thị Thanh Trúc']
const { data: before, error: beforeError } = await client.from('profiles')
  .select('id, full_name, branch_id, role, employment_type, position_title, active')
  .eq('branch_id', 'lotte-vt')
  .in('full_name', expectedNames)
  .order('full_name')
if (beforeError) throw beforeError
if ((before || []).length !== expectedNames.length) {
  throw new Error(`Dừng cập nhật: cần đúng ${expectedNames.length} hồ sơ, thực tế ${(before || []).length}.`)
}
if ((before || []).some((row) => row.role !== 'staff' || row.employment_type !== 'full_time' || row.active === false)) {
  throw new Error(`Dừng cập nhật: metadata hồ sơ khác điều kiện đã đối soát: ${JSON.stringify(before)}`)
}

if (apply) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) throw sessionError || new Error('Thiếu phiên Admin.')
  for (const profile of before) {
    const { data, error } = await client.functions.invoke('manage-employee', {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      body: { action: 'update', employeeId: profile.id, positionTitle: 'Ca phó (8h)' },
    })
    if (error || data?.error) throw error || new Error(data.error)
  }
}

const { data: after, error: afterError } = await client.from('profiles')
  .select('id, full_name, branch_id, role, employment_type, position_title, active')
  .eq('branch_id', 'lotte-vt')
  .in('full_name', expectedNames)
  .order('full_name')
if (afterError) throw afterError
if (apply && (after || []).some((row) => row.position_title !== 'Ca phó (8h)')) {
  throw new Error(`Cập nhật chưa được xác nhận: ${JSON.stringify(after)}`)
}

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN',
  businessRule: 'Hai nhân viên được người dùng xác nhận là Ca phó Vũng Tàu; KPI 500.000đ cả ngày thường và cuối tuần.',
  before,
  after,
}, null, 2))
console.log(apply ? 'VUNG_TAU_DEPUTY_POSITION_APPLY_OK' : 'VUNG_TAU_DEPUTY_POSITION_DRY_RUN_OK')

function readEnv(path) {
  const output = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) output[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return output
}
