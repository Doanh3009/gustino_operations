import { readFile } from 'node:fs/promises'

const [store, supplyRequests, lanServer, salesTest] = await Promise.all([
  readFile(new URL('../src/lib/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/supplyRequests.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./test-sales-report-consistency.mjs', import.meta.url), 'utf8'),
])

const failures = []

if (!store.includes('fetchAllMovementRows')) {
  failures.push('Sổ kho Supabase chưa phân trang nên tồn kho lũy kế có thể thiếu sau giới hạn trả về của API.')
}
if (!/fetchMovements[\s\S]*?\.order\('created_at',[\s\S]*?\.order\('id',[\s\S]*?\.range\(from, to\)/.test(store)) {
  failures.push('Sổ kho chưa dùng thứ tự ổn định + range để tải đủ mọi phát sinh tồn kho.')
}

if (/fetchSupplyRequests[\s\S]*?\.limit\(80\)/.test(supplyRequests)) {
  failures.push('Yêu cầu bếp/đặt hàng vẫn bị cắt cứng ở 80 bản ghi trước khi lọc báo cáo.')
}
if (!supplyRequests.includes('fetchAllSupplyRequestRows')) {
  failures.push('Yêu cầu bếp/đặt hàng chưa phân trang để tải đủ lịch sử được phép xem.')
}
if (!/fetchSupplyRequests[\s\S]*?\.order\('created_at',[\s\S]*?\.order\('id',[\s\S]*?\.range\(from, to\)/.test(supplyRequests)) {
  failures.push('Yêu cầu bếp/đặt hàng chưa dùng thứ tự ổn định + range khi phân trang.')
}

if (/url\.pathname === '\/api\/supply-requests'[\s\S]*?\.slice\(0, 80\)/.test(lanServer)) {
  failures.push('LAN API vẫn cắt lịch sử yêu cầu bếp/đặt hàng ở 80 bản ghi.')
}
if (/url\.pathname === '\/api\/sales-receipts'[\s\S]*?\.slice\(0, 120\)/.test(lanServer)) {
  failures.push('LAN API vẫn cắt hóa đơn trong ngày ở 120 bản ghi, trái với hợp đồng tải đủ của POS.')
}
if (/url\.pathname === '\/api\/sales-receipts\/range'[\s\S]*?\.slice\(0, 1000\)/.test(lanServer)) {
  failures.push('LAN API vẫn cắt hóa đơn theo khoảng ngày ở 1.000 bản ghi.')
}
if (!salesTest.includes('lan-server.mjs')) {
  failures.push('Regression POS chưa bao phủ giới hạn dữ liệu của đường LAN.')
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log('DATA_PAGINATION_CONSISTENCY_OK')
