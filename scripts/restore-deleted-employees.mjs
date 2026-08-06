// Khôi phục tài khoản bị xóa CỨNG bằng nút "Xóa nhân viên" (hard_delete).
// Chạy: node scripts/restore-deleted-employees.mjs --yes
//
// Đi qua đúng Edge Function `manage-employee` mà app dùng, KHÔNG chèn tay vào
// schema auth. Lịch sử chấm công/lịch làm của người bị xóa đã mất theo cascade,
// script này chỉ dựng lại tài khoản; phần nối doanh số làm riêng bằng SQL.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const YES = process.argv.includes('--yes')
const ADMIN_PASSWORD = process.env.GUSTINO_ADMIN_PASSWORD || '123456'
const EMPLOYEE_PASSWORD = process.env.GUSTINO_NEW_PASSWORD || '123456'

const TARGETS = [
  {
    name: 'Nguyễn Thị Thùy Trinh',
    username: 'thuytrinh',
    role: 'staff',
    employmentType: 'part_time',
    positionTitle: 'Part-time',
    branchId: 'lotte-2310',
  },
  {
    // "Ca phó" không phải role riêng: dùng chung role shift_leader, phân biệt bằng
    // chức danh (xem CODEMAP mục 2).
    name: 'Lê Thị Thanh Phương',
    username: 'thanhphuong',
    role: 'shift_leader',
    employmentType: 'leader',
    positionTitle: 'Ca phó',
    branchId: 'lotte-2310',
  },
]

function readEnvFile(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return env
}

async function main() {
  const env = readEnvFile('.env.local')
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong .env.local')

  const client = createClient(url, anonKey, { auth: { persistSession: false } })

  let signedIn = false
  for (const email of ['admin@accounts.gustino.vn', 'admin@gustino.vn']) {
    const { error } = await client.auth.signInWithPassword({ email, password: ADMIN_PASSWORD })
    if (!error) {
      signedIn = true
      console.log(`Đăng nhập Admin: ${email}`)
      break
    }
    console.log(`  ${email} -> ${error.message}`)
  }
  if (!signedIn) throw new Error('Không đăng nhập được tài khoản Admin.')

  const { data: branches } = await client.from('branches').select('id, name')
  const branchName = (id) => (branches || []).find((item) => item.id === id)?.name || id

  console.log('\nSẽ tạo lại:')
  for (const target of TARGETS) {
    console.log(`  - ${target.name} | ${target.username}@accounts.gustino.vn | ${target.role}/${target.employmentType} | ${target.positionTitle} | ${branchName(target.branchId)}`)
  }
  if (!YES) {
    console.log('\nChưa chạy thật. Thêm --yes để thực hiện.')
    return
  }

  for (const target of TARGETS) {
    const email = `${target.username}@accounts.gustino.vn`
    const { data, error } = await client.functions.invoke('manage-employee', {
      body: {
        action: 'create',
        name: target.name,
        username: target.username,
        email,
        password: EMPLOYEE_PASSWORD,
        temporaryPassword: EMPLOYEE_PASSWORD,
        role: target.role,
        branchId: target.branchId,
        branchName: branchName(target.branchId),
        employmentType: target.employmentType,
        positionTitle: target.positionTitle,
      },
    })
    if (error) {
      const detail = await error.context?.clone().json().catch(() => null)
      console.log(`LỖI ${target.name}: ${detail?.error || error.message}`)
      continue
    }
    console.log(`OK ${target.name} -> id ${data?.employee?.id}`)
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
