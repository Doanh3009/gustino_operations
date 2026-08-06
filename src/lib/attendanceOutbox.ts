/**
 * Hộp thư đi của chấm công (BUG-118): giữ BẰNG CHỨNG đã chụp (ảnh đóng dấu +
 * GPS + địa chỉ + giờ thật) ngay trên máy cho tới khi máy chủ XÁC NHẬN đã lưu.
 *
 * Vì sao phải có: các hạn chót/retry của BUG-106/111/114 chỉ cứu được khi người
 * dùng còn đứng chờ ở màn chấm công. Thực tế quầy đông — nhân viên bấm Check-out,
 * nhét máy vào túi/chuyển sang app khác; nếu upload/ghi DB chết giữa chừng thì
 * thông báo lỗi không ai đọc, và bằng chứng (ảnh + giờ thật) mất theo. Vài tiếng
 * sau mở app: hệ thống bảo chưa chấm công. Outbox giữ lại đúng bộ bằng chứng đó
 * và để app TỰ gửi lại nền (App.tsx + màn Chấm công) với giờ chấm công GỐC.
 *
 * Lưu bằng IndexedDB (chứa được Blob ảnh). Máy không có IndexedDB (Safari private
 * mode…) thì rơi về bộ nhớ tạm trong phiên — vẫn tự gửi lại chừng nào app còn mở.
 * KHÔNG lưu gì ngoài bằng chứng chấm công của chính người dùng đó.
 */

export interface AttendanceOutboxOp {
  id: string
  kind: 'check-in' | 'check-out'
  userId: string
  registrationId: string
  branchId: string
  /** id bản ghi chấm công cần đóng (chỉ với check-out). */
  recordId?: string
  /** Giờ THẬT lúc chấm công — giữ nguyên khi gửi lại, không lấy giờ gửi lại. */
  capturedAt: string
  /** Có thể null khi máy không lấy được GPS (BUG-121) — địa chỉ mang tiền tố tự khai. */
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  address: string
  /** Ảnh selfie ĐÃ đóng dấu giờ/địa chỉ tại thời điểm chấm. */
  selfie: Blob
  /** Đường dẫn Storage cố định; mọi retry ghi cùng object, không sinh ảnh rác. */
  selfiePath?: string
  /** `memory` chỉ sống trong tab hiện tại; UI không được mô tả là đã lưu bền. */
  durability?: AttendanceOutboxDurability
  /** Không tự replay check-in đã xung đột/trật thứ tự; giữ bằng chứng để rà soát. */
  deliveryState?: 'pending' | 'needs-review'
  deliveryNote?: string
  createdAt: string
}

export type AttendanceOutboxDurability = 'persistent' | 'memory'

export interface AttendanceOutboxSnapshot {
  ops: AttendanceOutboxOp[]
  /** false = IndexedDB có tồn tại nhưng không đọc được; tuyệt đối không suy ra rỗng. */
  authoritative: boolean
  error?: Error
}

const DB_NAME = 'gustino-attendance-outbox'
const STORE = 'ops'
export const ATTENDANCE_OUTBOX_EVENT = 'gustino-attendance-outbox-changed'

/** Fallback khi không có IndexedDB: sống trong phiên hiện tại. */
const memoryOps = new Map<string, AttendanceOutboxOp>()
const fastCounts = new Map<string, number>()
// Đếm riêng op CÒN GỬI ĐƯỢC (bỏ op needs-review đã bị cách ly): op cách ly nằm lại
// vĩnh viễn, nếu tính chung thì mọi thứ đọc "còn hàng chờ" sẽ đúng mãi mãi.
const sendableFastCounts = new Map<string, number>()

function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

/**
 * BUG-131: trên iOS WebView (mở app trong Google/Zalo), indexedDB.open() và các
 * request có thể TREO vô hạn — không success, không error. Không có hạn chót thì
 * gate đọc outbox lẫn bước lưu bằng chứng đứng hình, nút Check-in kẹt mãi dù
 * mạng và máy chủ bình thường. Quá hạn ⇒ rơi về đúng đường lỗi/RAM sẵn có.
 */
const IDB_DEADLINE_MS = 4000

function withIdbDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} không phản hồi sau ${IDB_DEADLINE_MS / 1000} giây — trình duyệt này có thể đang chặn IndexedDB.`)),
      IDB_DEADLINE_MS,
    )
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function openDb(): Promise<IDBDatabase> {
  return withIdbDeadline(new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onblocked = () => reject(new Error('Kho chấm công tạm đang bị một tab khác giữ.'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Không mở được kho chấm công tạm trên máy.'))
  }), 'Kho chấm công tạm trên máy')
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Kho chấm công tạm trên máy bị lỗi.'))
  })
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    transaction.oncomplete = () => finish(resolve)
    transaction.onabort = () => finish(() => reject(transaction.error || new Error('Kho chấm công tạm đã hủy giao dịch lưu.')))
    transaction.onerror = () => finish(() => reject(transaction.error || new Error('Kho chấm công tạm không commit được giao dịch.')))
  })
}

function countKey(userId: string) {
  return `gustino_attendance_outbox_count_${userId}`
}

function sendableCountKey(userId: string) {
  return `gustino_attendance_outbox_sendable_${userId}`
}

function writeCountMirror(userId: string, count: number, sendable = count) {
  fastCounts.set(userId, count)
  sendableFastCounts.set(userId, sendable)
  try {
    if (typeof localStorage === 'undefined') return
    if (count > 0) localStorage.setItem(countKey(userId), String(count))
    else localStorage.removeItem(countKey(userId))
    if (sendable > 0) localStorage.setItem(sendableCountKey(userId), String(sendable))
    else localStorage.removeItem(sendableCountKey(userId))
  } catch {
    // localStorage đầy/bị chặn thì bỏ qua — chỉ mất đường tắt đếm nhanh.
  }
}

function countSendable(ops: AttendanceOutboxOp[]) {
  return ops.filter((op) => op.deliveryState !== 'needs-review').length
}

function notifyChanged() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ATTENDANCE_OUTBOX_EVENT))
  } catch {
    // Không có window (test/node) thì thôi.
  }
}

async function readAllOps(): Promise<AttendanceOutboxSnapshot> {
  if (!hasIndexedDb()) {
    return { ops: Array.from(memoryOps.values()), authoritative: true }
  }
  try {
    const db = await openDb()
    try {
      const transaction = db.transaction(STORE, 'readonly')
      const completion = transactionToPromise(transaction)
      const [rows] = await withIdbDeadline(Promise.all([
        requestToPromise(transaction.objectStore(STORE).getAll()),
        completion,
      ]), 'Đọc kho chấm công tạm')
      const persisted = (rows || []) as AttendanceOutboxOp[]
      const merged = new Map<string, AttendanceOutboxOp>(
        persisted.map((op) => [op.id, { ...op, durability: op.durability || 'persistent' }]),
      )
      for (const op of memoryOps.values()) merged.set(op.id, op)
      return { ops: Array.from(merged.values()), authoritative: true }
    } finally {
      db.close()
    }
  } catch (error) {
    // Trả các op RAM đã biết để vẫn có thể thử gửi trong phiên, nhưng đánh dấu
    // KHÔNG authoritative: có thể còn op bền trong IndexedDB mà lần đọc này lỗi.
    return {
      ops: Array.from(memoryOps.values()),
      authoritative: false,
      error: error instanceof Error ? error : new Error('Không đọc được hộp thư chấm công trên máy.'),
    }
  }
}

async function refreshCountMirror(userId: string) {
  const snapshot = await readAllOps()
  if (!snapshot.authoritative) throw snapshot.error
  const own = snapshot.ops.filter((op) => op.userId === userId)
  writeCountMirror(userId, own.length, countSendable(own))
}

export async function saveAttendanceOutboxOp(op: AttendanceOutboxOp): Promise<AttendanceOutboxDurability> {
  let durability: AttendanceOutboxDurability = 'memory'
  if (!hasIndexedDb()) {
    memoryOps.set(op.id, { ...op, durability })
  } else {
    try {
      const db = await openDb()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        const completion = transactionToPromise(transaction)
        await withIdbDeadline(Promise.all([
          requestToPromise(transaction.objectStore(STORE).put({ ...op, durability: 'persistent' })),
          completion,
        ]), 'Lưu kho chấm công tạm')
        durability = 'persistent'
        memoryOps.delete(op.id)
      } finally {
        db.close()
      }
    } catch {
      durability = 'memory'
      memoryOps.set(op.id, { ...op, durability })
    }
  }
  await refreshCountMirror(op.userId).catch(() => {
    // Mirror chỉ là hint. Khi IndexedDB không đọc được, chỉ tăng theo điều chắc
    // chắn vừa lưu; không bao giờ ghi 0 và che các op persisted chưa đọc được.
    writeCountMirror(
      op.userId,
      Math.max(1, attendanceOutboxFastCount(op.userId)),
      Math.max(1, attendanceOutboxSendableFastCount(op.userId)),
    )
  })
  notifyChanged()
  return durability
}

export async function deleteAttendanceOutboxOp(id: string, userId: string): Promise<void> {
  const removedFromMemory = memoryOps.delete(id)
  let deleteError: unknown
  if (hasIndexedDb()) {
    try {
      const db = await openDb()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        const completion = transactionToPromise(transaction)
        await withIdbDeadline(Promise.all([
          requestToPromise(transaction.objectStore(STORE).delete(id)),
          completion,
        ]), 'Dọn kho chấm công tạm')
      } finally {
        db.close()
      }
    } catch (error) {
      deleteError = error
    }
  }
  await refreshCountMirror(userId).catch(() => undefined)
  notifyChanged()
  // Op RAM đã được xóa chắc chắn. Với op persisted, lỗi delete phải nổi lên để
  // lần sau read-back/idempotency xử lý tiếp, không tuyên bố đã dọn bằng chứng.
  if (deleteError && !removedFromMemory) throw deleteError
}

/** Snapshot dùng cho flush: có thể chứa op RAM dù IndexedDB tạm thời không đọc được. */
export async function inspectAttendanceOutbox(userId: string): Promise<AttendanceOutboxSnapshot> {
  const snapshot = await readAllOps()
  const ops = snapshot.ops
    .filter((op) => op.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (snapshot.authoritative) writeCountMirror(userId, ops.length, countSendable(ops))
  return { ...snapshot, ops }
}

/** Danh sách authoritative, cũ nhất trước; không xóa nếu server chưa xác nhận. */
export async function listAttendanceOutboxOps(userId: string): Promise<AttendanceOutboxOp[]> {
  const snapshot = await inspectAttendanceOutbox(userId)
  if (!snapshot.authoritative) {
    throw snapshot.error || new Error('Chưa xác minh được hộp thư chấm công trên máy.')
  }
  return snapshot.ops
}

/** Hint không mở IndexedDB, chỉ dùng khi offline/đang có một flush khác chạy. */
export function attendanceOutboxFastCount(userId: string): number {
  if (!hasIndexedDb()) return Array.from(memoryOps.values()).filter((op) => op.userId === userId).length
  const cached = fastCounts.get(userId)
  if (cached !== undefined) return cached
  try {
    if (typeof localStorage === 'undefined') return 0
    return Number(localStorage.getItem(countKey(userId)) || 0) || 0
  } catch {
    return 0
  }
}

/**
 * Chỉ đếm op CÒN GỬI LẠI ĐƯỢC. Dùng cho các quyết định kiểu "chờ gửi xong đã" —
 * op needs-review đã bị cách ly và chỉ quản lý xử lý được, nếu tính vào thì điều
 * kiện chờ sẽ đúng vĩnh viễn (ví dụ hoãn hết hạn phiên đăng nhập mãi không hết).
 */
export function attendanceOutboxSendableFastCount(userId: string): number {
  if (!hasIndexedDb()) {
    return countSendable(Array.from(memoryOps.values()).filter((op) => op.userId === userId))
  }
  const cached = sendableFastCounts.get(userId)
  if (cached !== undefined) return cached
  try {
    if (typeof localStorage === 'undefined') return 0
    return Number(localStorage.getItem(sendableCountKey(userId)) || 0) || 0
  } catch {
    return 0
  }
}
