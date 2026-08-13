import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const apply = process.argv.includes('--apply')
const targets = [
  { branchId: 'lotte-vt', name: 'Đặng Thị Khánh Linh', role: 'staff', employmentType: 'leader', positionTitle: 'Ca phó (8h)' },
  { branchId: 'lotte-vt', name: 'Mã Thị Thanh Trúc', role: 'staff', employmentType: 'leader', positionTitle: 'Ca phó (8h)' },
  { branchId: 'lotte-2310', name: 'Nguyễn Thị Yến', role: 'staff', employmentType: 'leader', positionTitle: 'Ca phó (8h)' },
  { branchId: 'gold-coast', name: 'Nguyễn Trần Nhật An', role: 'staff', employmentType: 'full_time', positionTitle: 'Part-time (8h)' },
  { branchId: 'gold-coast', name: 'Nguyễn Minh Khoa', role: 'staff', employmentType: 'full_time', positionTitle: 'Part-time (8h)' },
]

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

const selectProfiles = async () => {
  const { data, error } = await client.from('profiles')
    .select('id, full_name, branch_id, role, employment_type, position_title, active')
    .in('full_name', targets.map((target) => target.name))
    .order('branch_id')
    .order('full_name')
  if (error) throw error
  return data || []
}

const before = await selectProfiles()
for (const target of targets) {
  const matches = before.filter((row) => row.branch_id === target.branchId && row.full_name === target.name)
  if (matches.length !== 1 || matches[0].active === false) {
    throw new Error(`Dừng cập nhật ${target.name}: cần đúng một hồ sơ active tại ${target.branchId}.`)
  }
}

if (apply) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError || !sessionData.session?.access_token) throw sessionError || new Error('Thiếu phiên Admin.')
  for (const target of targets) {
    const profile = before.find((row) => row.branch_id === target.branchId && row.full_name === target.name)
    const { data, error } = await client.functions.invoke('manage-employee', {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      body: {
        action: 'update',
        employeeId: profile.id,
        role: target.role,
        employmentType: target.employmentType,
        positionTitle: target.positionTitle,
      },
    })
    if (error || data?.error) throw error || new Error(data.error)
  }
}

const after = await selectProfiles()
if (apply) {
  for (const target of targets) {
    const profile = after.find((row) => row.branch_id === target.branchId && row.full_name === target.name)
    if (
      profile?.role !== target.role
      || profile?.employment_type !== target.employmentType
      || profile?.position_title !== target.positionTitle
    ) throw new Error(`Xác minh vai trò thất bại: ${JSON.stringify(profile)}`)
  }
}

console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', before, after }, null, 2))
console.log(apply ? 'SEPARATED_DEPUTY_ROLES_APPLY_OK' : 'SEPARATED_DEPUTY_ROLES_DRY_RUN_OK')

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
