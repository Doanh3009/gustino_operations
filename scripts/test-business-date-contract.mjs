import { readdir, readFile } from 'node:fs/promises'

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url)
const migrationFiles = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
const [inventory, attendance, store, lanServer, deleteReceiptMigrations] = await Promise.all([
  readFile(new URL('../src/pages/InventoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/attendance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
  Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationDirectory), 'utf8'))).then((rows) => rows.join('\n')),
])

const failures = []

if (!inventory.includes("import { localDateKey } from '../lib/dates'")) {
  failures.push('Trang kho chưa dùng ngày lịch địa phương dùng chung.')
}
if (/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(inventory)) {
  failures.push('Trang kho vẫn lấy ngày UTC, có thể lùi một ngày trong buổi sáng UTC+7.')
}
if (!attendance.includes('input.workDate < localDateKey()')) {
  failures.push('Guard sửa lịch quá khứ trên Supabase client vẫn so với ngày UTC.')
}
if (!store.includes("import { localDateKey, localDayBoundsIso } from './dates'")) {
  failures.push('Fallback ngày báo cáo chưa dùng ngày lịch địa phương.')
}
if (/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(store)) {
  failures.push('Store báo cáo vẫn còn fallback ngày UTC.')
}
if (!lanServer.includes('function currentVietnamDateKey(')) {
  failures.push('LAN server chưa có nguồn ngày nghiệp vụ UTC+7 dùng chung.')
}
if ((lanServer.match(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/g) || []).length) {
  failures.push('LAN guard POS/lịch vẫn dùng ngày UTC thay vì ngày nghiệp vụ UTC+7.')
}
if (!/business_date\s*=\s*timezone\('Asia\/Bangkok', now\(\)\)::date/.test(deleteReceiptMigrations)) {
  failures.push('RPC xóa POS vẫn dùng current_date của database thay vì ngày nghiệp vụ UTC+7.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('BUSINESS_DATE_CONTRACT_OK')
