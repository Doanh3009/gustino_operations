// BUG-118: hộp thư đi chấm công — bằng chứng (ảnh đóng dấu + GPS + GIỜ THẬT)
// phải sống sót qua lỗi mạng/tắt app và được gửi lại với đúng giờ gốc.
// Node không có IndexedDB nên bài test này chạy đường fallback bộ nhớ — chính là
// đường Safari private mode dùng; hợp đồng API (save/list/delete/count/durability)
// giống hệt đường IndexedDB.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const failures = []
const root = fileURLToPath(new URL('..', import.meta.url))

const workDir = await mkdtemp(join(tmpdir(), 'gustino-att-outbox-'))
const outFile = join(workDir, 'attendanceOutbox.mjs')
await build({
  entryPoints: [join(root, 'src/lib/attendanceOutbox.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
})
const {
  saveAttendanceOutboxOp,
  deleteAttendanceOutboxOp,
  inspectAttendanceOutbox,
  listAttendanceOutboxOps,
  attendanceOutboxFastCount,
} = await import(pathToFileURL(outFile).href)

const fakeSelfie = new Blob(['anh-dong-dau'], { type: 'image/jpeg' })
function op(id, userId, kind, createdAt, extra = {}) {
  return {
    id,
    kind,
    userId,
    registrationId: `reg-${id}`,
    branchId: 'gold-coast',
    capturedAt: createdAt,
    latitude: 12.25,
    longitude: 109.19,
    accuracy: 18,
    address: '32 Trần Phú, Nha Trang',
    selfie: fakeSelfie,
    createdAt,
    ...extra,
  }
}

// Lưu 2 op của A (1 check-in, 1 check-out) + 1 op của B.
const fallbackDurability = await saveAttendanceOutboxOp(op('a1', 'user-a', 'check-in', '2026-08-01T01:00:00.000Z'))
await saveAttendanceOutboxOp(op('a2', 'user-a', 'check-out', '2026-08-01T08:00:00.000Z', { recordId: 'rec-1' }))
await saveAttendanceOutboxOp(op('b1', 'user-b', 'check-in', '2026-08-01T02:00:00.000Z'))
if (fallbackDurability !== 'memory') failures.push(`Node không có IndexedDB phải báo durability=memory, nhận ${fallbackDurability}.`)

const opsA = await listAttendanceOutboxOps('user-a')
if (opsA.length !== 2) failures.push(`user-a phải có 2 op, nhận ${opsA.length}.`)
if (opsA[0]?.id !== 'a1') failures.push('Op cũ nhất phải đứng đầu (gửi lại theo thứ tự thời gian).')
if (opsA.some((item) => item.userId !== 'user-a')) failures.push('Không được lộ op của người khác.')
if (attendanceOutboxFastCount('user-a') !== 2) failures.push(`Đếm nhanh user-a phải là 2, nhận ${attendanceOutboxFastCount('user-a')}.`)
if (attendanceOutboxFastCount('user-b') !== 1) failures.push(`Đếm nhanh user-b phải là 1, nhận ${attendanceOutboxFastCount('user-b')}.`)

// Giờ chấm GỐC phải được giữ nguyên trong op.
if (opsA[1]?.capturedAt !== '2026-08-01T08:00:00.000Z') failures.push('capturedAt của check-out phải giữ giờ chấm gốc.')
if (opsA[1]?.recordId !== 'rec-1') failures.push('Op check-out phải giữ id bản ghi cần đóng.')

// Máy chủ xác nhận xong thì op bị xóa, đếm nhanh về 0.
await deleteAttendanceOutboxOp('a1', 'user-a')
await deleteAttendanceOutboxOp('a2', 'user-a')
if ((await listAttendanceOutboxOps('user-a')).length !== 0) failures.push('Xóa op xong danh sách phải rỗng.')
if (attendanceOutboxFastCount('user-a') !== 0) failures.push('Đếm nhanh phải về 0 sau khi gửi hết.')
if ((await listAttendanceOutboxOps('user-b')).length !== 1) failures.push('Op của user-b không được bị đụng.')

// Bằng chứng chưa được server xác nhận KHÔNG BAO GIỜ được tự xóa theo tuổi.
await saveAttendanceOutboxOp(op('old', 'user-c', 'check-in', new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()))
await saveAttendanceOutboxOp(op('new', 'user-c', 'check-in', new Date().toISOString()))
const opsC = await listAttendanceOutboxOps('user-c')
if (opsC.length !== 2 || opsC[0].id !== 'old' || opsC[1].id !== 'new') {
  failures.push(`Op cũ chưa xác nhận phải được giữ: mong ['old','new'], nhận [${opsC.map((item) => item.id).join(', ')}].`)
}

// IndexedDB có API nhưng open/read lỗi: KHÔNG được báo authoritative empty.
globalThis.indexedDB = {
  open() {
    const request = {}
    queueMicrotask(() => {
      request.error = new Error('IDB_READ_FAILED')
      request.onerror?.()
    })
    return request
  },
}
const brokenEmpty = await inspectAttendanceOutbox('user-d')
if (brokenEmpty.authoritative || brokenEmpty.ops.length !== 0) {
  failures.push('IndexedDB read lỗi phải trả authoritative=false, không được giả làm danh sách rỗng đáng tin.')
}
const brokenDurability = await saveAttendanceOutboxOp(op('d1', 'user-d', 'check-in', new Date().toISOString()))
if (brokenDurability !== 'memory') failures.push(`IDB open lỗi phải báo durability=memory, nhận ${brokenDurability}.`)
const brokenWithMemory = await inspectAttendanceOutbox('user-d')
if (brokenWithMemory.authoritative || brokenWithMemory.ops[0]?.id !== 'd1') {
  failures.push('IDB lỗi phải giữ op RAM đã biết nhưng vẫn đánh dấu snapshot không authoritative.')
}
let strictListRejected = false
try {
  await listAttendanceOutboxOps('user-d')
} catch {
  strictListRejected = true
}
if (!strictListRejected) failures.push('Danh sách authoritative phải reject khi IndexedDB không đọc được.')
await deleteAttendanceOutboxOp('d1', 'user-d')
delete globalThis.indexedDB

// `put().onsuccess` chưa có nghĩa transaction đã commit. Mô phỏng Safari/IDB
// báo request success rồi transaction abort: API phải rơi về RAM, không được
// xóa bản RAM và tuyên bố persistent.
globalThis.indexedDB = createAbortAfterPutIndexedDb()
const abortModule = await import(`${pathToFileURL(outFile).href}?abort-after-put`)
const abortedDurability = await abortModule.saveAttendanceOutboxOp(
  op('tx-abort', 'user-tx', 'check-in', new Date().toISOString()),
)
if (abortedDurability !== 'memory') {
  failures.push(`IDB transaction abort sau put-success phải báo durability=memory, nhận ${abortedDurability}.`)
}
const abortedSnapshot = await abortModule.inspectAttendanceOutbox('user-tx')
if (abortedSnapshot.ops[0]?.id !== 'tx-abort' || abortedSnapshot.ops[0]?.durability !== 'memory') {
  failures.push('Transaction abort phải giữ nguyên bằng chứng trong RAM của tab hiện tại.')
}
delete globalThis.indexedDB

if (failures.length) {
  console.error('ATTENDANCE_OUTBOX_FAIL')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('ATTENDANCE_OUTBOX_OK')

function createAbortAfterPutIndexedDb() {
  return {
    open() {
      const request = {}
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            const transaction = { error: null }
            transaction.objectStore = () => ({
              put(value) {
                const operation = {}
                queueMicrotask(() => {
                  operation.result = value?.id
                  operation.onsuccess?.()
                  queueMicrotask(() => {
                    transaction.error = new Error('IDB_TX_ABORTED_AFTER_PUT')
                    transaction.onabort?.()
                  })
                })
                return operation
              },
              getAll() {
                const operation = {}
                queueMicrotask(() => {
                  operation.result = []
                  operation.onsuccess?.()
                  queueMicrotask(() => transaction.oncomplete?.())
                })
                return operation
              },
              delete() {
                const operation = {}
                queueMicrotask(() => {
                  operation.onsuccess?.()
                  queueMicrotask(() => transaction.oncomplete?.())
                })
                return operation
              },
            })
            return transaction
          },
        }
        request.onsuccess?.()
      })
      return request
    },
  }
}
