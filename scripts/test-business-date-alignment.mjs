/**
 * BUSINESS_DATE_ALIGNMENT — ngày nghiệp vụ đã khớp lịch thật chưa?
 *
 * Sinh ra sau BUG-138: `commission.ts` tạo `YYYY-MM-DD` ở nửa đêm GIỜ MÁY rồi gọi
 * `toISOString()`, nên ở Việt Nam (UTC+7) mọi ngày bị lùi một ngày — Thứ Bảy ăn
 * mức KPI ngày thường, Thứ Hai ăn mức cuối tuần.
 *
 * Test này khác `test-kpi-date-timezone.mjs` (chỉ kiểm vài mốc trong một múi giờ):
 *   1. Quét TOÀN BỘ 366 ngày của một năm, đối chiếu với lịch thật dựng độc lập
 *      bằng số ngày Julian — không dùng lại chính hàm đang kiểm.
 *   2. Chạy lại ở nhiều múi giờ, gồm hai cực UTC+14 và UTC-11.
 *   3. Đối chiếu CHÉO mọi bộ suy ngày trong mã nguồn (`commission.isWeekend`,
 *      `competitionFairness.competitionDayMatches`, `dates.localDateKeyWeekday`)
 *      — ba nơi phải trả cùng một kết quả cho cùng một ngày.
 *   4. Chặn tái phát mẫu lỗi: cấm `new Date(...).toISOString()` trên ngày thuần.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

async function loadModule(source, exportNames) {
  const compiled = ts.transpileModule(
    `${source}\nexport { ${exportNames.join(', ')} };\n`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

/** Lịch chuẩn độc lập: số ngày Julian → thứ trong tuần. Không đụng tới `Date`. */
function weekdayFromCalendar(year, month, day) {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  const julian = day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
  return (julian + 1) % 7 // 0 = Chủ nhật
}

function daysInMonth(year, month) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function allDatesOfYear(year) {
  const dates = []
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      dates.push({
        key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        weekday: weekdayFromCalendar(year, month, day),
      })
    }
  }
  return dates
}

const commissionSource = await read('src/lib/commission.ts')
const kpiBlockStart = commissionSource.indexOf('export const DEFAULT_REVENUE_TARGET')
const kpiBlockEnd = commissionSource.indexOf('const PRODUCT_PRICES')
assert.ok(kpiBlockStart >= 0 && kpiBlockEnd > kpiBlockStart, 'Khong tim thay khoi cong thuc KPI thuan trong commission.ts.')
const commissionPure = commissionSource.slice(kpiBlockStart, kpiBlockEnd).replace(/\bexport\s+/g, '')

const fairnessSource = (await read('src/lib/competitionFairness.ts'))
  .split('export function filterCompetitionAttendanceRecords')[0]
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/\bexport\s+/g, '')

const datesSource = (await read('src/lib/dates.ts')).replace(/\bexport\s+/g, '')

const YEARS = [2026, 2027]
const TIMEZONES = ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Midway']
const previousTimezone = process.env.TZ
const failures = []

