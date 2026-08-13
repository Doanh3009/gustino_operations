// Báo cáo gửi theo ĐỒNG HỒ (chủ quán chốt 11/08/2026): 15:15 gửi Ca 1, 22:15 gửi
// Ca 2 + Tổng ngày. Không còn chờ ca trưởng bấm "Chốt & bàn giao ca" rồi bấm tiếp
// "Chốt báo cáo" — việc bàn giao và việc gửi báo cáo tách hẳn nhau.
//
// Test bằng SỐ cho phần thuần logic giờ (`reportDueAt`, `isReportDue`,
// `dueReportSequences`, `msUntilNextReportDue`); phần nối vào app kiểm bằng dấu
// vết mã nguồn ở cuối file.
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-report-schedule-'))
const outFile = join(workDir, 'reportSchedule.mjs')
await build({
  entryPoints: [join(root, 'src/lib/reportSchedule.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
  // Module này kéo theo `store`/`shiftLedger` ⇒ kéo theo client Supabase, mà client
  // đọc `import.meta.env` lúc nạp module. Ngoài Vite thì biến đó không tồn tại nên
  // bundle nổ ngay khi import. Cắm giá trị giả: test chỉ dùng phần thuần logic giờ.
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"test"',
  },
})
const {
  REPORT_DUE_TIMES,
  reportDueAt,
  isReportDue,
  dueReportSequences,
  msUntilNextReportDue,
} = await import(pathToFileURL(outFile).href)

const BUSINESS_DATE = '2026-08-11'
// Giờ Việt Nam = UTC+7 → 15:15 ICT = 08:15Z, 22:15 ICT = 15:15Z.
const DUE_SHIFT_1 = '2026-08-11T08:15:00.000Z'
const DUE_SHIFT_2 = '2026-08-11T15:15:00.000Z'

function session(id, sequence, businessDate = BUSINESS_DATE, status = 'open') {
  return {
    id,
    branchId: 'gold-coast',
    businessDate,
    sequence,
    status,
    leaderId: `leader-${sequence}`,
    leaderName: `Leader ${sequence}`,
    startedAt: `${businessDate}T00:30:00.000Z`,
    openingBalances: {},
  }
}

function expect(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: mong ${expected}, nhận ${actual}.`)
}

// ---- Mốc giờ ----------------------------------------------------------------
expect('Giờ gửi Ca 1', REPORT_DUE_TIMES[1], '15:15')
expect('Giờ gửi Ca 2', REPORT_DUE_TIMES[2], '22:15')
expect('Mốc Ca 1 theo UTC', reportDueAt(BUSINESS_DATE, 1)?.toISOString(), DUE_SHIFT_1)
expect('Mốc Ca 2 theo UTC', reportDueAt(BUSINESS_DATE, 2)?.toISOString(), DUE_SHIFT_2)
expect('Ngày rác không có mốc', reportDueAt('', 1), null)
expect('Ca lạ không có mốc', reportDueAt(BUSINESS_DATE, 3), null)

// ---- Đúng mốc là ĐÃ tới giờ; trước đó một giây thì chưa --------------------
expect('15:14:59 chưa tới giờ Ca 1', isReportDue(BUSINESS_DATE, 1, new Date('2026-08-11T08:14:59.000Z')), false)
expect('Đúng 15:15 là tới giờ Ca 1', isReportDue(BUSINESS_DATE, 1, new Date(DUE_SHIFT_1)), true)
expect('15:15 chưa tới giờ Ca 2', isReportDue(BUSINESS_DATE, 2, new Date(DUE_SHIFT_1)), false)
expect('Đúng 22:15 là tới giờ Ca 2', isReportDue(BUSINESS_DATE, 2, new Date(DUE_SHIFT_2)), true)

// ---- Ca nào tới hạn mà chưa gửi ---------------------------------------------
{
  const sessions = [session('s1', 1), session('s2', 2)]
  const at1516 = new Date('2026-08-11T08:16:00.000Z')
  const at2216 = new Date('2026-08-11T15:16:00.000Z')

  const beforeCut = dueReportSequences(sessions, new Set(), BUSINESS_DATE, new Date('2026-08-11T07:00:00.000Z'))
  expect('Trước 15:15 chưa ca nào tới hạn', beforeCut.length, 0)

  const afterCut = dueReportSequences(sessions, new Set(), BUSINESS_DATE, at1516)
  expect('Sau 15:15 chỉ Ca 1 tới hạn', afterCut.map((item) => item.sequence).join(','), '1')

  const afterEnd = dueReportSequences(sessions, new Set(), BUSINESS_DATE, at2216)
  expect('Sau 22:15 cả hai ca tới hạn', afterEnd.map((item) => item.sequence).join(','), '1,2')

  const shift1Sent = dueReportSequences(sessions, new Set(['s1']), BUSINESS_DATE, at2216)
  expect('Ca 1 đã gửi thì bỏ qua', shift1Sent.map((item) => item.sequence).join(','), '2')

  const allSent = dueReportSequences(sessions, new Set(['s1', 's2']), BUSINESS_DATE, at2216)
  expect('Gửi đủ thì không còn gì tới hạn', allSent.length, 0)
}

// ---- Ca CHƯA ĐÓNG vẫn tới hạn: bàn giao không còn liên quan tới báo cáo ------
{
  const stillOpen = [session('s1', 1, BUSINESS_DATE, 'open')]
  const due = dueReportSequences(stillOpen, new Set(), BUSINESS_DATE, new Date('2026-08-11T08:16:00.000Z'))
  expect('Ca còn mở vẫn phải gửi báo cáo', due.length, 1)
}

// ---- Ca của ngày khác không được lôi vào ------------------------------------
{
  const mixed = [session('old', 1, '2026-08-10'), session('s1', 1)]
  const due = dueReportSequences(mixed, new Set(), BUSINESS_DATE, new Date('2026-08-11T08:16:00.000Z'))
  expect('Chỉ xét ca của ngày đang chạy', due.map((item) => item.id).join(','), 's1')
}

// ---- Đếm ngược tới mốc kế tiếp ----------------------------------------------
expect(
  'Trước 15:15 thì đếm tới 15:15',
  msUntilNextReportDue(BUSINESS_DATE, new Date('2026-08-11T08:00:00.000Z')),
  15 * 60_000,
)
expect(
  'Sau 15:15 thì đếm tới 22:15',
  msUntilNextReportDue(BUSINESS_DATE, new Date('2026-08-11T15:00:00.000Z')),
  15 * 60_000,
)
expect(
  'Hết mốc trong ngày thì không còn hẹn',
  msUntilNextReportDue(BUSINESS_DATE, new Date('2026-08-11T16:00:00.000Z')),
  undefined,
)

// ---- Dấu vết nối vào app -----------------------------------------------------
const appSource = await readFile(join(root, 'src/App.tsx'), 'utf8')
if (!appSource.includes('reconcileScheduledReport')) {
  failures.push('App.tsx chưa chạy vòng hẹn giờ gửi báo cáo.')
}
if (!appSource.includes("setPage('report')")) {
  failures.push('App.tsx chưa đưa sang màn Báo cáo khi tới giờ gửi (ảnh chỉ dựng được ở đó).')
}
const reportSource = await readFile(join(root, 'src/pages/ReportPage.tsx'), 'utf8')
if (!reportSource.includes('scheduledFinalization')) {
  failures.push('ReportPage chưa nới điều kiện cho đường hẹn giờ.')
}
if (!reportSource.includes("request.trigger !== 'schedule'")) {
  failures.push('ReportPage vẫn bắt ca phải đóng mới tự chốt báo cáo.')
}
const apiSource = await readFile(join(root, 'api/n8n-report-image.ts'), 'utf8')
if (!/'shift-2':\s*'22:15'/.test(apiSource)) {
  failures.push('Lịch gửi ảnh Ca 2 phía API chưa khớp 22:15.')
}

if (failures.length) {
  console.error('REPORT_SCHEDULE_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('REPORT_SCHEDULE_OK')
