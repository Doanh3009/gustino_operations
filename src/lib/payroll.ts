import { shouldUseLanApi, supabase } from './supabase'
import type { AppUser, Role } from '../types'

// Lương lưu theo từng tháng (period = 'YYYY-MM').
// - payroll_entries: lương/thưởng/phạt của từng nhân viên trong 1 tháng (override).
// - payroll_role_defaults: lương mặc định theo vai trò + chi nhánh (admin nhập 1 lần).
// - payroll_fixed: mô hình V6 chi tiết hơn, được đọc như nguồn mặc định khi có migration mới.
// Ưu tiên Supabase. Các bảng liên quan đã có migration nên không lưu dữ liệu lương trên trình duyệt.

export interface PayrollEntry {
  employeeId: string
  branchId: string
  period: string
  hourlyRate: number | null
  fixedSalary: number | null
  bonus: number
  deduction: number
  evidenceUrl: string
  evidenceNote: string
  note: string
}

export interface RoleSalaryDefault {
  branchId: string
  role: Role
  hourlyRate: number
  fixedSalary: number
}

// null = chưa biết, true = dùng cloud, false = bảng chưa có ở môi trường cũ.
let cloudReady: boolean | null = supabase ? null : false

function tableMissing(error: unknown) {
  const err = error as { message?: string; code?: string } | null
  const message = String(err?.message || '')
  const code = String(err?.code || '')
  return code === '42P01'
    || code === 'PGRST205'
    || code === 'PGRST204'
    || message.includes('does not exist')
    || message.includes('Could not find the table')
    || message.includes('schema cache')
}

function mapEntry(row: any): PayrollEntry {
  return {
    employeeId: row.employee_id,
    branchId: row.branch_id,
    period: row.period,
    hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
    fixedSalary: row.fixed_salary === null || row.fixed_salary === undefined ? null : Number(row.fixed_salary),
    bonus: Number(row.bonus || 0),
    deduction: Number(row.deduction || 0),
    evidenceUrl: row.evidence_url || '',
    evidenceNote: row.evidence_note || '',
    note: row.note || '',
  }
}

function mapPayrollFixedDefault(row: any): RoleSalaryDefault {
  return {
    branchId: row.branch_id,
    role: row.role,
    hourlyRate: Math.max(Number(row.hourly_rate_weekday || 0), Number(row.hourly_rate_weekend || 0)),
    fixedSalary: Number(row.fixed_salary || 0)
      + Number(row.lunch_allowance || 0)
      + Number(row.attendance_allowance || 0)
      + Number(row.responsibility_allowance || 0)
      + Number(row.parking_allowance || 0),
  }
}

function mergeDefaults(base: RoleSalaryDefault[], overrides: RoleSalaryDefault[]) {
  const map = new Map<string, RoleSalaryDefault>()
  base.forEach((row) => map.set(`${row.branchId}|${row.role}`, row))
  overrides.forEach((row) => map.set(`${row.branchId}|${row.role}`, row))
  return Array.from(map.values())
}

async function fetchPayrollFixedDefaults(branchIds: string[]): Promise<RoleSalaryDefault[] | null> {
  const { data, error } = await supabase!
    .from('payroll_fixed')
    .select('*')
    .in('branch_id', branchIds)
    .eq('active', true)
  if (!error) return (data || []).map(mapPayrollFixedDefault)
  if (tableMissing(error)) return null
  throw error
}

async function upsertPayrollFixedDefault(user: AppUser, def: RoleSalaryDefault): Promise<boolean> {
  const { error } = await supabase!.from('payroll_fixed').upsert({
    branch_id: def.branchId,
    role: def.role,
    employment_type: 'default',
    position_title: 'Vai trò mặc định',
    fixed_salary: def.fixedSalary,
    hourly_rate_weekday: def.hourlyRate,
    hourly_rate_weekend: def.hourlyRate,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
    active: true,
  }, { onConflict: 'branch_id,role,employment_type,position_title' })
  if (!error) return true
  if (tableMissing(error)) return false
  throw error
}

export async function fetchPayrollEntries(user: AppUser, period: string, branchIds: string[]): Promise<PayrollEntry[]> {
  if (!shouldUseLanApi(user) && cloudReady !== false) {
    const { data, error } = await supabase!
      .from('payroll_entries')
      .select('*')
      .eq('period', period)
      .in('branch_id', branchIds)
    if (!error) {
      cloudReady = true
      return (data || []).map(mapEntry)
    }
    if (!tableMissing(error)) throw error
    cloudReady = false
  }
  return []
}

export async function upsertPayrollEntry(user: AppUser, entry: PayrollEntry): Promise<void> {
  if (!shouldUseLanApi(user) && cloudReady !== false) {
    const { error } = await supabase!.from('payroll_entries').upsert({
      branch_id: entry.branchId,
      employee_id: entry.employeeId,
      period: entry.period,
      hourly_rate: entry.hourlyRate,
      fixed_salary: entry.fixedSalary,
      bonus: entry.bonus,
      deduction: entry.deduction,
      evidence_url: entry.evidenceUrl || null,
      evidence_note: entry.evidenceNote || '',
      note: entry.note,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,period' })
    if (!error) {
      cloudReady = true
      return
    }
    if (!tableMissing(error)) throw error
    cloudReady = false
  }
  throw new Error('Thiếu bảng payroll_entries/payroll_fixed trên Supabase, không lưu lương tạm trên trình duyệt.')
}

export async function fetchRoleSalaryDefaults(user: AppUser, branchIds: string[]): Promise<RoleSalaryDefault[]> {
  if (!shouldUseLanApi(user) && supabase) {
    let legacyDefaults: RoleSalaryDefault[] | null = null
    const { data, error } = await supabase!
      .from('payroll_role_defaults')
      .select('*')
      .in('branch_id', branchIds)
    if (!error) {
      cloudReady = true
      legacyDefaults = (data || []).map((row: any) => ({
        branchId: row.branch_id,
        role: row.role,
        hourlyRate: Number(row.hourly_rate || 0),
        fixedSalary: Number(row.fixed_salary || 0),
      }))
    } else if (!tableMissing(error)) {
      throw error
    }
    const fixedDefaults = await fetchPayrollFixedDefaults(branchIds)
    if (fixedDefaults) {
      cloudReady = true
      return mergeDefaults(fixedDefaults, legacyDefaults || [])
    }
    if (legacyDefaults) return legacyDefaults
    cloudReady = false
  }
  return []
}

export async function upsertRoleSalaryDefault(user: AppUser, def: RoleSalaryDefault): Promise<void> {
  if (!shouldUseLanApi(user) && cloudReady !== false) {
    const { error } = await supabase!.from('payroll_role_defaults').upsert({
      branch_id: def.branchId,
      role: def.role,
      hourly_rate: def.hourlyRate,
      fixed_salary: def.fixedSalary,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'branch_id,role' })
    if (!error) {
      cloudReady = true
      await upsertPayrollFixedDefault(user, def).catch(() => undefined)
      return
    }
    if (!tableMissing(error)) throw error
    const fixedReady = await upsertPayrollFixedDefault(user, def)
    if (fixedReady) {
      cloudReady = true
      return
    }
    cloudReady = false
  }
  throw new Error('Thiếu bảng payroll_role_defaults/payroll_fixed trên Supabase, không lưu cấu hình lương tạm trên trình duyệt.')
}