try {
  for (const timezone of TIMEZONES) {
    process.env.TZ = timezone
    // Mỗi múi giờ nạp lại module: `Date` đọc TZ ngay lúc gọi, nhưng nạp mới cho
    // chắc chắn không dính state cũ nào.
    const commission = await loadModule(
      `${commissionPure}\nconst __probeWeekend = isWeekend;\nconst __probeRange = dateRange;`,
      ['employeePeriodRevenueTarget', 'isFullCalendarMonth', '__probeWeekend as isWeekend', '__probeRange as dateRange'],
    )
    const fairness = await loadModule(fairnessSource, ['competitionDayMatches', 'competitionDateKeys'])
    const dates = await loadModule(datesSource, ['localDateKeyWeekday'])

    for (const year of YEARS) {
      const calendar = allDatesOfYear(year)
      for (const { key, weekday } of calendar) {
        const expectedWeekend = weekday === 0 || weekday === 6

        // 1. commission.isWeekend phải khớp lịch thật.
        if (commission.isWeekend(key) !== expectedWeekend) {
          failures.push(`[${timezone}] commission.isWeekend('${key}') sai: lich that la thu ${weekday}.`)
        }
        // 2. Bộ lọc loại ngày của bảng thi đua phải khớp cùng lịch.
        if (fairness.competitionDayMatches(key, 'weekend') !== expectedWeekend) {
          failures.push(`[${timezone}] competitionDayMatches('${key}','weekend') khong khop lich that.`)
        }
        if (fairness.competitionDayMatches(key, 'weekday') === expectedWeekend) {
          failures.push(`[${timezone}] competitionDayMatches('${key}','weekday') khong khop lich that.`)
        }
        // 3. Helper ngày dùng chung phải trả đúng số thứ.
        if (dates.localDateKeyWeekday(key) !== weekday) {
          failures.push(`[${timezone}] localDateKeyWeekday('${key}') = ${dates.localDateKeyWeekday(key)}, lich that ${weekday}.`)
        }
      }

      // 4. dateRange không được nuốt/thêm ngày ở bất kỳ múi giờ nào.
      const januaryRange = commission.dateRange(`${year}-01-01`, `${year}-01-31`)
      if (januaryRange.length !== 31 || januaryRange[0] !== `${year}-01-01` || januaryRange[30] !== `${year}-01-31`) {
        failures.push(`[${timezone}] dateRange thang 01/${year} lech: ${januaryRange.length} ngay, dau ${januaryRange[0]}, cuoi ${januaryRange[30]}.`)
      }
      // Qua mốc đổi năm là chỗ dễ lùi ngày nhất.
      const newYearRange = commission.dateRange(`${year}-12-30`, `${year + 1}-01-02`)
      assertArray(failures, timezone, newYearRange, [`${year}-12-30`, `${year}-12-31`, `${year + 1}-01-01`, `${year + 1}-01-02`])
    }

    // 5. Kỳ trọn tháng phải được nhận ra để dùng mốc KPI tháng cố định.
    for (const [from, to] of [['2026-02-01', '2026-02-28'], ['2026-08-01', '2026-08-31'], ['2028-02-01', '2028-02-29']]) {
      if (!commission.isFullCalendarMonth(from, to)) {
        failures.push(`[${timezone}] isFullCalendarMonth('${from}','${to}') phai la true.`)
      }
    }
    if (commission.isFullCalendarMonth('2026-08-01', '2026-08-30')) {
      failures.push(`[${timezone}] isFullCalendarMonth khong duoc nhan nham thang thieu ngay cuoi.`)
    }

    // 6. Đúng ca lỗi mà chủ hệ thống vừa báo: Thứ Bảy 08/08/2026 phải ăn mức cuối
    //    tuần, Thứ Hai 10/08/2026 phải ăn mức ngày thường — không được đảo.
    const saturday = commission.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-08-08', '2026-08-08')
    const monday = commission.employeePeriodRevenueTarget('gold-coast', 'staff', 'part_time', '', '2026-08-10', '2026-08-10')
    if (saturday !== 650000) failures.push(`[${timezone}] Thu Bay 08/08/2026 phai la 650.000d, dang la ${saturday}.`)
    if (monday !== 500000) failures.push(`[${timezone}] Thu Hai 10/08/2026 phai la 500.000d, dang la ${monday}.`)
    if (saturday <= monday) failures.push(`[${timezone}] Muc cuoi tuan phai cao hon ngay thuong.`)
  }
} finally {
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
}

// 7. Chặn tái phát ở mức mã nguồn: ngày thuần không được đi qua `toISOString()`
//    của một `Date` dựng ở giờ máy — đó chính là cơ chế của BUG-138.
const guardedFiles = [
  'src/lib/commission.ts',
  'src/lib/competitionFairness.ts',
  'src/lib/dates.ts',
]
for (const file of guardedFiles) {
  const source = await read(file)
  const offenders = source
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    // `new Date(\`${x}T00:00:00\`)` không có hậu tố múi giờ = giờ máy.
    .filter(({ line }) => /new Date\(`\$\{[^`]*\}T00:00:00`\)/.test(line) && !/[+-]\d{2}:\d{2}|Z`/.test(line))
  offenders.forEach(({ line, number }) => {
    failures.push(`${file}:${number} dung ngay thuan o gio may (mau loi BUG-138): ${line}`)
  })
}

function assertArray(sink, timezone, actual, expected) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    sink.push(`[${timezone}] dateRange qua moc doi nam lech: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  }
}

assert.deepEqual(failures, [], `\n${failures.slice(0, 25).join('\n')}${failures.length > 25 ? `\n… con ${failures.length - 25} loi nua` : ''}`)

const checkedDays = YEARS.reduce((sum, year) => sum + allDatesOfYear(year).length, 0) * TIMEZONES.length
console.log(`BUSINESS_DATE_ALIGNMENT_OK (${checkedDays} luot ngay x 3 bo suy ngay, ${TIMEZONES.length} mui gio)`)
