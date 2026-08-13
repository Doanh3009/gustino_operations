import { isMissingTable, userHeaders } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser } from '../types'

/**
 * Đơn xin nghỉ việc.
 *
 * Ai NỘP được: Nhân viên, Ca trưởng, Ca phó (`staff | shift_leader | shift_deputy`).
 * Ai ĐỌC được: người nộp, Quản lý/Admin, SUP MT, và Ca trưởng/Ca phó CÙNG chi nhánh.
 * Ai QUYẾT ĐỊNH: chỉ Quản lý/Admin. Ca trưởng chi nhánh chỉ bấm "Đã nắm thông tin".
 *
 * Chặn thật nằm ở RLS (`20260810_resignation_requests.sql`); các hàm dưới đây chỉ
 * là lớp giao diện, không được coi là biện pháp bảo mật.
 */

export type ResignationStatus = 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'withdrawn'

export interface ResignationRequest {
  id: string
  branchId: string
  employeeId: string
  employeeName: string
  positionTitle: string
  lastWorkingDate: string
  reason: string
  handoverNote: string
  status: ResignationStatus
  acknowledgedBy?: string
  acknowledgedAt?: string
  decidedBy?: string
  decidedAt?: string
  decisionNote: string
  createdAt: string
  updatedAt: string
}

export const RESIGNATION_STATUS_LABELS: Record<ResignationStatus, string> = {
  pending: 'Chờ xử lý',
  acknowledged: 'Ca trưởng đã nắm',
  approved: 'Đã duyệt',
  rejected: 'Không duyệt',
  withdrawn: 'Đã rút đơn',
}

/** Trạng thái còn "đang mở" — người nộp chưa được nộp đơn mới. */
export const OPEN_RESIGNATION_STATUSES: ResignationStatus[] = ['pending', 'acknowledged']

/**
 * Lý do chọn sẵn. Ô trống hoàn toàn khiến phần lớn đơn chỉ ghi "lý do cá nhân",
 * quản lý không rút được thông tin gì; chọn nhóm trước rồi mới trình bày thêm.
 */
export const RESIGNATION_REASON_PRESETS = [
  'Chuyển chỗ ở / về quê',
  'Đi học, thi cử',
  'Sức khỏe, gia đình',
  'Không sắp xếp được lịch ca',
  'Tìm được công việc khác',
  'Lý do cá nhân khác',
]

/** Việc phải bàn giao trước khi nghỉ — checklist thay cho một ô text tự do. */
export const RESIGNATION_HANDOVER_ITEMS = [
  'Đã trả đồng phục và thẻ nhân viên',
  'Đã trả chìa khóa / tủ hàng',
  'Đã đối soát hết túi hàng đang giữ',
  'Đã hoàn thành các ca đã đăng ký',
  'Đã bàn giao việc đang làm dở cho ca trưởng',
]

/** Số ngày báo trước, tính từ ngày nộp tới ngày làm việc cuối cùng. */
export function noticeDays(fromDate: string, lastWorkingDate: string) {
  const start = Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${lastWorkingDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86400000))
}

export function canSubmitResignation(role: AppUser['role']) {
  return role === 'staff' || role === 'shift_leader' || role === 'shift_deputy'
}

export function canDecideResignation(role: AppUser['role']) {
  return role === 'admin' || role === 'manager'
}

/** Ca trưởng/Ca phó chỉ theo dõi đơn của chi nhánh mình, không duyệt. */
export function canReviewBranchResignations(role: AppUser['role']) {
  return role === 'shift_leader' || role === 'shift_deputy'
}

export function canViewResignationInbox(role: AppUser['role']) {
  return canDecideResignation(role) || canReviewBranchResignations(role) || role === 'supmt'
}

function rowToRequest(row: any): ResignationRequest {
  return {
    id: row.id,
    branchId: row.branch_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || '',
    positionTitle: row.position_title || '',
    lastWorkingDate: row.last_working_date,
    reason: row.reason || '',
    handoverNote: row.handover_note || '',
    status: (row.status || 'pending') as ResignationStatus,
    acknowledgedBy: row.acknowledged_by || undefined,
    acknowledgedAt: row.acknowledged_at || undefined,
    decidedBy: row.decided_by || undefined,
    decidedAt: row.decided_at || undefined,
    decisionNote: row.decision_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  }
}

