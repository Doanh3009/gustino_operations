import { isMissingTable, userHeaders } from './core'
import { shouldUseLanApi, supabase } from './supabase'
import {
  defaultBranchKpiHeadcount,
  defaultDailyKpiBonus,
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

const KPI_FORMULA_BASE_SELECT = 'branch_id, position, weekday_target, weekend_target, monthly_target, headcount'
const KPI_FORMULA_SELECT = `${KPI_FORMULA_BASE_SELECT}, effective_from, daily_bonus_100, daily_bonus_110, note, updated_at`
const KPI_FORMULA_NO_BONUS_SELECT = `${KPI_FORMULA_BASE_SELECT}, effective_from, note, updated_at`
const KPI_FORMULA_LEGACY_SELECT = `${KPI_FORMULA_BASE_SELECT}, note, updated_at`

function normalizedEffectiveFrom(value?: string) {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

/**
 * Postgres/PostgREST hầu như luôn nêu TÊN cột trong lời báo lỗi ("column ... does
 * not exist", "Could not find the '...' column ... in the schema cache"), nên bám
 * theo tên trước — có vậy thông báo cho Admin mới chỉ đúng migration còn thiếu.
 * Chỉ khi lỗi không nêu tên cột nào mới bám vào mã 42703 (undefined_column).
 */
function isMissingColumn(error: unknown, column: string) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  if (message.includes(column)) return true
  const namesAnotherColumn = ['effective_from', 'daily_bonus_100', 'daily_bonus_110']
    .some((known) => known !== column && message.includes(known))
  return String(err?.code || '') === '42703' && !namesAnotherColumn
}

function isMissingEffectiveFromColumn(error: unknown) {
  return isMissingColumn(error, 'effective_from')
}

function isMissingDailyBonusColumn(error: unknown) {
  return isMissingColumn(error, 'daily_bonus_100') || isMissingColumn(error, 'daily_bonus_110')
}

/**
 * Cột tiền thưởng để NULL nghĩa là "chưa đặt riêng" ⇒ hiện đúng mức mặc định
 * đang chạy, chứ không phải 0 đồng. Nếu trả 0 thì mọi chi nhánh đã có dòng
 * override từ trước bản này sẽ hiện "thưởng 0đ" trong bảng — đọc như vừa bị cắt
 * thưởng, trong khi hệ thống thật ra vẫn đang trả 20.000/40.000/30.000.
 */
function bonusFromDb(value: any, fallback: number) {
  return value === null || value === undefined ? fallback : Math.max(0, Number(value) || 0)
}

function rowFromDb(row: any): BranchKpiFormulaRow {
  const position = row.position as KpiPositionKey
  const defaultBonus = defaultDailyKpiBonus(position)
  return {
    branchId: row.branch_id,
    position,
    weekdayTarget: Number(row.weekday_target || 0),
    weekendTarget: Number(row.weekend_target || 0),
    monthlyTarget: Number(row.monthly_target || 0),
    headcount: Number(row.headcount || 0),
    effectiveFrom: normalizedEffectiveFrom(row.effective_from),
    dailyBonus100: bonusFromDb(row.daily_bonus_100, defaultBonus.at100),
    dailyBonus110: bonusFromDb(row.daily_bonus_110, defaultBonus.at110),
    note: row.note || '',
    updatedAt: row.updated_at || undefined,
  }
}

/** Dòng khởi tạo cho một ô chưa từng được chỉnh: đúng bằng mức đang chạy trong code. */
export function defaultBranchKpiRow(branchId: string, position: KpiPositionKey): BranchKpiFormulaRow {
  const formula = defaultPositionKpiFormula(branchId, position)
  const bonus = defaultDailyKpiBonus(position)
  return {
    branchId,
    position,
    weekdayTarget: formula?.weekdayTarget || 0,
    weekendTarget: formula?.weekendTarget || 0,
    monthlyTarget: formula?.monthlyTarget || 0,
    headcount: defaultBranchKpiHeadcount(branchId, position),
    effectiveFrom: undefined,
    dailyBonus100: bonus.at100,
    dailyBonus110: bonus.at110,
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
  // Môi trường chưa apply migration nào thì tụt dần từng bậc cột, không chặn cả
  // trang: thiếu cột tiền thưởng ⇒ chạy mức mặc định, thiếu cả effective_from ⇒
  // quay về bộ cột gốc.
  if (error && isMissingDailyBonusColumn(error)) {
    const noBonus = await supabase
      .from('branch_kpi_formulas')
      .select(KPI_FORMULA_NO_BONUS_SELECT)
    data = noBonus.data
    error = noBonus.error
  }
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
  const bonus = defaultDailyKpiBonus(row.position)
  return {
    ...row,
    weekdayTarget: amount(row.weekdayTarget),
    weekendTarget: amount(row.weekendTarget),
    monthlyTarget: amount(row.monthlyTarget),
    headcount: Math.max(0, Math.round(Number(row.headcount) || 0)),
    effectiveFrom: normalizedEffectiveFrom(row.effectiveFrom),
    dailyBonus100: amount(row.dailyBonus100 ?? bonus.at100),
    dailyBonus110: amount(row.dailyBonus110 ?? bonus.at110),
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
      daily_bonus_100: row.dailyBonus100,
      daily_bonus_110: row.dailyBonus110,
      note: row.note,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'branch_id,position' })
    .select()
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('Chưa có bảng branch_kpi_formulas trên Supabase. Cần apply migration 20260810_branch_kpi_formulas.sql trước.')
    }
    if (isMissingDailyBonusColumn(error)) {
      throw new Error('Chưa có cột branch_kpi_formulas.daily_bonus_100/daily_bonus_110 trên Supabase. Cần apply migration 20260814_branch_kpi_daily_bonus.sql trước.')
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
