import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

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

const { data, error } = await client.from('profiles')
  .select('id, full_name, branch_id, role, employment_type, position_title, active')
  .in('branch_id', ['lotte-vt', 'lotte-2310', 'gold-coast'])
  .eq('active', true)
  .order('branch_id')
  .order('full_name')
if (error) throw error

const rows = (data || []).map((profile) => ({
  name: profile.full_name,
  branchId: profile.branch_id,
  authRole: profile.role,
  employmentType: profile.employment_type,
  positionTitle: profile.position_title,
  kpiPosition: positionOf(profile),
  operationalAccessConsistent: operationalAccessConsistent(profile),
  expectedFromScheduleImage: expectedFromScheduleImage(profile),
  scheduleImagePositionMatches: scheduleImagePositionMatches(profile),
}))

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  mode: 'READ_ONLY',
  activeProfileCount: rows.length,
  operationalAccessMismatchCount: rows.filter((row) => !row.operationalAccessConsistent).length,
  scheduleImageMismatchCount: rows.filter((row) => row.scheduleImagePositionMatches === false).length,
  rows,
}, null, 2))
console.log('ACTIVE_POSITION_ALIGNMENT_READONLY_AUDIT_OK')

function positionOf(profile) {
  const title = normalize(profile.position_title)
  if (title.includes('ca pho')) return 'ca_pho'
  if (title.includes('ca truong') || profile.role === 'shift_leader' || profile.employment_type === 'leader') return 'ca_truong'
  if (profile.employment_type === 'full_time' || title.includes('full')) return 'full_time'
  return 'part_time'
}

function operationalAccessConsistent(profile) {
  const position = positionOf(profile)
  if (profile.role === 'admin' || profile.role === 'manager') return true
  if (position === 'ca_truong' || position === 'ca_pho') {
    return profile.role === 'shift_leader' && profile.employment_type === 'leader'
  }
  if (position === 'full_time') return profile.role === 'staff' && profile.employment_type === 'full_time'
  return profile.role === 'staff' && profile.employment_type === 'part_time'
}

function expectedFromScheduleImage(profile) {
  const expectations = {
    'lotte-vt': {
      'luu thi thanh ngan': 'ca_truong',
      'duong minh tu': 'ca_truong',
      'dang thi khanh linh': 'ca_pho',
      'ma thi thanh truc': 'ca_pho',
      'huynh phuong anh': 'full_time',
      'pham thi quynh nhu': 'full_time',
      'le phuc phuong nhi': 'part_time',
      'nguyen thi thuy trang': 'part_time',
    },
    'lotte-2310': {
      'nguyen binh thao nguyen': 'ca_truong',
      'vo thao quyen': 'ca_truong',
      'nguyen thi yen': 'ca_pho',
      'uyen thu': 'full_time',
      'nguyen thi le quyen': 'full_time',
      'le thi my quyen': 'part_time',
      'huynh thi ngoc ly': 'part_time',
    },
    'gold-coast': {
      'tran minh ly': 'ca_truong',
      'truong thi phuong': 'ca_truong',
      'minh thien': 'ca_pho',
      'pham dinh phat': 'part_time',
      'nguyen ngoc bao linh': 'part_time',
      'nguyen tran nhat an': 'part_time',
      'nguyen minh khoa': 'part_time',
      'cao bao tran': 'part_time',
      'pham ngoc tram': 'part_time',
    },
  }
  return expectations[profile.branch_id]?.[normalize(profile.full_name)] || null
}

function scheduleImagePositionMatches(profile) {
  const expected = expectedFromScheduleImage(profile)
  return expected ? expected === positionOf(profile) : null
}

function normalize(value = '') {
  return String(value).trim().toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

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