export async function fetchResignationRequests(
  user: AppUser,
  filters: { branchIds?: string[]; employeeId?: string } = {},
): Promise<ResignationRequest[]> {
  if (shouldUseLanApi(user)) {
    const query = new URLSearchParams()
    if (filters.branchIds?.length) query.set('branchIds', filters.branchIds.join(','))
    if (filters.employeeId) query.set('employeeId', filters.employeeId)
    const response = await fetch(`/api/resignation-requests?${query}`, { headers: userHeaders(user) })
    if (!response.ok) return []
    return response.json()
  }
  if (!supabase) return []
  let query = supabase
    .from('resignation_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (filters.employeeId) query = query.eq('employee_id', filters.employeeId)
  const branchIds = (filters.branchIds || []).filter(Boolean)
  if (branchIds.length) query = query.in('branch_id', branchIds)
  const { data, error } = await query
  if (error) {
    // Chưa apply migration thì màn hình vẫn mở được với danh sách rỗng thay vì
    // chết cả trang; mọi lỗi khác phải lộ ra để không giấu quyền bị từ chối.
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return (data || []).map(rowToRequest)
}

export interface ResignationDraft {
  lastWorkingDate: string
  reason: string
  handoverNote?: string
}

export async function submitResignationRequest(user: AppUser, draft: ResignationDraft) {
  if (!canSubmitResignation(user.role)) throw new Error('Vai trò này không nộp đơn xin nghỉ việc trong app.')
  if (!user.branchId) throw new Error('Tài khoản chưa gắn chi nhánh nên chưa nộp đơn được. Liên hệ quản lý để cập nhật hồ sơ.')
  const reason = draft.reason.trim()
  if (reason.length < 10) throw new Error('Cần ghi lý do nghỉ việc rõ ràng (tối thiểu 10 ký tự).')
  if (!draft.lastWorkingDate) throw new Error('Cần chọn ngày làm việc cuối cùng.')
  const payload = {
    branch_id: user.branchId,
    employee_id: user.id,
    employee_name: user.name,
    position_title: user.positionTitle || '',
    last_working_date: draft.lastWorkingDate,
    reason,
    handover_note: (draft.handoverNote || '').trim(),
    status: 'pending' as const,
  }
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/resignation-requests', {
      method: 'POST',
      headers: userHeaders(user),
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không gửi được đơn xin nghỉ việc.')
    return rowToRequest(await response.json())
  }
  if (!supabase) throw new Error('Không có kết nối để gửi đơn xin nghỉ việc.')
  const { data, error } = await supabase.from('resignation_requests').insert(payload).select().single()
  if (error) {
    if (isMissingTable(error)) throw new Error('Chức năng đơn nghỉ việc chưa được bật trên máy chủ. Cần apply migration 20260810_resignation_requests.sql.')
    // Chỉ số duy nhất chặn nộp trùng khi còn đơn đang mở.
    if (error.code === '23505') throw new Error('Bạn đang có một đơn xin nghỉ việc chờ xử lý. Hãy rút đơn cũ trước khi nộp đơn mới.')
    throw new Error(error.message)
  }
  return rowToRequest(data)
}

async function patchRequest(user: AppUser, id: string, patch: Record<string, unknown>) {
  if (shouldUseLanApi(user)) {
    const response = await fetch(`/api/resignation-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: userHeaders(user),
      body: JSON.stringify(patch),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không cập nhật được đơn xin nghỉ việc.')
    return rowToRequest(await response.json())
  }
  if (!supabase) throw new Error('Không có kết nối để cập nhật đơn xin nghỉ việc.')
  const { data, error } = await supabase
    .from('resignation_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToRequest(data)
}

export function withdrawResignationRequest(user: AppUser, id: string) {
  return patchRequest(user, id, { status: 'withdrawn' })
}

/** Ca trưởng chi nhánh xác nhận đã biết — không phải quyết định nhân sự. */
export function acknowledgeResignationRequest(user: AppUser, id: string) {
  if (!canReviewBranchResignations(user.role) && !canDecideResignation(user.role)) {
    throw new Error('Vai trò này không xác nhận đơn xin nghỉ việc.')
  }
  return patchRequest(user, id, {
    status: 'acknowledged',
    acknowledged_by: user.id,
    acknowledged_at: new Date().toISOString(),
  })
}

export function decideResignationRequest(
  user: AppUser,
  id: string,
  decision: 'approved' | 'rejected',
  decisionNote = '',
) {
  if (!canDecideResignation(user.role)) throw new Error('Chỉ Quản lý hoặc Admin được duyệt đơn xin nghỉ việc.')
  return patchRequest(user, id, {
    status: decision,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
    decision_note: decisionNote.trim(),
  })
}
