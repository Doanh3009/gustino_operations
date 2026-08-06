import { createId } from './browser'
import { supabase } from './supabase'
import type { AppUser, AttendanceAdjustmentKind, AttendanceAdjustmentRequest } from '../types'

interface AdjustmentFilters {
  branchId?: string
  userId?: string
  from?: string
  to?: string
}

export async function createAttendanceAdjustment(
  user: AppUser,
  input: {
    kind: AttendanceAdjustmentKind
    workDate: string
    scheduledTime: string
    actualTime: string
    reason: string
    evidenceNote: string
  },
) {
  const request: AttendanceAdjustmentRequest = {
    id: createId(),
    userId: user.id,
    userName: user.name,
    branchId: user.branchId,
    kind: input.kind,
    workDate: input.workDate,
    scheduledTime: input.scheduledTime,
    actualTime: input.actualTime,
    reason: input.reason.trim(),
    evidenceNote: input.evidenceNote.trim(),
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  }
  if (!supabase) throw new Error('Không thể lưu đơn điều chỉnh vì chưa kết nối máy chủ dữ liệu.')
  const { error } = await supabase.from('attendance_adjustment_requests').insert({
    id: request.id,
    user_id: request.userId,
    branch_id: request.branchId,
    kind: request.kind,
    work_date: request.workDate,
    scheduled_time: request.scheduledTime,
    actual_time: request.actualTime,
    reason: request.reason,
    evidence_note: request.evidenceNote,
    created_by: request.createdBy,
  })
  if (error) throw error
  return request
}

export async function fetchAttendanceAdjustments(_user: AppUser, filters: AdjustmentFilters = {}) {
  if (!supabase) throw new Error('Không thể tải đơn điều chỉnh vì chưa kết nối máy chủ dữ liệu.')
  const rows: any[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('attendance_adjustment_requests')
      .select('*, profiles!attendance_adjustment_requests_user_id_fkey(full_name)')
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id')
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    if (filters.userId) query = query.eq('user_id', filters.userId)
    if (filters.from) query = query.gte('work_date', filters.from)
    if (filters.to) query = query.lte('work_date', filters.to)
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.profiles?.full_name || 'Nhân viên',
    branchId: row.branch_id,
    kind: row.kind,
    workDate: row.work_date,
    scheduledTime: String(row.scheduled_time).slice(0, 5),
    actualTime: String(row.actual_time).slice(0, 5),
    reason: row.reason || '',
    evidenceNote: row.evidence_note || '',
    createdBy: row.created_by,
    createdAt: row.created_at,
  })) as AttendanceAdjustmentRequest[]
}

export function adjustmentKindLabel(kind: AttendanceAdjustmentKind) {
  if (kind === 'late_arrival') return 'Đi trễ'
  if (kind === 'missing_checkout') return 'Quên check-out'
  return 'Về sớm'
}

export function adjustmentMinutes(item: Pick<AttendanceAdjustmentRequest, 'kind' | 'scheduledTime' | 'actualTime'>) {
  // Đơn quên check-out khai giờ ra thật, không phải số phút lệch so với ca.
  if (item.kind === 'missing_checkout') return 0
  const date = '2026-01-01'
  const scheduled = new Date(`${date}T${item.scheduledTime}:00`).getTime()
  const actual = new Date(`${date}T${item.actualTime}:00`).getTime()
  const diff = item.kind === 'late_arrival' ? actual - scheduled : scheduled - actual
  return Math.max(0, Math.round(diff / 60000))
}
