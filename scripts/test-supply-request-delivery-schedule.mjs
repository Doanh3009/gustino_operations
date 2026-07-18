import { readFile } from 'node:fs/promises'

const [migration, schema, supply, orders, today, kitchen, i18n, lan] = await Promise.all([
  readFile(new URL('../supabase/migrations/20260717_supply_request_delivery_schedule.sql', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/supplyRequests.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/OrdersPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/TodayPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/KitchenPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8'),
  readFile(new URL('./lan-server.mjs', import.meta.url), 'utf8'),
])

const failures = []

for (const source of [migration, schema]) {
  if (!source.includes('requested_delivery_date')) failures.push('Schema chưa có ngày nhận mong muốn.')
  if (!source.includes('requested_delivery_period')) failures.push('Schema chưa có buổi nhận mong muốn.')
}
if (!migration.includes("'morning', 'noon', 'afternoon'")) failures.push('Migration chưa giới hạn buổi nhận sáng/trưa/chiều.')
if (!supply.includes("SupplyDeliveryPeriod = 'morning' | 'noon' | 'afternoon'")) failures.push('Model chưa có kiểu buổi nhận.')
if (!supply.includes('requestedDeliveryDate') || !supply.includes('requestedDeliveryPeriod')) failures.push('Model/API chưa ánh xạ lịch nhận.')
if (!supply.includes('requested_delivery_date: delivery.requestedDeliveryDate')) failures.push('Insert Supabase chưa lưu ngày nhận.')
if (!supply.includes('requested_delivery_period: delivery.requestedDeliveryPeriod')) failures.push('Insert Supabase chưa lưu buổi nhận.')
if (!lan.includes('requestedDeliveryDate') || !lan.includes('requestedDeliveryPeriod')) failures.push('LAN API chưa lưu lịch nhận.')
if (!orders.includes('Ngày nhận mong muốn')) failures.push('Phiếu đặt hàng chưa có ô chọn ngày nhận.')
if (!orders.includes('Buổi nhận')) failures.push('Phiếu đặt hàng chưa có ô chọn buổi nhận.')
if (!orders.includes('Sáng') || !orders.includes('Trưa') || !orders.includes('Chiều')) failures.push('Phiếu đặt hàng chưa đủ ba buổi nhận.')
if (!orders.includes('Ngày đặt:')) failures.push('Thông tin đơn của ca trưởng chưa hiển thị ngày đặt.')
if (!orders.includes('formatRequestedDelivery(request)')) failures.push('Thông tin đơn của ca trưởng chưa hiển thị lịch nhận.')
if (!today.includes('Ngày nhận mong muốn') || !today.includes('Buổi nhận')) failures.push('Phiếu đặt hàng nhanh ở trang Hôm nay chưa thu lịch nhận.')
if (!today.includes('requestedDeliveryDate: orderDeliveryDate') || !today.includes('requestedDeliveryPeriod: orderDeliveryPeriod')) failures.push('Phiếu đặt hàng nhanh chưa gửi lịch nhận xuống API.')
if (!kitchen.includes('Ngày đặt:')) failures.push('Thẻ đơn bếp chưa hiển thị ngày đặt.')
if (!kitchen.includes('formatRequestedDelivery(request)')) failures.push('Thẻ đơn bếp chưa hiển thị lịch nhận.')
if (!kitchen.includes('TRA CỨU ĐƠN ĐẶT HÀNG')) failures.push('Bếp chưa có khu vực coi lại danh sách đơn.')
if (!kitchen.includes('kitchenHistoryStatus')) failures.push('Bếp chưa lọc lịch sử theo trạng thái.')
if (!kitchen.includes('kitchenHistoryDeliveryDate')) failures.push('Bếp chưa lọc lịch sử theo ngày nhận.')
if (!kitchen.includes('kitchenHistoryDeliveryPeriod')) failures.push('Bếp chưa phân loại lịch sử theo sáng/trưa/chiều.')
if (!i18n.includes("kitchenAccept: 'Xác nhận đơn'")) failures.push('Nút bếp chưa có trạng thái xác nhận.')
if (!i18n.includes("kitchenFinish: 'Đã gửi hàng'")) failures.push('Nút bếp chưa có trạng thái đã gửi.')
if (!orders.includes("'Bếp đã xác nhận'") || !orders.includes("'Bếp đã gửi'")) failures.push('Ca trưởng chưa thấy nhãn xác nhận/đã gửi của bếp.')

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log('SUPPLY_REQUEST_DELIVERY_SCHEDULE_OK')
