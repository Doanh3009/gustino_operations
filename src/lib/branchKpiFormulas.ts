import { isMissingTable, userHeaders } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import {
  defaultBranchKpiHeadcount,
  defaultPositionKpiFormula,
  setBranchKpiOverrides,
  type BranchKpiOverride,
  type KpiPositionKey,
} from './commission'
import type { AppUser } from '../types'

/**
 * Mức KPI theo chi nhánh do Admin tự chỉnh (bảng `branch_kpi_formulas`).
 *
 * Đây là lớp GHI ĐÈ mỏng đặt trên `POSITION_KPI_FORMULAS` trong `commission.ts`:
 * chi nhánh/vị trí nào chưa có dòng cấu hình thì vẫn chạy đúng mức mặc định như
 * trước. Nhờ vậy bật tính năng này không đổi một con số KPI nào đang có.
 */

export const KPI_POSITIONS: Array<{ key: KpiPositionKey; label: string; hint: string }> = [
  { key: 'pg_part_time', label: 'PG Part-time', hint: 'Nhân viên bán hàng ca ngắn' },
  { key: 'pg_full_time', label: 'PG Full-time', hint: 'Nhân viên bán hàng ca đủ 8 giờ' },
  { key: 'shift_deputy', label: 'Ca phó', hint: 'Chức danh “Ca phó” trên hồ sơ' },
  // Từ 01/08/2026 doanh thu ca trưởng = tổng các ca mình làm (lớn hơn doanh thu tự
  // bấm bill khoảng ba lần), nên chỉ tiêu ở đây phải đặt theo mức đó. Để 0 thì hệ
  // thống CHỈ ghi nhận doanh thu, không chấm % / hạng / thưởng cho ca trưởng.
  { key: 'shift_leader', label: 'Ca trưởng', hint: 'Tính trên tổng doanh thu các ca mình làm. Để 0 = chỉ ghi nhận, chưa chấm KPI' },
]

export interface BranchKpiFormulaRow extends BranchKpiOverride {
  effectiveFrom?: string
  note: string
  updatedAt?: string
}

const KPI_FORMULA_SELECT = 'branch_id, position, weekday_target, weekend_target, monthly_target, headcount, effective_from, note, updated_at'
const KPI_FORMULA_LEGACY_SELECT = 'branch_id, position, weekday_target, weekend_target, monthly_target, headcount, note, updated_at'

function normalizedEffectiveFrom(value?: string) {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function isMissingEffectiveFromColumn(error: unknown) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  return String(err?.code || '') === '42703'
    || (message.includes('effective_from') && (message.includes('schema cache') || message.includes('column')))
}

function rowFromDb(row: any): BranchKpiFormulaRow {
  return {
    branchId: row.branch_id,
    position: row.position as KpiPositionKey,
    weekdayTarget: Number(row.weekday_target || 0),
    weekendTarget: Number(row.weekend_target || 0),
    monthlyTarget: Number(row.monthly_target || 0),
    headcount: Number(row.headcount || 0),
    effectiveFrom: normalizedEffectiveFrom(row.effective_from),
    note: row.note || '',
    updatedAt: row.updated_at || undefined,
  }
}

/** Dòng khởi tạo cho một ô chưa từng được chỉnh: đúng bằng mức đang chạy trong code. */
export function defaultBranchKpiRow(branchId: string, position: KpiPositionKey): BranchKpiFormulaRow {
  const formula = defaultPositionKpiFormula(branchId, position)
  return {
    branchId,
    position,
    weekdayTarget: formula?.weekdayTarget || 0,
    weekendTarget: formula?.weekendTarget || 0,
    monthlyTarget: formula?.monthlyTarget || 0,
    headcount: defaultBranchKpiHeadcount(branchId, position),
    effectiveFrom: undefined,
    note: '',
  }
}

