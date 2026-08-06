// BUG-121: "chấm công không thành công" — KHÔNG tầng vị trí nào được phép chặn
// chấm công. Ảnh selfie đóng dấu là bằng chứng gốc; GPS/địa chỉ thiếu thì hạ cấp
// CÓ ĐÓNG DẤU:
//   GPS ≤150m  → như cũ.
//   GPS >150m  → giữ toạ độ, địa chỉ tiền tố "[GPS SAI SỐ LỚN] ±Xm" (đứng trong
//                Lotte Mart sai số vài trăm mét là chuyện thường — trước đây bị
//                chặn thẳng "chưa đủ chính xác để chấm công").
//   Không GPS  → toạ độ trống, địa chỉ "[KHÔNG CÓ GPS] …lý do…" (WebView trong
//                app khác/quyền bị chặn/hết 25s), DB có nhánh ràng buộc riêng.
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-gps-fallback-'))
const outFile = join(workDir, 'attendance.mjs')
await build({
  entryPoints: [join(root, 'src/lib/attendance.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
  define: { 'import.meta.env': JSON.stringify({}) },
})
const {
  finalizeAttendanceLocation,
  NO_GPS_ADDRESS_PREFIX,
  LOW_ACCURACY_ADDRESS_PREFIX,
} = await import(pathToFileURL(outFile).href)

// 1) GPS tốt: giữ nguyên tất cả.
{
  const good = finalizeAttendanceLocation({
    latitude: 12.251234, longitude: 109.191234, accuracy: 18,
    address: 'Số 2 Thái Nguyên, Nha Trang',
  })
  if (good.address !== 'Số 2 Thái Nguyên, Nha Trang' || good.latitude !== 12.251234 || good.accuracy !== 18) {
    failures.push(`GPS tốt phải giữ nguyên, nhận: ${JSON.stringify(good)}`)
  }
}

// 2) GPS sai số lớn: KHÔNG chặn — giữ toạ độ, đóng dấu tiền tố + sai số.
{
  const coarse = finalizeAttendanceLocation({
    latitude: 10.345678, longitude: 107.084321, accuracy: 480.6,
    address: 'Lotte Mart Vũng Tàu, Phường 8',
  })
  if (coarse.latitude !== 10.345678 || coarse.accuracy !== 480.6) {
    failures.push('GPS sai số lớn vẫn phải giữ toạ độ thật làm bằng chứng.')
  }
  if (!coarse.address.startsWith(`${LOW_ACCURACY_ADDRESS_PREFIX} ±481m`)) {
    failures.push(`Địa chỉ sai số lớn phải mở đầu "${LOW_ACCURACY_ADDRESS_PREFIX} ±481m", nhận: ${coarse.address}`)
  }
  if (!coarse.address.includes('Lotte Mart Vũng Tàu')) {
    failures.push('Địa chỉ gốc phải được giữ lại sau tiền tố sai số.')
  }
}

// 3) Không lấy được GPS: KHÔNG chặn, KHÔNG bịa toạ độ — tự khai rõ lý do.
{
  const missing = finalizeAttendanceLocation({
    latitude: null, longitude: null, accuracy: null, address: '',
    failureReason: 'trình duyệt trong app không được cấp quyền định vị',
  })
  if (missing.latitude !== null || missing.longitude !== null || missing.accuracy !== null) {
    failures.push('Không có GPS thì toạ độ phải để trống, không được bịa.')
  }
  if (!missing.address.startsWith(NO_GPS_ADDRESS_PREFIX)) {
    failures.push(`Địa chỉ phải mở đầu "${NO_GPS_ADDRESS_PREFIX}", nhận: ${missing.address}`)
  }
  if (!missing.address.includes('trình duyệt trong app không được cấp quyền định vị')) {
    failures.push('Địa chỉ tự khai phải kèm lý do thiếu GPS.')
  }
}

// 4) Tiền tố phải đúng nguyên văn — ràng buộc DB + báo cáo nhận diện bằng chuỗi này.
if (NO_GPS_ADDRESS_PREFIX !== '[KHÔNG CÓ GPS]') failures.push(`Tiền tố không GPS bị đổi: ${NO_GPS_ADDRESS_PREFIX}`)
if (LOW_ACCURACY_ADDRESS_PREFIX !== '[GPS SAI SỐ LỚN]') failures.push(`Tiền tố sai số lớn bị đổi: ${LOW_ACCURACY_ADDRESS_PREFIX}`)

// 5) Hợp đồng nguồn: chốt chặn cũ không được quay lại; migration phải có nhánh 3.
const lib = await readFile(join(root, 'src/lib/attendance.ts'), 'utf8')
if (lib.includes('chưa đủ chính xác để chấm công')) {
  failures.push('Chốt chặn "sai số chưa đủ chính xác" đã quay lại — nó chặn chấm công trong nhà (BUG-121).')
}
const migration = await readFile(join(root, 'supabase/migrations/20260801_checkout_no_gps_selfdeclared.sql'), 'utf8')
if (!migration.includes("check_out_address like '[KHÔNG CÓ GPS]%'") || !migration.includes('check_out_selfie_url is not null')) {
  failures.push('Migration ràng buộc check-out thiếu nhánh "[KHÔNG CÓ GPS]" (ảnh có, GPS trống).')
}
if (!migration.includes("check_out_address like '[CHỐT HÀNH CHÍNH]%'")) {
  failures.push('Migration phải giữ nguyên nhánh chốt hành chính cũ.')
}

if (failures.length) {
  console.error('ATTENDANCE_GPS_FALLBACK_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('ATTENDANCE_GPS_FALLBACK_OK')
