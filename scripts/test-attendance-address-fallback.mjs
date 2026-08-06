// BUG-120: /api/reverse-geocode lỗi (log 16:02 ngày 01/08) + fallback trình duyệt
// cùng trượt → requireConcreteAttendanceAddress cũ NÉM LỖI và chặn đứng check-in.
// Bằng chứng gốc của chấm công là ẢNH + TOẠ ĐỘ GPS + SAI SỐ — địa chỉ chỉ là bản
// dịch. Quy tắc mới: không dịch được thì ghi toạ độ kèm tiền tố tự khai
// "[CHƯA DỊCH ĐƯỢC ĐỊA CHỈ]" (đúng pattern "[CHỐT HÀNH CHÍNH]"), KHÔNG chặn.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-addr-fallback-'))
const outFile = join(workDir, 'attendance.mjs')
await build({
  entryPoints: [join(root, 'src/lib/attendance.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
  define: { 'import.meta.env': JSON.stringify({}) },
})
const { resolveAttendanceAddress, UNRESOLVED_ADDRESS_PREFIX } = await import(pathToFileURL(outFile).href)

const lat = 12.251234
const lng = 109.191234
const accuracy = 18.4

// Địa chỉ cụ thể → giữ nguyên (sau khi gọt đuôi GPS).
{
  const concrete = resolveAttendanceAddress('Số 2 Thái Nguyên, Phường Lộc Thọ, Nha Trang', lat, lng, accuracy)
  if (concrete !== 'Số 2 Thái Nguyên, Phường Lộc Thọ, Nha Trang') {
    failures.push(`Địa chỉ cụ thể phải giữ nguyên, nhận: ${concrete}`)
  }
  const trimmed = resolveAttendanceAddress('Nha Trang, Khánh Hòa · GPS 12.25, 109.19', lat, lng, accuracy)
  if (trimmed !== 'Nha Trang, Khánh Hòa') {
    failures.push(`Đuôi GPS phải được gọt, nhận: ${trimmed}`)
  }
}

// Cả hai nguồn dịch hỏng (chuỗi rỗng / tọa độ trần / nhãn GPS) → địa chỉ tự khai
// có tiền tố + toạ độ + sai số, KHÔNG ném lỗi.
for (const broken of ['', '12.251234, 109.191234', 'Vị trí GPS 12.25, 109.19']) {
  let result
  try {
    result = resolveAttendanceAddress(broken, lat, lng, accuracy)
  } catch (error) {
    failures.push(`Đầu vào "${broken}" không được ném lỗi (chặn chấm công): ${error.message}`)
    continue
  }
  if (!result.startsWith(UNRESOLVED_ADDRESS_PREFIX)) {
    failures.push(`Đầu vào "${broken}" phải ra địa chỉ tự khai có tiền tố, nhận: ${result}`)
  }
  if (!result.includes('12.251234') || !result.includes('109.191234') || !result.includes('±18m')) {
    failures.push(`Địa chỉ tự khai phải kèm đủ toạ độ + sai số, nhận: ${result}`)
  }
}

// Tiền tố phải đúng nguyên văn — báo cáo/Excel nhận diện bằng chuỗi này.
if (UNRESOLVED_ADDRESS_PREFIX !== '[CHƯA DỊCH ĐƯỢC ĐỊA CHỈ]') {
  failures.push(`Tiền tố tự khai bị đổi: ${UNRESOLVED_ADDRESS_PREFIX}`)
}

if (failures.length) {
  console.error('ATTENDANCE_ADDRESS_FALLBACK_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('ATTENDANCE_ADDRESS_FALLBACK_OK')