export async function fetchBranchKpiFormulas(user: AppUser): Promise<BranchKpiFormulaRow[]> {
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/branch-kpi-formulas', { headers: userHeaders(user) })
    if (!response.ok) return []
    return response.json()
  }
  if (!supabase) return []
  const initial = await supabase
    .from('branch_kpi_formulas')
    .select(KPI_FORMULA_SELECT)
  let data = initial.data as Array<Record<string, any>> | null
  let error = initial.error
  if (error && isMissingEffectiveFromColumn(error)) {
    const legacy = await supabase
      .from('branch_kpi_formulas')
      .select(KPI_FORMULA_LEGACY_SELECT)
    data = legacy.data
    error = legacy.error
  }
  if (error) {
    // Bảng chưa được apply trên môi trường đó thì chạy tiếp bằng mức mặc định,
    // KHÔNG chặn cả trang Quản trị. Lỗi khác vẫn phải lộ ra.
    if (isMissingTable(error)) return []
    if (isMissingEffectiveFromColumn(error)) {
      throw new Error('Missing branch_kpi_formulas.effective_from. Apply migration 20260812_branch_kpi_effective_from.sql before saving KPI effective dates.')
    }
    throw new Error(error.message)
  }
  return (data || []).map(rowFromDb)
}

/**
 * Nạp override vào bộ tính KPI dùng chung. Gọi một lần sau mỗi lần đọc/ghi;
 * mọi màn hình (Quản trị, Báo cáo, Dashboard, Bảng thi đua) đọc chung kết quả.
 */
export function applyBranchKpiOverrides(rows: BranchKpiFormulaRow[]) {
  setBranchKpiOverrides(rows)
  return rows
}

export async function loadBranchKpiOverrides(user: AppUser) {
  const rows = await fetchBranchKpiFormulas(user).catch(() => [] as BranchKpiFormulaRow[])
  return applyBranchKpiOverrides(rows)
}

function normalizeRow(row: BranchKpiFormulaRow): BranchKpiFormulaRow {
  const amount = (value: number) => Math.max(0, Math.round(Number(value) || 0))
  return {
    ...row,
    weekdayTarget: amount(row.weekdayTarget),
    weekendTarget: amount(row.weekendTarget),
    monthlyTarget: amount(row.monthlyTarget),
    headcount: Math.max(0, Math.round(Number(row.headcount) || 0)),
    effectiveFrom: normalizedEffectiveFrom(row.effectiveFrom),
    note: (row.note || '').slice(0, 300),
  }
}

export async function saveBranchKpiFormulas(user: AppUser, rows: BranchKpiFormulaRow[]) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin được đổi mức KPI của chi nhánh.')
  const payload = rows.map(normalizeRow)
  if (!payload.length) return []
  if (shouldUseLanApi(user)) {
    const response = await fetch('/api/branch-kpi-formulas', {
      method: 'PUT',
      headers: userHeaders(user),
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể lưu mức KPI.')
    return response.json() as Promise<BranchKpiFormulaRow[]>
  }
  if (!supabase) throw new Error('Không có kết nối Supabase để lưu mức KPI.')
  const { data, error } = await supabase
    .from('branch_kpi_formulas')
    .upsert(payload.map((row) => ({
      branch_id: row.branchId,
      position: row.position,
      weekday_target: row.weekdayTarget,
      weekend_target: row.weekendTarget,
      monthly_target: row.monthlyTarget,
      headcount: row.headcount,
      effective_from: row.effectiveFrom || null,
      note: row.note,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'branch_id,position' })
    .select()
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('Chưa có bảng branch_kpi_formulas trên Supabase. Cần apply migration 20260810_branch_kpi_formulas.sql trước.')
    }
    if (isMissingEffectiveFromColumn(error)) {
      throw new Error('Chưa có cột branch_kpi_formulas.effective_from trên Supabase. Cần apply migration 20260812_branch_kpi_effective_from.sql trước.')
    }
    throw new Error(error.message)
  }
  return (data || []).map(rowFromDb)
}

/** Xóa override của một chi nhánh để quay lại đúng mức mặc định trong code. */
export async function resetBranchKpiFormulas(user: AppUser, branchId: string) {
  if (user.role !== 'admin') throw new Error('Chỉ Admin được đổi mức KPI của chi nhánh.')
  if (shouldUseLanApi(user)) {
    const response = await fetch(`/api/branch-kpi-formulas?branchId=${encodeURIComponent(branchId)}`, {
      method: 'DELETE',
      headers: userHeaders(user),
    })
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Không thể khôi phục mức KPI mặc định.')
    return
  }
  if (!supabase) throw new Error('Không có kết nối Supabase để khôi phục mức KPI.')
  const { error } = await supabase.from('branch_kpi_formulas').delete().eq('branch_id', branchId)
  if (error && !isMissingTable(error)) throw new Error(error.message)
}
